"""``require_current_user`` tags the Sentry scope with the user id (Phase 7.3).

Happy-path correlation contract: when a bearer token verifies and its ``sub``
claim resolves to a ``users.id`` row, ``require_current_user`` must call
``sentry_sdk.set_user`` exactly once with ``{"id": str(user.id)}`` — the stable
internal id and nothing else (no email / username / ip_address). This asserts
the *wiring* end-to-end through the dependency (not just the
:func:`set_request_user` helper in isolation), confirming the single hook point
fires on the success path.

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

pytestmark = pytest.mark.unit

_USER_ID = uuid.UUID("22222222-2222-2222-2222-222222222222")


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


def _known_user() -> User:
    """A fully-populated user row whose PII must NOT reach Sentry."""
    user = User()
    user.id = _USER_ID
    user.apple_sub = "sub-require-current-user-set-user-test"
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


async def _resolve_user(
    recorder: _SetUserRecorder, monkeypatch: pytest.MonkeyPatch
) -> User:
    """Drive ``require_current_user`` down the verified-and-resolved path."""
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
    return user


# ---------------------------------------------------------------------------
# Happy path: set_user fires once with the correct payload
# ---------------------------------------------------------------------------


async def test_require_current_user_calls_set_user_with_str_id(
    set_user_recorder: _SetUserRecorder, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = await _resolve_user(set_user_recorder, monkeypatch)

    # Exactly one set_user call, payload is precisely {"id": str(user.id)}.
    assert set_user_recorder.payloads == [{"id": str(user.id)}]


async def test_require_current_user_set_user_called_exactly_once(
    set_user_recorder: _SetUserRecorder, monkeypatch: pytest.MonkeyPatch
) -> None:
    await _resolve_user(set_user_recorder, monkeypatch)

    # Single hook point — no per-router duplication on a successful request.
    assert len(set_user_recorder.payloads) == 1


async def test_require_current_user_set_user_id_is_stringified(
    set_user_recorder: _SetUserRecorder, monkeypatch: pytest.MonkeyPatch
) -> None:
    await _resolve_user(set_user_recorder, monkeypatch)

    payload = set_user_recorder.payloads[0]
    user_id = payload["id"]
    # The id is the stringified UUID, never the raw uuid.UUID object.
    assert isinstance(user_id, str)
    assert user_id == str(_USER_ID)


async def test_require_current_user_set_user_payload_is_id_only(
    set_user_recorder: _SetUserRecorder, monkeypatch: pytest.MonkeyPatch
) -> None:
    await _resolve_user(set_user_recorder, monkeypatch)

    payload = set_user_recorder.payloads[0]
    # Minimal-PII invariant: id is the ONLY key — never email/username/ip.
    assert set(payload) == {"id"}
    for forbidden in ("email", "username", "ip_address"):
        assert forbidden not in payload
