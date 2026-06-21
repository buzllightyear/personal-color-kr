"""Unit tests for AC4 gallery: ``GET /v1/gallery`` + image streaming.

Strategy mirrors the generate-endpoint tests: ``create_app()`` with
``dependency_overrides`` for ``get_session`` (a stub returning fixed rows),
``require_current_user`` (auth-bypassed), and ``get_object_storage`` (an
in-memory store seeded with the expected bytes).

The read-time TTL filter + ownership scoping are also asserted structurally
against the query builders (compiled SQL), since the stub session does not run
the WHERE clause itself.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncGenerator
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient

from api.db.models.generation import Generation
from api.db.models.user import User
from api.db.session import get_session
from api.dependencies.auth import require_current_user
from api.dependencies.storage import get_object_storage
from api.main import create_app
from api.routers.gallery import select_active_generation, select_active_generations
from api.storage.object_storage import InMemoryObjectStorage

_BASE_URL = "http://testserver"
_NOW = datetime(2026, 6, 22, 12, 0, 0, tzinfo=timezone.utc)
_USER_ID = uuid.uuid4()


def _user() -> User:
    u = User()
    u.id = _USER_ID
    u.apple_sub = "sub"
    u.email = None
    u.email_verified = False
    u.display_name = None
    u.referral_code = "AAAAAAAA"
    u.referrer_user_id = None
    u.created_at = _NOW
    u.updated_at = _NOW
    return u


def _generation(*, recipe_id: str, key: str, created: datetime) -> Generation:
    g = Generation()
    g.id = uuid.uuid4()
    g.user_id = _USER_ID
    g.recipe_id = recipe_id
    g.result_image_key = key
    g.retry_count = 0
    g.created_at = created
    g.expires_at = created + timedelta(days=30)
    return g


class _ScalarsResult:
    def __init__(self, rows: list[Generation]) -> None:
        self._rows = rows

    def scalars(self) -> _ScalarsResult:
        return self

    def all(self) -> list[Generation]:
        return self._rows

    def scalar_one_or_none(self) -> Generation | None:
        return self._rows[0] if self._rows else None


class _Session:
    def __init__(self, rows: list[Generation]) -> None:
        self._rows = rows

    async def execute(self, _stmt: Any) -> _ScalarsResult:
        return _ScalarsResult(self._rows)


def _build_app(rows: list[Generation], storage: InMemoryObjectStorage) -> Any:
    app = create_app()
    session = _Session(rows)

    async def _sess() -> AsyncGenerator[_Session, None]:
        yield session

    app.dependency_overrides[get_session] = _sess
    app.dependency_overrides[require_current_user] = _user
    app.dependency_overrides[get_object_storage] = lambda: storage
    return app


# ---------------------------------------------------------------------------
# GET /v1/gallery
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_gallery_lists_items() -> None:
    rows = [
        _generation(recipe_id="r-002", key="k2", created=_NOW),
        _generation(recipe_id="r-001", key="k1", created=_NOW - timedelta(hours=1)),
    ]
    app = _build_app(rows, InMemoryObjectStorage())
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url=_BASE_URL
    ) as client:
        resp = await client.get("/v1/gallery")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 2
    assert [item["recipe_id"] for item in body["items"]] == ["r-002", "r-001"]
    assert body["items"][0]["generation_id"] == str(rows[0].id)
    # The object-storage key is never exposed in the public surface.
    assert "result_image_key" not in body["items"][0]


@pytest.mark.asyncio
async def test_gallery_empty_is_ok() -> None:
    app = _build_app([], InMemoryObjectStorage())
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url=_BASE_URL
    ) as client:
        resp = await client.get("/v1/gallery")
    assert resp.status_code == 200
    assert resp.json() == {"items": [], "total": 0}


@pytest.mark.asyncio
async def test_gallery_requires_auth() -> None:
    app = _build_app([], InMemoryObjectStorage())
    app.dependency_overrides.pop(require_current_user, None)
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url=_BASE_URL
    ) as client:
        resp = await client.get("/v1/gallery")
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# GET /v1/gallery/{id}/image
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_gallery_image_streams_bytes() -> None:
    row = _generation(recipe_id="r-001", key="k1", created=_NOW)
    storage = InMemoryObjectStorage()
    storage.put("k1", b"\x89PNG-watermarked", "image/png")
    app = _build_app([row], storage)
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url=_BASE_URL
    ) as client:
        resp = await client.get(f"/v1/gallery/{row.id}/image")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/png"
    assert resp.content == b"\x89PNG-watermarked"


@pytest.mark.asyncio
async def test_gallery_image_404_when_not_found() -> None:
    # Empty rows → the ownership/expiry query matches nothing → 404.
    app = _build_app([], InMemoryObjectStorage())
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url=_BASE_URL
    ) as client:
        resp = await client.get(f"/v1/gallery/{uuid.uuid4()}/image")
    assert resp.status_code == 404
    assert resp.json()["detail"] == "generation_not_found"


@pytest.mark.asyncio
async def test_gallery_image_404_when_object_missing() -> None:
    # Row exists but the storage object was swept → image_not_found 404.
    row = _generation(recipe_id="r-001", key="absent", created=_NOW)
    app = _build_app([row], InMemoryObjectStorage())  # storage empty
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url=_BASE_URL
    ) as client:
        resp = await client.get(f"/v1/gallery/{row.id}/image")
    assert resp.status_code == 404
    assert resp.json()["detail"] == "image_not_found"


# ---------------------------------------------------------------------------
# Query builders — TTL filter + ownership scoping (structural)
# ---------------------------------------------------------------------------


def test_list_query_filters_user_expiry_and_orders() -> None:
    sql = str(select_active_generations(_USER_ID, _NOW))
    assert "generations.user_id =" in sql
    assert "generations.expires_at >" in sql
    assert "ORDER BY generations.created_at DESC" in sql


def test_single_query_filters_id_user_and_expiry() -> None:
    sql = str(select_active_generation(uuid.uuid4(), _USER_ID, _NOW))
    assert "generations.id =" in sql
    assert "generations.user_id =" in sql
    assert "generations.expires_at >" in sql
