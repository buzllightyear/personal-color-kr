"""``require_current_user`` still returns the user when ``set_user`` raises (Phase 7.3).

Availability invariant (Seed-pinned): Sentry instrumentation must NEVER break the
auth path. This file pins the *end-to-end* fail-open contract through the
:func:`api.dependencies.auth.require_current_user` dependency — not the
:func:`api.observability.sentry.set_request_user` helper in isolation: when the
Sentry boundary (``sentry_sdk.set_user``) raises for ANY reason (SDK
uninitialized, scope corruption, transport error, …), the authenticated request
must still resolve and the typed :class:`User` row must still be returned to the
caller unchanged.

The Sentry boundary is monkeypatched to raise, so no real SDK scope is touched
and no network call is made. We assert the exploding ``set_user`` never surfaces
as an auth failure and that ``require_current_user`` returns the exact resolved
``User`` instance.
"""

from __future__ import annotations

import types
import uuid
from datetime import datetime, timezone
from typing import Any, Callable

import pytest

import api.dependencies.auth as auth_module
import api.observability.sentry as sentry_module
from api.db.models.user import User

pytestmark = pytest.mark.unit

_USER_ID = uuid.UUID("33333333-3333-3333-3333-333333333333")


# ---------------------------------------------------------------------------
# Exploding set_user variants — exercise distinct failure modes
# ---------------------------------------------------------------------------


def _raise_runtime(_payload: Any) -> None:
    raise RuntimeError("sentry scope exploded")


def _raise_value(_payload: Any) -> None:
    raise ValueError("malformed sentry payload")


def _raise_type(_payload: Any) -> None:
    raise TypeError("sentry set_user got an unexpected type")


def _raise_connection(_payload: Any) -> None:
    raise ConnectionError("sentry transport is down")


# ---------------------------------------------------------------------------
# Test doubles mirroring the established unit-test seams
# ---------------------------------------------------------------------------


def _known_user() -> User:
    """A fully-populated user row; its PII must never reach Sentry."""
    user = User()
    user.id = _USER_ID
    user.apple_sub = "sub-returns-user-when-set-user-raises-test"
    user.email = "user@example.com"  # present but must NOT reach Sentry
    user.email_verified = True
    user.display_name = "Test User"
    now = datetime.now(timezone.utc)
    user.created_at = now
    user.updated_at = now
    return user


class _FakeResult:
    def __init__(self, user: User | None) -> None:
        self._user = user

    def scalar_one_or_none(self) -> User | None:
        return self._user


class _FakeSession:
    def __init__(self, user: User | None) -> None:
        self._user = user

    async def execute(self, _statement: Any) -> _FakeResult:
        return _FakeResult(self._user)


def _bearer(token: str = "valid-token") -> Any:
    from fastapi.security import HTTPAuthorizationCredentials

    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


async def _drive_require_current_user(
    user: User, monkeypatch: pytest.MonkeyPatch
) -> User:
    """Run ``require_current_user`` down the verified-and-resolved happy path."""
    monkeypatch.setattr(auth_module, "require_jwt_secret", lambda: "secret")
    monkeypatch.setattr(
        auth_module,
        "verify_backend_jwt",
        lambda *, token, jwt_secret: types.SimpleNamespace(sub=_USER_ID),
    )
    return await auth_module.require_current_user(
        credentials=_bearer(),
        session=_FakeSession(user),  # type: ignore[arg-type]
    )


# ---------------------------------------------------------------------------
# Core invariant: the user is returned unchanged despite a failing set_user
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "exploding_set_user",
    [
        _raise_runtime,
        _raise_value,
        _raise_type,
        _raise_connection,
    ],
)
async def test_returns_user_when_set_user_raises(
    monkeypatch: pytest.MonkeyPatch,
    exploding_set_user: Callable[[Any], None],
) -> None:
    """For any exception class from ``set_user``, auth still returns the user."""
    monkeypatch.setattr(sentry_module.sentry_sdk, "set_user", exploding_set_user)
    user = _known_user()

    returned = await _drive_require_current_user(user, monkeypatch)

    # The exploding set_user must not surface as an auth failure: the exact
    # resolved row is handed back to the caller, identity-preserved.
    assert returned is user
    assert returned.id == _USER_ID


async def test_no_exception_escapes_require_current_user(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The set_user failure is swallowed — no exception escapes the dependency."""
    monkeypatch.setattr(sentry_module.sentry_sdk, "set_user", _raise_runtime)
    user = _known_user()

    # If the fail-open wrapping regressed, this await would raise RuntimeError.
    returned = await _drive_require_current_user(user, monkeypatch)

    assert returned is user


async def test_set_user_failure_logs_warning_but_auth_succeeds(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """Auth succeeds AND the failure is observable via the structured warning."""
    monkeypatch.setattr(sentry_module.sentry_sdk, "set_user", _raise_runtime)
    monkeypatch.setattr(sentry_module._logger, "propagate", True)
    user = _known_user()

    with caplog.at_level("WARNING", logger="apps.api"):
        returned = await _drive_require_current_user(user, monkeypatch)

    assert returned is user
    warnings = [r for r in caplog.records if r.getMessage() == "sentry_set_user_failed"]
    assert len(warnings) == 1
    # The user id must never leak into the warning message body.
    assert str(_USER_ID) not in warnings[0].getMessage()
