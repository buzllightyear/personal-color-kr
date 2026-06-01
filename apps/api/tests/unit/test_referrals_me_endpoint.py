"""Endpoint tests for ``GET /v1/referrals/me`` (Phase 4.5 Sub-AC 4).

Exercises the route handler over the full ASGI app via httpx, covering
*both* auth paths the Seed pins:

    * **200 (authenticated)** — ``require_current_user`` is overridden with
      a deterministic in-memory :class:`User` carrying a fixed
      ``referral_code``; ``get_session`` is overridden with a fake session
      whose ``execute(...).scalar_one()`` returns a known referee count. The
      handler must echo the code, the *server-assembled* share URL
      (``REFERRAL_BASE_URL`` + ``/r/`` + code — the single source of truth
      lives server-side), and the live ``friend_used_count``.
    * **401 (unauthenticated)** — the conftest auto-stub for
      ``require_current_user`` is cleared so the REAL dependency runs and
      401s on the missing ``Authorization`` header. The handler body never
      executes (no DB round-trip), so no session override is needed.

The 200 path uses ``monkeypatch.setenv("REFERRAL_BASE_URL", ...)`` so the
server-side share-URL builder resolves a deterministic base — proving the
URL is assembled by the server, never by the client.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient

from api.db.models.user import User
from api.db.session import get_session
from api.dependencies.auth import require_current_user
from api.main import create_app

_USER_ID = uuid.UUID("22222222-2222-2222-2222-222222222222")
_REFERRAL_CODE = "aB3dEf7h"
_REFERRAL_BASE_URL = "https://pcolor.example"
_FRIEND_USED_COUNT = 4


class _CountResult:
    """Stand-in for the SQLAlchemy ``Result`` of a ``SELECT COUNT(*)``."""

    def __init__(self, count: int) -> None:
        self._count = count

    def scalar_one(self) -> int:
        return self._count


class _FakeSession:
    """Minimal AsyncSession stand-in returning a fixed referee count.

    ``count_attributed_referees`` issues a single ``session.execute(stmt)``
    and reads ``result.scalar_one()`` — this double satisfies exactly that
    shape without a real Postgres connection.
    """

    def __init__(self, count: int) -> None:
        self._count = count

    async def execute(self, *args: Any, **kwargs: Any) -> _CountResult:
        return _CountResult(self._count)


def _known_user() -> User:
    """Return a deterministic in-memory user with a fixed referral code."""
    user = User()
    user.id = _USER_ID
    user.apple_sub = "sub-referrals-me-test"
    user.email = None
    user.email_verified = False
    user.display_name = None
    user.referral_code = _REFERRAL_CODE
    user.referrer_user_id = None
    now = datetime.now(timezone.utc)
    user.created_at = now
    user.updated_at = now
    return user


@pytest.mark.unit
async def test_get_referrals_me_returns_200_with_assembled_response(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Authenticated request returns the code, server share URL, and count."""
    monkeypatch.setenv("REFERRAL_BASE_URL", _REFERRAL_BASE_URL)

    app = create_app()
    fake = _FakeSession(_FRIEND_USED_COUNT)

    async def _override_session() -> AsyncIterator[_FakeSession]:
        yield fake

    app.dependency_overrides[require_current_user] = _known_user
    app.dependency_overrides[get_session] = _override_session

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        response = await client.get("/v1/referrals/me")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body == {
        "referral_code": _REFERRAL_CODE,
        # The server assembled the URL: REFERRAL_BASE_URL + /r/ + code.
        "share_url": f"{_REFERRAL_BASE_URL}/r/{_REFERRAL_CODE}",
        "friend_used_count": _FRIEND_USED_COUNT,
    }


@pytest.mark.unit
async def test_get_referrals_me_requires_authentication() -> None:
    """Anonymous request (no bearer token) returns 401, body never runs."""
    # Clear the conftest auto-stub so the REAL require_current_user runs and
    # 401s because no Authorization header is supplied. ``get_session`` is a
    # sub-dependency of ``require_current_user`` (FastAPI resolves it first),
    # so it is overridden with a fake to avoid touching a real engine — the
    # 401 still fires on the missing credentials before the handler body runs.
    app = create_app()
    app.dependency_overrides.pop(require_current_user, None)
    fake = _FakeSession(0)

    async def _override_session() -> AsyncIterator[_FakeSession]:
        yield fake

    app.dependency_overrides[get_session] = _override_session

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        response = await client.get("/v1/referrals/me")

    assert response.status_code == 401, response.text
