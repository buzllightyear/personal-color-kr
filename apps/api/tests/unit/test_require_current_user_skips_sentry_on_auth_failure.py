"""``set_user`` is skipped when authentication fails (Phase 7.3).

No-sentinel invariant: an unauthenticated / unresolved request must leave the
Sentry user scope untouched. ``require_current_user`` only calls
``set_request_user`` *after* the bearer token verifies and the ``users.id`` row
resolves — so every pre-resolution failure path (missing header, wrong scheme,
JWT verification error) must reach HTTP 401 with **zero** ``sentry_sdk.set_user``
calls. (The valid-token-but-missing-row 403 path is covered separately in
``test_sentry_set_user_correlation.py``.)

The Sentry boundary (``sentry_sdk.set_user``) is monkeypatched to a recorder, so
no real SDK scope is touched and no network call is made.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest

import api.dependencies.auth as auth_module
import api.observability.sentry as sentry_module
from api.auth.backend_jwt import BackendJwtError

pytestmark = pytest.mark.unit

_USER_ID = uuid.UUID("33333333-3333-3333-3333-333333333333")


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


class _FakeResult:
    def __init__(self, user: Any | None) -> None:
        self._user = user

    def scalar_one_or_none(self) -> Any | None:
        return self._user


class _ExplodingSession:
    """A session whose ``execute`` must never be reached on an auth failure."""

    async def execute(self, _statement: Any) -> _FakeResult:  # pragma: no cover
        raise AssertionError("session.execute reached on a failed auth path")


def _bearer(token: str = "valid-token", scheme: str = "Bearer") -> Any:
    from fastapi.security import HTTPAuthorizationCredentials

    return HTTPAuthorizationCredentials(scheme=scheme, credentials=token)


# ---------------------------------------------------------------------------
# JWT verification failure → 401, no set_user
# ---------------------------------------------------------------------------


async def test_set_user_not_called_when_jwt_verification_fails(
    set_user_recorder: _SetUserRecorder, monkeypatch: pytest.MonkeyPatch
) -> None:
    from fastapi import HTTPException

    def _raise_invalid(*, token: str, jwt_secret: str) -> Any:
        raise BackendJwtError(code="signature", message="bad signature")

    monkeypatch.setattr(auth_module, "require_jwt_secret", lambda: "secret")
    monkeypatch.setattr(auth_module, "verify_backend_jwt", _raise_invalid)

    with pytest.raises(HTTPException) as exc_info:
        await auth_module.require_current_user(
            credentials=_bearer(),
            session=_ExplodingSession(),  # type: ignore[arg-type]
        )

    assert exc_info.value.status_code == 401
    assert exc_info.value.detail == "invalid_authorization"
    # No sentinel for unauthenticated requests — set_user untouched.
    assert set_user_recorder.payloads == []


# ---------------------------------------------------------------------------
# Missing header → 401, no set_user
# ---------------------------------------------------------------------------


async def test_set_user_not_called_when_credentials_missing(
    set_user_recorder: _SetUserRecorder, monkeypatch: pytest.MonkeyPatch
) -> None:
    from fastapi import HTTPException

    # verify_backend_jwt must never be invoked when there is no header.
    def _unreachable(*, token: str, jwt_secret: str) -> Any:  # pragma: no cover
        raise AssertionError("verify_backend_jwt reached without credentials")

    monkeypatch.setattr(auth_module, "require_jwt_secret", lambda: "secret")
    monkeypatch.setattr(auth_module, "verify_backend_jwt", _unreachable)

    with pytest.raises(HTTPException) as exc_info:
        await auth_module.require_current_user(
            credentials=None,
            session=_ExplodingSession(),  # type: ignore[arg-type]
        )

    assert exc_info.value.status_code == 401
    assert set_user_recorder.payloads == []


# ---------------------------------------------------------------------------
# Wrong scheme → 401, no set_user
# ---------------------------------------------------------------------------


async def test_set_user_not_called_when_scheme_is_not_bearer(
    set_user_recorder: _SetUserRecorder, monkeypatch: pytest.MonkeyPatch
) -> None:
    from fastapi import HTTPException

    def _unreachable(*, token: str, jwt_secret: str) -> Any:  # pragma: no cover
        raise AssertionError("verify_backend_jwt reached with wrong scheme")

    monkeypatch.setattr(auth_module, "require_jwt_secret", lambda: "secret")
    monkeypatch.setattr(auth_module, "verify_backend_jwt", _unreachable)

    with pytest.raises(HTTPException) as exc_info:
        await auth_module.require_current_user(
            credentials=_bearer(scheme="Basic"),
            session=_ExplodingSession(),  # type: ignore[arg-type]
        )

    assert exc_info.value.status_code == 401
    assert set_user_recorder.payloads == []
