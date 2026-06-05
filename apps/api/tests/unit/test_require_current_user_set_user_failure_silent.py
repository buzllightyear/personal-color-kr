"""``require_current_user`` fails silently and logs on ``set_user`` failure (Phase 7.3).

Fail-open invariant (Seed-pinned): Sentry instrumentation must NEVER break the auth
path. This file pins the *silent-failure-with-observability* half of that contract
through the :func:`api.dependencies.auth.require_current_user` dependency: when the
Sentry boundary (``sentry_sdk.set_user``) raises, the failure must be

* **silent** to the caller — no exception escapes the dependency, and the resolved
  :class:`api.db.models.user.User` row is still returned unchanged; and
* **observable** to operators — a single structured ``sentry_set_user_failed``
  warning is emitted, and the user id never leaks into that warning's message body.

The Sentry boundary is monkeypatched to raise, so no real SDK scope is touched and
no network call is made. This complements the sibling file that pins identity
preservation across exception classes — here the focus is the *silence + warning*
pairing exercised end-to-end through the dependency seam.
"""

from __future__ import annotations

import logging
import types
import uuid
from datetime import datetime, timezone
from typing import Any

import pytest

import api.dependencies.auth as auth_module
import api.observability.sentry as sentry_module
from api.db.models.user import User

pytestmark = pytest.mark.unit

_USER_ID = uuid.UUID("44444444-4444-4444-4444-444444444444")
_WARNING_EVENT = "sentry_set_user_failed"


# ---------------------------------------------------------------------------
# Exploding set_user — the Sentry boundary blows up for any reason
# ---------------------------------------------------------------------------


def _raise_runtime(_payload: Any) -> None:
    raise RuntimeError("sentry scope exploded")


# ---------------------------------------------------------------------------
# Test doubles mirroring the established unit-test seams
# ---------------------------------------------------------------------------


def _known_user() -> User:
    """A fully-populated user row; its PII must never reach Sentry or the log."""
    user = User()
    user.id = _USER_ID
    user.apple_sub = "sub-set-user-failure-silent-test"
    user.email = "silent@example.com"  # present but must NOT reach Sentry/logs
    user.email_verified = True
    user.display_name = "Silent User"
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
# Silent failure: no exception escapes the dependency
# ---------------------------------------------------------------------------


async def test_set_user_failure_is_silent_to_caller(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A raising ``set_user`` is swallowed — the await resolves, no error escapes."""
    monkeypatch.setattr(sentry_module.sentry_sdk, "set_user", _raise_runtime)
    user = _known_user()

    # If the fail-open wrapping regressed, this await would raise RuntimeError.
    returned = await _drive_require_current_user(user, monkeypatch)

    # Silent: the exact resolved row is handed back, identity-preserved.
    assert returned is user
    assert returned.id == _USER_ID


# ---------------------------------------------------------------------------
# Observability: exactly one structured warning, with no PII leak
# ---------------------------------------------------------------------------


async def test_set_user_failure_logs_single_warning(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """The swallowed failure surfaces as exactly one ``sentry_set_user_failed``."""
    monkeypatch.setattr(sentry_module.sentry_sdk, "set_user", _raise_runtime)
    monkeypatch.setattr(sentry_module._logger, "propagate", True)
    user = _known_user()

    with caplog.at_level("WARNING", logger="apps.api"):
        returned = await _drive_require_current_user(user, monkeypatch)

    assert returned is user
    warnings = [r for r in caplog.records if r.getMessage() == _WARNING_EVENT]
    assert len(warnings) == 1
    record = warnings[0]
    assert record.levelno == logging.WARNING


async def test_warning_does_not_leak_user_id(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """The user id (and other PII) must never appear in the warning payload."""
    monkeypatch.setattr(sentry_module.sentry_sdk, "set_user", _raise_runtime)
    monkeypatch.setattr(sentry_module._logger, "propagate", True)
    user = _known_user()

    with caplog.at_level("WARNING", logger="apps.api"):
        await _drive_require_current_user(user, monkeypatch)

    warnings = [r for r in caplog.records if r.getMessage() == _WARNING_EVENT]
    assert len(warnings) == 1
    record = warnings[0]

    # Neither the message body nor the rendered record may carry the id or email.
    rendered = record.getMessage() + str(getattr(record, "user_correlation", ""))
    assert str(_USER_ID) not in rendered
    assert user.email not in rendered


# ---------------------------------------------------------------------------
# Combined contract: silent to the caller AND observable to operators
# ---------------------------------------------------------------------------


async def test_failure_is_silent_and_observable_together(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """Both halves hold in a single run: auth succeeds and the warning is logged."""
    monkeypatch.setattr(sentry_module.sentry_sdk, "set_user", _raise_runtime)
    monkeypatch.setattr(sentry_module._logger, "propagate", True)
    user = _known_user()

    with caplog.at_level("WARNING", logger="apps.api"):
        returned = await _drive_require_current_user(user, monkeypatch)

    # Silent: caller gets the user, unaffected by the Sentry boundary failure.
    assert returned is user
    # Observable: the failure is recorded exactly once.
    warnings = [r for r in caplog.records if r.getMessage() == _WARNING_EVENT]
    assert len(warnings) == 1
