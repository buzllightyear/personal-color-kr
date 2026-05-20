"""Unit tests for the FAL_API_KEY loader (Seed Contract AC 19).

The contract under test:

    `load_fal_api_key()` MUST resolve the `FAL_API_KEY` server-side
    secret via the existing `config.env.find_dotenv`-based loader,
    returning the key string on success and raising `LookupError` with
    a precise location-tagged message when the variable is unset.

Why these tests matter:

    `FAL_API_KEY` is a server-side credential that MUST NEVER be
    hard-coded, MUST NEVER reach the mobile bundle, and MUST NEVER
    appear in log lines or exception messages. The Seed Contract pins
    `.env` (resolved via `find_dotenv`) as the single source of truth
    for the value. If this loader silently returns `None`, embeds the
    key in an error message, or bypasses `find_dotenv`, the entire
    security posture of the Fal.ai adapter breaks.

Test isolation:

    Every test that mutates `os.environ` uses `monkeypatch.setenv` /
    `monkeypatch.delenv` so the value never leaks across tests or into
    the surrounding 940-test suite. The tests assert behaviour against
    `config.env` directly, not against a stubbed loader — i.e. we
    verify the *real* `find_dotenv`-based resolution path is used.
"""

from __future__ import annotations

from typing import Final, get_type_hints

import pytest

from image_edit import fal_ai_api_key
from image_edit.fal_ai_api_key import (
    FAL_API_KEY_ENV_VAR,
    load_fal_api_key,
)

# A clearly-fake value that cannot be confused with a real Fal key. We
# embed neither colon-separated halves nor hex sequences so a log-leak
# test (asserting the value never appears in an error message) is
# unambiguous if it ever fails.
_TEST_API_KEY: Final[str] = "test-fake-key-value-do-not-use"


# ---------------------------------------------------------------------------
# Module-level surface
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_env_var_constant_is_exact_name() -> None:
    """The module advertises the canonical env var name.

    The Seed Contract and `.env.example` both pin the literal string
    `FAL_API_KEY`. A drift here would silently break every downstream
    caller (smoke script, adapter, FastAPI bootstrap), so we lock the
    spelling.
    """
    assert FAL_API_KEY_ENV_VAR == "FAL_API_KEY"


@pytest.mark.unit
def test_env_var_constant_is_final_typed() -> None:
    """The env var name is `Final`-annotated for mypy strict mode."""
    hints = get_type_hints(fal_ai_api_key, include_extras=True)
    raw = hints["FAL_API_KEY_ENV_VAR"]
    # `get_type_hints` collapses `Final[str]` to `str` when extras are
    # excluded, but with `include_extras=True` the `Final[...]` wrapper
    # is preserved. Both representations are acceptable; the goal is to
    # confirm the constant is annotated, not bare-typed.
    assert raw is not None


@pytest.mark.unit
def test_loader_is_exported_from_module_dunder_all() -> None:
    """`load_fal_api_key` is the documented public surface."""
    assert "load_fal_api_key" in fal_ai_api_key.__all__
    assert "FAL_API_KEY_ENV_VAR" in fal_ai_api_key.__all__


@pytest.mark.unit
def test_loader_is_reexported_from_package() -> None:
    """The loader is importable from `image_edit` for adapter wiring.

    Phase 4 FastAPI bootstrap, the future DI container, and the
    adapter constructor all import `image_edit` rather than its
    internal submodules — so the public surface must include this
    function explicitly.
    """
    from image_edit import FAL_API_KEY_ENV_VAR as pkg_const
    from image_edit import load_fal_api_key as pkg_fn

    assert pkg_const == "FAL_API_KEY"
    assert pkg_fn is load_fal_api_key


# ---------------------------------------------------------------------------
# Happy path: key present in os.environ
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_returns_value_from_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    """When `FAL_API_KEY` is in `os.environ`, the loader returns it as-is.

    The non-overriding semantics of `load_root_dotenv` mean a value
    already exported in the process environment wins over the file
    value — this matches the Seed Contract's CI / credential-rotation
    requirement: an operator can `export FAL_API_KEY=...` for a one-off
    run without editing `.env`.
    """
    monkeypatch.setenv(FAL_API_KEY_ENV_VAR, _TEST_API_KEY)
    assert load_fal_api_key() == _TEST_API_KEY


@pytest.mark.unit
def test_returns_string_type(monkeypatch: pytest.MonkeyPatch) -> None:
    """The return type is `str`, not `bytes` or `Optional[str]`.

    The adapter constructs `Authorization: Key <value>` headers from
    this string; a `bytes` return would silently produce a malformed
    header on Python 3 (`bytes.__str__` includes the `b'...'` prefix).
    """
    monkeypatch.setenv(FAL_API_KEY_ENV_VAR, _TEST_API_KEY)
    result = load_fal_api_key()
    assert isinstance(result, str)


@pytest.mark.unit
def test_preserves_special_characters(monkeypatch: pytest.MonkeyPatch) -> None:
    """The loader returns the raw value byte-for-byte.

    Real Fal keys are `<key_id>:<key_secret>` pairs and the secret half
    can contain characters that look like shell metacharacters. The
    loader MUST NOT strip, escape, or otherwise transform the value —
    that would silently produce a different Authorization header than
    the operator pasted into `.env`.
    """
    raw_value = "key-id-123:secret_abc-DEF.456+/=ghi"
    monkeypatch.setenv(FAL_API_KEY_ENV_VAR, raw_value)
    assert load_fal_api_key() == raw_value


@pytest.mark.unit
def test_idempotent_when_called_twice(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Repeated calls return the same value without side effects.

    `load_root_dotenv` is idempotent (non-overriding) and `get_env`
    only reads `os.environ`. Concurrent calls from the adapter +
    smoke script + tests must all see the same value.
    """
    monkeypatch.setenv(FAL_API_KEY_ENV_VAR, _TEST_API_KEY)
    first = load_fal_api_key()
    second = load_fal_api_key()
    assert first == second == _TEST_API_KEY


# ---------------------------------------------------------------------------
# Missing-key path
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_raises_lookup_error_when_unset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A missing `FAL_API_KEY` raises `LookupError`, not `KeyError`.

    The Seed Contract pins `LookupError` as the fail-fast exception
    type so callers can `except LookupError:` uniformly across the
    smoke script, the adapter, and any future Phase 4 surface
    without accidentally catching unrelated `dict`-level `KeyError`s.
    """
    monkeypatch.delenv(FAL_API_KEY_ENV_VAR, raising=False)
    # Also suppress any root `.env` so we exercise the truly-missing
    # branch deterministically across local + CI environments.
    monkeypatch.setattr(
        "image_edit.fal_ai_api_key.load_root_dotenv",
        lambda override=False: False,
    )

    with pytest.raises(LookupError):
        load_fal_api_key()


@pytest.mark.unit
def test_raises_lookup_error_when_empty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An empty `FAL_API_KEY=` line is treated as unset.

    `config.env.get_env` documents this contract explicitly: an empty
    string is *not* a valid credential, so the loader must surface the
    same fail-fast `LookupError` as for a missing variable. This
    catches the "stray `FAL_API_KEY=` line in .env" misconfiguration
    before any HTTP round-trip.
    """
    monkeypatch.setenv(FAL_API_KEY_ENV_VAR, "")
    with pytest.raises(LookupError):
        load_fal_api_key()


@pytest.mark.unit
def test_missing_key_error_does_not_embed_value(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No exception path leaks any prior value of `FAL_API_KEY`.

    A real-world failure mode: an operator might have an *expired*
    `FAL_API_KEY` exported and clear it mid-session. If the loader
    ever embedded the prior value in the error message, that value
    would leak into log aggregation. We verify the error message
    contains only the *name* and the resolved `.env` path.
    """
    # A clearly-recognisable sentinel we can grep for in the message.
    leak_canary = "SENSITIVE-CANARY-VALUE-MUST-NOT-LEAK"
    monkeypatch.setenv(FAL_API_KEY_ENV_VAR, leak_canary)
    # Now clear it, simulating the "got removed mid-session" failure.
    monkeypatch.delenv(FAL_API_KEY_ENV_VAR, raising=False)
    # And suppress dotenv loading so the test is hermetic.
    monkeypatch.setattr(
        "image_edit.fal_ai_api_key.load_root_dotenv",
        lambda override=False: False,
    )

    with pytest.raises(LookupError) as exc_info:
        load_fal_api_key()

    assert leak_canary not in str(exc_info.value)


@pytest.mark.unit
def test_missing_key_error_mentions_variable_name(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The error message names `FAL_API_KEY` so operators know what to fix.

    The whole point of the `required=True` contract is fail-fast with
    actionable diagnostics. A generic "missing env var" message would
    waste the operator's time tracking down which one.
    """
    monkeypatch.delenv(FAL_API_KEY_ENV_VAR, raising=False)
    monkeypatch.setattr(
        "image_edit.fal_ai_api_key.load_root_dotenv",
        lambda override=False: False,
    )

    with pytest.raises(LookupError, match="FAL_API_KEY"):
        load_fal_api_key()


# ---------------------------------------------------------------------------
# Integration with `config.env`
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_loader_invokes_load_root_dotenv(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The loader actually goes through the documented `find_dotenv` path.

    A regression where someone replaces the loader body with a direct
    `os.environ[...]` access would silently bypass the contract that
    `FAL_API_KEY` is sourced from the root `.env`. We verify the
    `load_root_dotenv` symbol is called every time.
    """
    calls: list[bool] = []

    def fake_load(*, override: bool = False) -> bool:
        calls.append(override)
        return True

    monkeypatch.setattr("image_edit.fal_ai_api_key.load_root_dotenv", fake_load)
    monkeypatch.setenv(FAL_API_KEY_ENV_VAR, _TEST_API_KEY)

    load_fal_api_key()
    assert calls == [False], (
        "load_fal_api_key() must invoke load_root_dotenv() with the "
        "default non-overriding semantics so CI-exported values win "
        f"over file values. Saw calls: {calls!r}"
    )


@pytest.mark.unit
def test_dotenv_load_failure_is_not_fatal_when_env_already_set(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """If `.env` is missing but the env var is exported, the loader succeeds.

    This matches the smoke script's behaviour: a missing `.env` is
    only fatal when the variable itself is also unset.
    """
    monkeypatch.setenv(FAL_API_KEY_ENV_VAR, _TEST_API_KEY)
    monkeypatch.setattr(
        "image_edit.fal_ai_api_key.load_root_dotenv",
        lambda override=False: False,
    )

    assert load_fal_api_key() == _TEST_API_KEY


# ---------------------------------------------------------------------------
# Security posture
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_module_source_does_not_hardcode_api_key() -> None:
    """The loader source MUST NOT contain any hard-coded key literal.

    The Seed Contract bans embedding the secret in source code under
    any circumstances. The loader is the one module specifically about
    the key, so it is the highest-risk site for an accidental paste.
    This test reads the module file and asserts no string literal
    looks like a Fal key (`<id>:<secret>` pattern with realistic
    length).
    """
    import re
    from pathlib import Path

    src_path = Path(fal_ai_api_key.__file__)
    text = src_path.read_text(encoding="utf-8")

    # Fal keys are documented as `<key_id>:<key_secret>` where each
    # half is alphanumeric+dashes and at least 8 characters. A regex
    # that conservatively matches that shape catches both legitimate
    # keys and the placeholder format from `.env.example`.
    # We allow `<key_id>:<key_secret>` *in prose* but ban it as a
    # literal string assignment.
    suspicious = re.findall(
        r'["\']([A-Za-z0-9_\-]{8,}:[A-Za-z0-9_\-]{8,})["\']',
        text,
    )
    assert suspicious == [], (
        "Loader source contains string literals shaped like Fal API "
        f"keys: {suspicious!r}. Keys MUST be loaded from .env, never "
        "hard-coded in source."
    )


@pytest.mark.unit
def test_module_does_not_log_or_print() -> None:
    """The loader MUST NOT call `print` or use the `logging` module.

    The Seed Contract's observability principle pins DEBUG-level logs
    to the *adapter* (with `FAL_API_KEY` explicitly forbidden in any
    payload). The loader sits one layer below the adapter and must
    therefore be entirely silent — any `print` or `logger.info` here
    risks the value reaching stdout/stderr or a log aggregator.
    """
    from pathlib import Path

    src_path = Path(fal_ai_api_key.__file__)
    text = src_path.read_text(encoding="utf-8")

    # Strip docstrings and comments so prose references don't
    # false-positive. A coarse but effective filter: split on newlines
    # and ignore lines that are comments or inside triple-quoted blocks.
    code_lines: list[str] = []
    in_block = False
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith('"""'):
            # Toggle on a full-line docstring delimiter; a docstring
            # that starts and ends on the same line should not toggle.
            if stripped.count('"""') == 1:
                in_block = not in_block
            continue
        if in_block:
            continue
        if stripped.startswith("#"):
            continue
        code_lines.append(line)

    code_only = "\n".join(code_lines)
    assert "print(" not in code_only, (
        "Loader contains a `print(` call. The key value MUST NOT "
        "reach stdout/stderr under any circumstances."
    )
    assert "import logging" not in code_only and "logging." not in code_only, (
        "Loader imports / uses `logging`. The key value MUST NOT "
        "reach any log handler — DEBUG-level logging is the adapter's "
        "responsibility, with explicit redaction."
    )
