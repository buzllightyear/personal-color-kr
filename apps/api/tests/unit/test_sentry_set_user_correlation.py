"""Authenticated-user correlation via ``sentry_sdk.set_user`` (Phase 7.3).

Happy-path contract: ``require_current_user`` attaches the authenticated user's
stable internal id to the active Sentry scope as ``{"id": str(user.id)}`` — and
nothing else (no email / username / ip_address). The ``set_request_user`` helper
is the single seam; this module asserts both the helper and its wiring inside the
auth dependency.

The Sentry boundary (``sentry_sdk.set_user``) is monkeypatched to a recorder, so
no real SDK scope is touched and no network call is made.
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

_USER_ID = uuid.UUID("11111111-1111-1111-1111-111111111111")


class _SetUserRecorder:
    """Records payloads passed to ``sentry_sdk.set_user``."""

    def __init__(self) -> None:
        self.payloads: list[Any] = []

    def __call__(self, payload: Any) -> None:
        self.payloads.append(payload)


@pytest.fixture()
def set_user_recorder(monkeypatch: pytest.MonkeyPatch) -> _SetUserRecorder:
    rec = _SetUserRecorder()
    monkeypatch.setattr(sentry_module.sentry_sdk, "set_user", rec)
    return rec


# ---------------------------------------------------------------------------
# set_request_user helper
# ---------------------------------------------------------------------------


def test_set_request_user_sends_only_id(set_user_recorder: _SetUserRecorder) -> None:
    set_request_user(str(_USER_ID))
    assert set_user_recorder.payloads == [{"id": str(_USER_ID)}]


def test_set_request_user_payload_has_no_pii_fields(
    set_user_recorder: _SetUserRecorder,
) -> None:
    set_request_user(str(_USER_ID))
    payload = set_user_recorder.payloads[0]
    # Minimal-PII invariant: id is the ONLY key — never email/username/ip.
    assert set(payload) == {"id"}
    for forbidden in ("email", "username", "ip_address"):
        assert forbidden not in payload


# ---------------------------------------------------------------------------
# require_current_user wiring
# ---------------------------------------------------------------------------


def _known_user() -> User:
    user = User()
    user.id = _USER_ID
    user.apple_sub = "sub-set-user-test"
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


async def test_require_current_user_sets_user_with_str_id(
    set_user_recorder: _SetUserRecorder, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = _known_user()
    monkeypatch.setattr(auth_module, "require_jwt_secret", lambda: "secret")
    monkeypatch.setattr(
        auth_module,
        "verify_backend_jwt",
        lambda *, token, jwt_secret: types.SimpleNamespace(sub=_USER_ID),
    )

    returned = await auth_module.require_current_user(
        credentials=_bearer(),
        session=_FakeSession(user),  # type: ignore[arg-type]
    )

    assert returned is user
    # Sentry scope tagged with exactly {"id": str(user.id)}.
    assert set_user_recorder.payloads == [{"id": str(_USER_ID)}]
    assert set_user_recorder.payloads[0]["id"] == str(_USER_ID)


async def test_set_user_not_called_when_user_missing(
    set_user_recorder: _SetUserRecorder, monkeypatch: pytest.MonkeyPatch
) -> None:
    # A valid token with a missing user row → 403 and NO set_user (no sentinel
    # for unauthenticated/unresolved requests).
    from fastapi import HTTPException

    monkeypatch.setattr(auth_module, "require_jwt_secret", lambda: "secret")
    monkeypatch.setattr(
        auth_module,
        "verify_backend_jwt",
        lambda *, token, jwt_secret: types.SimpleNamespace(sub=_USER_ID),
    )

    with pytest.raises(HTTPException) as exc_info:
        await auth_module.require_current_user(
            credentials=_bearer(),
            session=_FakeSession(None),  # type: ignore[arg-type]
        )

    assert exc_info.value.status_code == 403
    assert set_user_recorder.payloads == []
