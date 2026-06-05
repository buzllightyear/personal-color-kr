"""``require_current_user`` never tags Sentry on an auth failure (Phase 7.3).

No-sentinel invariant (Seed-pinned): user correlation is attached at exactly one
seam — *after* the bearer token verifies **and** the ``users.id`` row resolves.
Every path that fails before that point must reach its HTTP error with **zero**
``sentry_sdk.set_user`` calls; there is no sentinel "anonymous" user.

This module asserts the negative across all four failure surfaces of
``require_current_user``:

    * missing ``Authorization`` header        → 401, no set_user
    * non-bearer scheme                        → 401, no set_user
    * JWT verification error                   → 401, no set_user
    * valid token but ``users.id`` row absent  → 403, no set_user

A positive control (valid token + resolvable row) confirms the recorder is wired
correctly, so the negative assertions cannot pass vacuously.

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

_USER_ID = uuid.UUID("44444444-4444-4444-4444-444444444444")


class _SetUserRecorder:
    """Records every payload passed to ``sentry_sdk.set_user``."""

    def __init__(self) -> None:
        self.payloads: list[Any] = []

    def __call__(self, payload: Any) -> None:
        self.payloads.append(payload)


@pytest.fixture()
def set_user_recorder(monkeypatch: pytest.MonkeyPatch) -> _SetUserRecorder:
    """Patch the ``sentry_sdk.set_user`` boundary with an in-memory recorder."""
    rec = _SetUserRecorder()
    monkeypatch.setattr(sentry_module.sentry_sdk, "set_user", rec)
    return rec


class _FakeResult:
    """Stands in for the SQLAlchemy ``Result`` returned by ``session.execute``."""

    def __init__(self, user: Any | None) -> None:
        self._user = user

    def scalar_one_or_none(self) -> Any | None:
        return self._user


class _StubSession:
    """A session whose ``execute`` yields a preconfigured row (or ``None``)."""

    def __init__(self, user: Any | None) -> None:
        self._user = user

    async def execute(self, _statement: Any) -> _FakeResult:
        return _FakeResult(self._user)


class _ExplodingSession:
    """A session whose ``execute`` must never be reached on a pre-DB failure."""

    async def execute(self, _statement: Any) -> _FakeResult:  # pragma: no cover
        raise AssertionError("session.execute reached on a failed auth path")


def _bearer(token: str = "valid-token", scheme: str = "Bearer") -> Any:
    from fastapi.security import HTTPAuthorizationCredentials

    return HTTPAuthorizationCredentials(scheme=scheme, credentials=token)


# ---------------------------------------------------------------------------
# Positive control: successful auth DOES tag Sentry with the id-only payload.
# Guards against vacuous negatives — if set_user were never wired, the failure
# tests below would pass for the wrong reason.
# ---------------------------------------------------------------------------


async def test_set_user_called_once_on_successful_auth(
    set_user_recorder: _SetUserRecorder, monkeypatch: pytest.MonkeyPatch
) -> None:
    class _Claims:
        sub = _USER_ID

    class _User:
        id = _USER_ID

    monkeypatch.setattr(auth_module, "require_jwt_secret", lambda: "secret")
    monkeypatch.setattr(
        auth_module,
        "verify_backend_jwt",
        lambda *, token, jwt_secret: _Claims(),
    )

    user = await auth_module.require_current_user(
        credentials=_bearer(),
        session=_StubSession(_User()),  # type: ignore[arg-type]
    )

    assert user.id == _USER_ID
    assert set_user_recorder.payloads == [{"id": str(_USER_ID)}]


# ---------------------------------------------------------------------------
# Missing header → 401, no set_user.
# ---------------------------------------------------------------------------


async def test_no_set_user_when_authorization_header_missing(
    set_user_recorder: _SetUserRecorder, monkeypatch: pytest.MonkeyPatch
) -> None:
    from fastapi import HTTPException

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
    assert exc_info.value.detail == "invalid_authorization"
    assert set_user_recorder.payloads == []


# ---------------------------------------------------------------------------
# Non-bearer scheme → 401, no set_user.
# ---------------------------------------------------------------------------


async def test_no_set_user_when_scheme_is_not_bearer(
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
    assert exc_info.value.detail == "invalid_authorization"
    assert set_user_recorder.payloads == []


# ---------------------------------------------------------------------------
# JWT verification error → 401, no set_user.
# ---------------------------------------------------------------------------


async def test_no_set_user_when_jwt_verification_fails(
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
    assert set_user_recorder.payloads == []


# ---------------------------------------------------------------------------
# Valid token but the referenced ``users.id`` row is gone → 403, no set_user.
# This is the post-verification failure surface: the token decodes, but the row
# does not resolve, so correlation must still be skipped (no sentinel user).
# ---------------------------------------------------------------------------


async def test_no_set_user_when_user_row_missing(
    set_user_recorder: _SetUserRecorder, monkeypatch: pytest.MonkeyPatch
) -> None:
    from fastapi import HTTPException

    class _Claims:
        sub = _USER_ID

    monkeypatch.setattr(auth_module, "require_jwt_secret", lambda: "secret")
    monkeypatch.setattr(
        auth_module,
        "verify_backend_jwt",
        lambda *, token, jwt_secret: _Claims(),
    )

    with pytest.raises(HTTPException) as exc_info:
        await auth_module.require_current_user(
            credentials=_bearer(),
            session=_StubSession(None),  # type: ignore[arg-type]
        )

    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == "user_not_found"
    assert set_user_recorder.payloads == []
