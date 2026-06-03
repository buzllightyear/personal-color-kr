"""Unit tests for ``get_release`` — the Sentry release tag (Phase 7.2, AC-12).

The release identifier is sourced from the ``GIT_SHA`` env var and falls back
to the literal ``"unknown"`` when unset or empty. Like the latency threshold
knob, it is a *sensible-default* value, never fail-fast: a missing ``GIT_SHA``
(local dev, bare checkout) must never crash app startup. These tests pin the
``os.environ.get("GIT_SHA", "unknown")`` contract and the always-non-empty
return guarantee.
"""

from __future__ import annotations

import pytest

from api.config.env import DEFAULT_RELEASE, get_release

_VAR = "GIT_SHA"


@pytest.mark.unit
def test_default_release_constant_is_unknown() -> None:
    """The documented fallback constant is exactly ``"unknown"``."""
    assert DEFAULT_RELEASE == "unknown"


@pytest.mark.unit
def test_unknown_when_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    """A missing ``GIT_SHA`` falls back to ``"unknown"`` (never raises)."""
    monkeypatch.delenv(_VAR, raising=False)
    assert get_release() == "unknown"


@pytest.mark.unit
def test_unknown_when_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    """An empty ``GIT_SHA`` is treated as unset → ``"unknown"``."""
    monkeypatch.setenv(_VAR, "")
    assert get_release() == "unknown"


@pytest.mark.unit
def test_returns_git_sha_when_set(monkeypatch: pytest.MonkeyPatch) -> None:
    """A populated ``GIT_SHA`` is returned verbatim as the release tag."""
    monkeypatch.setenv(_VAR, "abc1234")
    assert get_release() == "abc1234"


@pytest.mark.unit
def test_returns_full_length_sha(monkeypatch: pytest.MonkeyPatch) -> None:
    """A full 40-char commit SHA round-trips unchanged."""
    sha = "0123456789abcdef0123456789abcdef01234567"
    monkeypatch.setenv(_VAR, sha)
    assert get_release() == sha


@pytest.mark.unit
def test_release_is_always_non_empty_string(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The release tag is always a non-empty ``str`` for both branches."""
    monkeypatch.delenv(_VAR, raising=False)
    unset = get_release()
    monkeypatch.setenv(_VAR, "deadbeef")
    populated = get_release()
    for value in (unset, populated):
        assert isinstance(value, str)
        assert value != ""


@pytest.mark.unit
def test_release_preserves_whitespace_only_value(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A whitespace-only value is non-empty, so it is NOT coerced to default.

    Only ``None``/``""`` map to the fallback — the getter does not strip or
    re-interpret otherwise-truthy values, matching the plain
    ``os.environ.get("GIT_SHA", "unknown")`` contract.
    """
    monkeypatch.setenv(_VAR, " ")
    assert get_release() == " "
