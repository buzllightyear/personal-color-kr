"""AC16 — request_id middleware emits X-Request-ID header on every response.

Verifies that ``RequestIdMiddleware`` attaches a UUID4 value to the
``X-Request-ID`` response header on 200, 4xx, and 5xx responses. Uses
httpx.AsyncClient + ASGITransport against the app factory so the assertion
runs the real middleware stack.
"""

from __future__ import annotations

import re
from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient

from api.main import create_app
from api.middleware.request_id import REQUEST_ID_HEADER

#: Canonical UUID4 regex (lowercase hex, version nibble 4, variant nibble 8-b).
_UUID4_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
)


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    """Yield an httpx.AsyncClient bound to a fresh FastAPI app."""
    app = create_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


async def test_health_response_carries_uuid4_x_request_id(
    client: AsyncClient,
) -> None:
    """GET /v1/health returns 200 with a UUID4-shaped X-Request-ID."""
    response = await client.get("/v1/health")
    assert response.status_code == 200
    assert REQUEST_ID_HEADER in response.headers
    assert _UUID4_RE.match(response.headers[REQUEST_ID_HEADER]) is not None


async def test_unknown_route_404_carries_uuid4_x_request_id(
    client: AsyncClient,
) -> None:
    """4xx responses also carry the header (middleware runs on every path)."""
    response = await client.get("/v1/does-not-exist")
    assert response.status_code == 404
    assert REQUEST_ID_HEADER in response.headers
    assert _UUID4_RE.match(response.headers[REQUEST_ID_HEADER]) is not None


async def test_each_request_gets_a_fresh_uuid(client: AsyncClient) -> None:
    """Two consecutive requests receive distinct UUID4 values."""
    r1 = await client.get("/v1/health")
    r2 = await client.get("/v1/health")
    assert r1.headers[REQUEST_ID_HEADER] != r2.headers[REQUEST_ID_HEADER]
