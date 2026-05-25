"""Integration test for the user-upsert display_name preservation (AC 16).

Verifies the Seed-pinned invariant: when a user signs in for the second
time and the request body omits ``full_name`` (Apple's normal re-auth
shape — Apple only ships ``full_name`` on the *first* authorization),
the upsert MUST preserve the existing ``display_name`` rather than
overwriting it to NULL.

Test strategy:

1. Stub the Apple verifier so we don't need a real Apple ID token.
2. POST `/v1/auth/sign-in-with-apple` with ``full_name="First Last"``.
3. POST `/v1/auth/sign-in-with-apple` again with ``full_name=None``.
4. Re-fetch the row and assert ``display_name == "First Last"``.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

# Set required env vars before importing api.main.
os.environ.setdefault("JWT_SECRET", "test-secret-for-upsert-integration")
os.environ.setdefault("APPLE_BUNDLE_ID", "com.personalcolorkr.app.test")

from api.auth.apple_verifier import VerifiedAppleToken  # noqa: E402
from api.main import create_app  # noqa: E402
from api.routers.auth import get_jwks_client_dependency  # noqa: E402


def _resolved_database_url() -> str | None:
    candidate = os.environ.get("DATABASE_URL_TEST") or os.environ.get("DATABASE_URL")
    if candidate is None or candidate == "":
        return None
    return candidate


_RESOLVED_URL: str | None = _resolved_database_url()
_SKIP_REASON: str = (
    "Neither DATABASE_URL_TEST nor DATABASE_URL set; skipping the upsert "
    "preservation integration test."
)


class _StubJwksClient:
    """No-op JWKS client — the verifier is also stubbed so this is never called."""

    async def get_keys(self) -> dict[str, object]:  # pragma: no cover
        return {}


@pytest.fixture
async def client(monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[AsyncClient]:
    """FastAPI app with a stub Apple verifier — every sign-in returns a fixed sub."""
    apple_sub = f"apple-sub-upsert-{uuid.uuid4()}"

    async def _stub_verify(*, identity_token: str, apple_bundle_id: str, jwks_client):
        return VerifiedAppleToken(
            sub=apple_sub,
            email="user@example.com",
            email_verified=True,
        )

    monkeypatch.setattr("api.routers.auth.verify_apple_id_token", _stub_verify)

    app = create_app()
    app.dependency_overrides[get_jwks_client_dependency] = lambda: _StubJwksClient()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # Attach apple_sub onto the client so the test can find it later
        # for cleanup.
        ac._test_apple_sub = apple_sub  # type: ignore[attr-defined]
        yield ac


@pytest.mark.integration
@pytest.mark.skipif(_RESOLVED_URL is None, reason=_SKIP_REASON)
async def test_re_auth_with_none_full_name_preserves_display_name(
    client: AsyncClient,
) -> None:
    """Sign in twice — second call with ``full_name=None`` must preserve name."""
    assert _RESOLVED_URL is not None

    # ---- Sign in #1 with display_name supplied.
    response_1 = await client.post(
        "/v1/auth/sign-in-with-apple",
        json={
            "identity_token": "stubbed-by-monkeypatch",
            "full_name": "First Last",
            "email": "user@example.com",
        },
    )
    assert response_1.status_code == 200, response_1.text
    body_1 = response_1.json()
    assert body_1["user"]["display_name"] == "First Last"

    # ---- Sign in #2 with no display_name (Apple's normal re-auth shape).
    response_2 = await client.post(
        "/v1/auth/sign-in-with-apple",
        json={
            "identity_token": "stubbed-by-monkeypatch",
            "full_name": None,
            "email": None,
        },
    )
    assert response_2.status_code == 200, response_2.text
    body_2 = response_2.json()
    assert body_2["user"]["display_name"] == "First Last", (
        f"display_name must survive a re-auth with full_name=None; "
        f"got {body_2['user']['display_name']!r}"
    )

    # ---- Cleanup: delete the test user (cascades events.user_id to NULL).
    apple_sub: str = client._test_apple_sub  # type: ignore[attr-defined]
    engine = create_async_engine(_RESOLVED_URL, future=True)
    try:
        async with engine.begin() as conn:
            await conn.execute(
                text("DELETE FROM users WHERE apple_sub = :s"), {"s": apple_sub}
            )
    finally:
        await engine.dispose()
