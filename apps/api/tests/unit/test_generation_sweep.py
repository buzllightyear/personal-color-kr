"""Unit tests for the expired-generation TTL sweep (AC4).

Drives :func:`delete_expired_generations` with a stub session (returning a
fixed set of expired rows + recording deletes/commits) and an in-memory store
seeded with the rows' objects. Asserts the objects + rows are reclaimed and the
count is returned. A no-expired-rows case asserts the sweep is a cheap no-op.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest

from api.db.models.generation import Generation
from api.services.generation_sweep import delete_expired_generations
from api.storage.object_storage import InMemoryObjectStorage

_NOW = datetime(2026, 6, 22, 12, 0, 0, tzinfo=timezone.utc)


def _expired_row(key: str) -> Generation:
    g = Generation()
    g.id = uuid.uuid4()
    g.user_id = uuid.uuid4()
    g.recipe_id = "r-001"
    g.result_image_key = key
    g.retry_count = 0
    g.created_at = _NOW - timedelta(days=40)
    g.expires_at = _NOW - timedelta(days=10)  # already expired
    return g


class _ScalarsResult:
    def __init__(self, rows: list[Generation]) -> None:
        self._rows = rows

    def scalars(self) -> _ScalarsResult:
        return self

    def all(self) -> list[Generation]:
        return self._rows


class _SweepSession:
    def __init__(self, rows: list[Generation]) -> None:
        self._rows = rows
        self.deleted: list[Generation] = []
        self.commits = 0

    async def execute(self, _stmt: Any) -> _ScalarsResult:
        return _ScalarsResult(self._rows)

    async def delete(self, instance: Any) -> None:
        self.deleted.append(instance)

    async def commit(self) -> None:
        self.commits += 1


@pytest.mark.asyncio
async def test_sweep_deletes_rows_and_objects() -> None:
    rows = [_expired_row("k1"), _expired_row("k2")]
    storage = InMemoryObjectStorage()
    storage.put("k1", b"a", "image/png")
    storage.put("k2", b"b", "image/png")
    session = _SweepSession(rows)

    deleted = await delete_expired_generations(session, storage, _NOW)

    assert deleted == 2
    assert session.deleted == rows
    assert session.commits == 1
    # Both objects reclaimed from storage.
    for key in ("k1", "k2"):
        with pytest.raises(Exception):
            storage.get(key)


@pytest.mark.asyncio
async def test_sweep_no_expired_rows_is_noop() -> None:
    session = _SweepSession([])
    deleted = await delete_expired_generations(session, InMemoryObjectStorage(), _NOW)
    assert deleted == 0
    assert session.deleted == []
    # No commit when nothing was swept.
    assert session.commits == 0


@pytest.mark.asyncio
async def test_sweep_continues_when_object_delete_fails() -> None:
    """A storage delete failure is logged but the row is still removed."""

    class _FailingStorage(InMemoryObjectStorage):
        def delete(self, key: str) -> None:
            from api.storage.object_storage import ObjectStorageError

            raise ObjectStorageError("delete boom")

    rows = [_expired_row("k1")]
    session = _SweepSession(rows)
    deleted = await delete_expired_generations(session, _FailingStorage(), _NOW)
    assert deleted == 1
    assert session.deleted == rows
    assert session.commits == 1
