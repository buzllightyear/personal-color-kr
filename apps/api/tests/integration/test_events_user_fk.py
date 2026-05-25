"""Integration test for the ``events.user_id`` FK behavior (Phase 4.3 AC 13/14).

Verifies the two FK invariants Phase 4.3 ships:

* ``ON DELETE SET NULL``: deleting a user row anonymizes their events
  (sets ``events.user_id = NULL``) without dropping the historical rows.
* Orphan blocking: inserting an event with a ``user_id`` that does NOT
  match an existing ``users.id`` raises a foreign-key violation.

Both tests require a live Postgres 16 — they self-skip when neither
``DATABASE_URL_TEST`` nor ``DATABASE_URL`` is set.
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import insert, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import create_async_engine

from api.db.models import Event, User


def _resolved_database_url() -> str | None:
    """Return DATABASE_URL_TEST ▸ DATABASE_URL, or None if neither set."""
    candidate = os.environ.get("DATABASE_URL_TEST") or os.environ.get("DATABASE_URL")
    if candidate is None or candidate == "":
        return None
    return candidate


_RESOLVED_URL: str | None = _resolved_database_url()
_SKIP_REASON: str = (
    "Neither DATABASE_URL_TEST nor DATABASE_URL set; skipping the FK "
    "integration test. Run `docker compose up -d postgres` + export "
    "DATABASE_URL_TEST=postgresql+asyncpg://pck:pck_dev_only@127.0.0.1:5432/pck_test "
    "and run `alembic -c apps/api/alembic.ini upgrade head` once locally."
)


@pytest.mark.integration
@pytest.mark.skipif(_RESOLVED_URL is None, reason=_SKIP_REASON)
async def test_deleting_user_sets_event_user_id_null() -> None:
    """SET NULL: deleting a user anonymizes their events."""
    assert _RESOLVED_URL is not None
    engine = create_async_engine(_RESOLVED_URL, future=True)
    try:
        async with engine.begin() as conn:
            # ---- 1. Insert a user.
            user_id = uuid.uuid4()
            await conn.execute(
                insert(User).values(
                    id=user_id,
                    apple_sub=f"apple-sub-fk-test-{user_id}",
                    email=None,
                    email_verified=False,
                    display_name=None,
                )
            )
            # ---- 2. Insert an event referencing that user.
            event_id = uuid.uuid4()
            await conn.execute(
                insert(Event).values(
                    id=event_id,
                    anonymous_id="anon-fk-test",
                    event_name="test.fk_set_null",
                    properties={},
                    occurred_at=datetime.now(timezone.utc),
                    user_id=user_id,
                )
            )
            # ---- 3. Delete the user. SET NULL fires automatically.
            await conn.execute(
                text("DELETE FROM users WHERE id = :id"), {"id": user_id}
            )
            # ---- 4. Verify: the event row still exists, with user_id NULL.
            result = await conn.execute(select(Event).where(Event.id == event_id))
            event_row = result.scalar_one()
            assert event_row is not None
            assert event_row.user_id is None, (
                f"events.user_id must be NULL after user delete; "
                f"got {event_row.user_id!r}"
            )
            # Cleanup.
            await conn.execute(
                text("DELETE FROM events WHERE id = :id"), {"id": event_id}
            )
    finally:
        await engine.dispose()


@pytest.mark.integration
@pytest.mark.skipif(_RESOLVED_URL is None, reason=_SKIP_REASON)
async def test_inserting_event_with_unknown_user_id_raises_fk_violation() -> None:
    """ORPHAN: inserting an event with a non-existent user_id is blocked."""
    assert _RESOLVED_URL is not None
    engine = create_async_engine(_RESOLVED_URL, future=True)
    try:
        nonexistent_user_id = uuid.uuid4()
        event_id = uuid.uuid4()
        with pytest.raises(IntegrityError) as excinfo:
            async with engine.begin() as conn:
                await conn.execute(
                    insert(Event).values(
                        id=event_id,
                        anonymous_id="anon-fk-orphan",
                        event_name="test.fk_orphan_blocked",
                        properties={},
                        occurred_at=datetime.now(timezone.utc),
                        user_id=nonexistent_user_id,
                    )
                )
        # The exact error text varies by driver, but every Postgres FK
        # violation surfaces with ``foreign key`` or ``ForeignKey`` in
        # the message.
        message = str(excinfo.value).lower()
        assert "foreign key" in message or "fk_events_user_id" in message
    finally:
        await engine.dispose()
