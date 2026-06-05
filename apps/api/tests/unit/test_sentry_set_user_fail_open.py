"""``set_request_user`` is fail-open: it never breaks the auth path (Phase 7.3).

Availability invariant: Sentry instrumentation must NEVER degrade the API or
break authentication. When ``sentry_sdk.set_user`` raises (SDK uninitialized,
scope error, …) the failure is swallowed and logged once as
``sentry_set_user_failed`` — the authenticated request still succeeds.

The Sentry boundary is monkeypatched to raise; we assert no exception escapes and
the structured warning is emitted (without leaking the user id into the message).
"""

from __future__ import annotations

import types
import uuid
from datetime import datetime, timezone
from typing import Any

import pytest

import api.dependencies.auth as auth_module
import api.observability.sentry as sentry_module
from api.db.models.user import User
from api.observability.sentry import set_request_user

pytestmark = pytest.mark.unit

_USER_ID = uuid.UUID("22222222-2222-2222-2222-222222222222")


def _boom(_payload: Any) -> None:
    raise RuntimeError("sentry scope exploded")


# ---------------------------------------------------------------------------
# set_request_user helper — swallow + warn
# ---------------------------------------------------------------------------


def test_set_request_user_swallows_exception(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(sentry_module.sentry_sdk, "set_user", _boom)
    # Must NOT raise — fail-open.
    set_request_user(str(_USER_ID))


def test_set_request_user_logs_warning_on_failure(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setattr(sentry_module.sentry_sdk, "set_user", _boom)
    monkeypatch.setattr(sentry_module._logger, "propagate", True)

    with caplog.at_level("WARNING", logger="apps.api"):
        set_request_user(str(_USER_ID))

    records = [r for r in caplog.records if r.getMessage() == "sentry_set_user_failed"]
    assert len(records) == 1
    # The user id must not leak into the log message body.
    assert str(_USER_ID) not in records[0].getMessage()


# ---------------------------------------------------------------------------
# require_current_user — auth still succeeds when set_user fails
# ---------------------------------------------------------------------------


def _known_user() -> User:
    user = User()
    user.id = _USER_ID
    user.apple_sub = "sub-fail-open-test"
    user.email = None
    user.email_verified = False
    user.display_name = None
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


async def test_require_current_user_succeeds_despite_set_user_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = _known_user()
    monkeypatch.setattr(sentry_module.sentry_sdk, "set_user", _boom)
    monkeypatch.setattr(auth_module, "require_jwt_secret", lambda: "secret")
    monkeypatch.setattr(
        auth_module,
        "verify_backend_jwt",
        lambda *, token, jwt_secret: types.SimpleNamespace(sub=_USER_ID),
    )

    # The exploding set_user must not surface as an auth failure.
    returned = await auth_module.require_current_user(
        credentials=_bearer(),
        session=_FakeSession(user),  # type: ignore[arg-type]
    )

    assert returned is user
