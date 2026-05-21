"""Unit tests for `config.env` — root-`.env` resolution helpers (AC 9).

The contract under test:

    `find_root_dotenv()` MUST resolve to the *single* `.env` file at the
    monorepo root, regardless of which sub-directory the test runner is
    invoked from. `load_root_dotenv()` MUST populate `os.environ` from
    that file. `get_env(..., required=True)` MUST raise `LookupError`
    when the variable is unset.

Why these tests matter:

    The Seed Contract names a single source of truth for vendor
    credentials (PostHog, Fal.ai, Superwall): the `.env` file at the
    repo root. If `find_dotenv()` returns the wrong path (or `None`),
    the `scripts/smoke_fal.py` exit-condition silently breaks the
    moment a developer runs it from a different working directory.

Test isolation:

    Every test monkeypatches `os.environ` and `Path.cwd()` as needed so
    we do not leak credential state into the surrounding 940-test
    pytest suite. The tests do NOT depend on real vendor key values;
    they only verify that resolution + loading work for the placeholder
    `.env` (or, if the file is missing entirely, that the helpers
    degrade safely).
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from config import env as config_env
from config.env import (
    find_root_dotenv,
    get_env,
    load_root_dotenv,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _repo_root() -> Path:
    """Compute the monorepo root from this test file's location.

    `test_env.py` lives at
        <repo>/packages/core-python/tests/config/test_env.py
    so `parents[4]` is the repo root:
        parents[0] = tests/config
        parents[1] = tests
        parents[2] = core-python
        parents[3] = packages
        parents[4] = <repo>
    """
    return Path(__file__).resolve().parents[4]


# ---------------------------------------------------------------------------
# find_root_dotenv
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_find_root_dotenv_returns_path_under_repo_root() -> None:
    """`find_root_dotenv()` must return the `.env` at the monorepo root.

    We do not assert the file is populated with real keys (the test
    suite runs in environments where `.env` may only contain
    placeholders or be absent). We only assert that *when* a `.env`
    exists it is the one at the repo root, not a stray nested file.
    """
    resolved = find_root_dotenv()
    if resolved is None:
        # No `.env` at all in this checkout. Confirm `.env.example` is
        # present so a developer reading this failure knows the next
        # step is `cp .env.example .env`.
        assert (_repo_root() / ".env.example").exists(), (
            "Neither `.env` nor `.env.example` was found at the repo "
            f"root ({_repo_root()}). This checkout is incomplete."
        )
        pytest.skip(
            "Root `.env` not present (developer has not yet copied "
            "`.env.example`). `find_root_dotenv()` correctly returned None."
        )

    resolved_path = Path(resolved)
    assert (
        resolved_path.is_absolute()
    ), f"find_root_dotenv() must return an absolute path; got {resolved!r}"
    assert resolved_path.name == ".env", (
        f"find_root_dotenv() must point at a file literally named '.env'; "
        f"got {resolved_path.name!r}"
    )
    assert resolved_path.parent == _repo_root(), (
        f"find_root_dotenv() must resolve to the monorepo-root .env "
        f"(expected parent {_repo_root()}); got parent {resolved_path.parent}"
    )


@pytest.mark.unit
def test_find_root_dotenv_is_stable_across_cwd_changes(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The resolved path must not depend on the process working directory.

    `find_root_dotenv()` anchors its search on this module's location
    (via `filename=...` + `usecwd=False`), so flipping `os.chdir()` to
    an unrelated tmp directory must not change the result.
    """
    before = find_root_dotenv()
    monkeypatch.chdir(tmp_path)
    after = find_root_dotenv()
    assert before == after, (
        "find_root_dotenv() returned different paths before and after "
        f"chdir({tmp_path}): before={before!r}, after={after!r}"
    )


# ---------------------------------------------------------------------------
# load_root_dotenv
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_load_root_dotenv_returns_bool_and_does_not_raise(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`load_root_dotenv()` must return a bool and never raise.

    We clear the three credential vars first so the test is hermetic —
    whatever the developer's local environment looks like, the test
    asserts the same shape.
    """
    for key in ("POSTHOG_API_KEY", "SUPERWALL_API_KEY", "FAL_API_KEY"):
        monkeypatch.delenv(key, raising=False)
    result = load_root_dotenv()
    assert isinstance(
        result, bool
    ), f"load_root_dotenv() must return bool; got {type(result).__name__}"


@pytest.mark.unit
def test_load_root_dotenv_populates_env_when_file_present(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When `.env` exists, loading must populate the documented keys.

    The Seed Contract names exactly three credentials in the root
    `.env`: POSTHOG_API_KEY, SUPERWALL_API_KEY, FAL_API_KEY. If `.env`
    is present, all three MUST be set after `load_root_dotenv()` —
    even if their values are still placeholders.
    """
    if find_root_dotenv() is None:
        pytest.skip("Root `.env` not present in this checkout.")

    for key in ("POSTHOG_API_KEY", "SUPERWALL_API_KEY", "FAL_API_KEY"):
        monkeypatch.delenv(key, raising=False)
    loaded = load_root_dotenv()
    assert loaded is True, (
        "load_root_dotenv() returned False even though find_root_dotenv() "
        "reported a path — the file was discoverable but unreadable."
    )
    for key in ("POSTHOG_API_KEY", "SUPERWALL_API_KEY", "FAL_API_KEY"):
        assert key in os.environ, (
            f"After load_root_dotenv(), {key!r} should be present in "
            "os.environ. Check that .env declares it (see .env.example)."
        )


@pytest.mark.unit
def test_load_root_dotenv_respects_override_false_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Pre-existing `os.environ` values must win over `.env` by default.

    This documents the deliberate decision in `load_root_dotenv()` to
    default `override=False`: a CI operator who exports
    `POSTHOG_API_KEY` for a one-off run must not have it silently
    overwritten by the on-disk file.
    """
    if find_root_dotenv() is None:
        pytest.skip("Root `.env` not present in this checkout.")

    sentinel = "ci-injected-sentinel-value-do-not-overwrite"
    monkeypatch.setenv("POSTHOG_API_KEY", sentinel)
    load_root_dotenv()  # default override=False
    assert os.environ["POSTHOG_API_KEY"] == sentinel, (
        "load_root_dotenv(override=False) must not overwrite a value "
        "that was already present in os.environ before the call."
    )


# ---------------------------------------------------------------------------
# get_env
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_get_env_returns_value_when_set(monkeypatch: pytest.MonkeyPatch) -> None:
    """Happy path: a set variable comes back as a string."""
    monkeypatch.setenv("FAL_API_KEY", "key_id:key_secret")
    assert get_env("FAL_API_KEY") == "key_id:key_secret"


@pytest.mark.unit
def test_get_env_returns_default_when_unset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Unset variables return the explicit default (not `None` accidentally)."""
    monkeypatch.delenv("FAL_API_KEY", raising=False)
    assert get_env("FAL_API_KEY", default="fallback") == "fallback"


@pytest.mark.unit
def test_get_env_returns_default_when_empty_string(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Empty-string values are treated as unset (avoids passing `""` to SDKs)."""
    monkeypatch.setenv("FAL_API_KEY", "")
    assert get_env("FAL_API_KEY", default="fallback") == "fallback"


@pytest.mark.unit
def test_get_env_raises_lookup_error_when_required_and_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`required=True` must raise LookupError with the resolved path included.

    Smoke scripts depend on this contract for clear error messages — a
    bare `KeyError` leaves the operator guessing which file to edit.
    """
    monkeypatch.delenv("FAL_API_KEY", raising=False)
    with pytest.raises(LookupError) as excinfo:
        get_env("FAL_API_KEY", required=True)
    message = str(excinfo.value)
    assert (
        "FAL_API_KEY" in message
    ), f"LookupError message must name the missing variable; got {message!r}"


@pytest.mark.unit
def test_get_env_raises_lookup_error_when_required_and_empty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Empty strings must trigger the same fail-fast path as `unset`."""
    monkeypatch.setenv("FAL_API_KEY", "")
    with pytest.raises(LookupError):
        get_env("FAL_API_KEY", required=True)


# ---------------------------------------------------------------------------
# Module-level invariants
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_importing_config_does_not_load_dotenv_at_import_time(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Importing `config` MUST NOT side-effect `os.environ`.

    If `config/__init__.py` ever auto-loads `.env`, the existing
    940-test pytest suite starts inheriting credential state from the
    developer's local file — exactly the Seed Contract's
    `test_isolation` evaluation principle we are guarding against.
    """
    monkeypatch.delenv("FAL_API_KEY", raising=False)
    # Re-import the module fresh and confirm no side effect on env.
    import importlib

    import config

    importlib.reload(config)
    assert "FAL_API_KEY" not in os.environ or os.environ["FAL_API_KEY"] == "", (
        "Importing/reloading `config` set FAL_API_KEY in os.environ. "
        "`load_root_dotenv()` must remain an explicit, opt-in call."
    )


@pytest.mark.unit
def test_config_module_exposes_documented_api() -> None:
    """Guard the public surface of `config.env` against silent renames.

    Anything that consumes `from config import find_root_dotenv` (e.g.
    the upcoming `scripts/smoke_fal.py`) needs these three names to stay
    stable. This test fails loudly if a refactor drops one.
    """
    for name in ("find_root_dotenv", "load_root_dotenv", "get_env"):
        assert hasattr(config_env, name), (
            f"config.env.{name} disappeared — downstream consumers will "
            "break. If renaming, update the smoke scripts and re-export "
            "the new name from config/__init__.py."
        )
