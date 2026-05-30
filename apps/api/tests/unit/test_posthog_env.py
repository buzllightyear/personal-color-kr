"""Unit tests for the Phase 4.4 PostHog env-var accessors (config/env.py).

Mirrors the fail-fast ``require_*`` pattern already covered for
``JWT_SECRET`` / ``APPLE_BUNDLE_ID``: ``get_*`` returns ``None`` when
unset/empty; ``require_*`` raises ``LookupError`` naming the var but never
its value.
"""

from __future__ import annotations

import pytest

from api.config import env


@pytest.mark.unit
def test_get_posthog_personal_api_key_present(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("POSTHOG_PERSONAL_API_KEY", "phx_abc")
    assert env.get_posthog_personal_api_key() == "phx_abc"
    assert env.require_posthog_personal_api_key() == "phx_abc"


@pytest.mark.unit
def test_get_posthog_personal_api_key_empty_is_unset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("POSTHOG_PERSONAL_API_KEY", "")
    assert env.get_posthog_personal_api_key() is None


@pytest.mark.unit
def test_require_posthog_personal_api_key_missing_raises(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("POSTHOG_PERSONAL_API_KEY", raising=False)
    with pytest.raises(LookupError) as exc_info:
        env.require_posthog_personal_api_key()
    # Names the var, never leaks a value.
    assert "POSTHOG_PERSONAL_API_KEY" in str(exc_info.value)


@pytest.mark.unit
def test_get_posthog_project_id_present(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("POSTHOG_PROJECT_ID", "4242")
    assert env.get_posthog_project_id() == "4242"
    assert env.require_posthog_project_id() == "4242"


@pytest.mark.unit
def test_require_posthog_project_id_missing_raises(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("POSTHOG_PROJECT_ID", raising=False)
    with pytest.raises(LookupError) as exc_info:
        env.require_posthog_project_id()
    assert "POSTHOG_PROJECT_ID" in str(exc_info.value)
