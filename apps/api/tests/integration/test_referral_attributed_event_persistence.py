"""Integration test for ``insert_referral_attributed_event`` (Phase 4.5).

Verifies the referral-attribution persistence helper against a live
Postgres 16: seed a referee ``users`` row (the ``events.user_id`` FK requires
it), call
:func:`api.db.repositories.events_repository.insert_referral_attributed_event`,
commit, then re-select the row in a fresh session and assert it exists with the
canonical ``referral_attributed`` ``event_name`` and the exact
``{referrer_id, referral_code}`` ``properties`` bag.

Self-skips when neither ``DATABASE_URL_TEST`` nor ``DATABASE_URL`` is set,
matching the rest of the integration tier (run ``docker compose up -d
postgres`` + ``alembic -c apps/api/alembic.ini upgrade head`` once locally).
"""

from __future__ import annotations

import os
import secrets
import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import insert, select, text
from sqlalchemy.ext.asyncio import create_async_engine

from api.db.models import Event, User
from api.db.repositories.events_repository import insert_referral_attributed_event
from api.db.session import AsyncSession


def _resolved_database_url() -> str | None:
    """Return DATABASE_URL_TEST ▸ DATABASE_URL, or None if neither set."""
    candidate = os.environ.get("DATABASE_URL_TEST") or os.environ.get("DATABASE_URL")
    if candidate is None or candidate == "":
        return None
    return candidate


_RESOLVED_URL: str | None = _resolved_database_url()
_SKIP_REASON: str = (
    "Neither DATABASE_URL_TEST nor DATABASE_URL set; skipping the "
    "referral_attributed persistence integration test. Run `docker compose up "
    "-d postgres` + export DATABASE_URL_TEST=postgresql+asyncpg://pck:"
    "pck_dev_only@127.0.0.1:5432/pck_test and run "
    "`alembic -c apps/api/alembic.ini upgrade head` once locally."
)


@pytest.mark.integration
@pytest.mark.skipif(_RESOLVED_URL is None, reason=_SKIP_REASON)
async def test_insert_referral_attributed_event_persists_and_round_trips() -> None:
    """The helper persists a row that re-selects with the right name + props."""
    assert _RESOLVED_URL is not None
    engine = create_async_engine(_RESOLVED_URL, future=True)
    referee_id = uuid.uuid4()
    referral_code = secrets.token_urlsafe(6)
    referrer_id = uuid.uuid4()
    occurred_at = datetime(2026, 3, 15, 8, 30, 45, tzinfo=timezone.utc)
    inserted_event_id: uuid.UUID | None = None
    try:
        # ---- Seed the referee row (events.user_id FK requires it to exist).
        async with engine.begin() as conn:
            await conn.execute(
                insert(User).values(
                    id=referee_id,
                    apple_sub=f"apple-sub-{referee_id}",
                    email=None,
                    email_verified=False,
                    display_name=None,
                    referral_code=referral_code,
                    referrer_user_id=None,
                )
            )

        # ---- Persist the referral_attributed event via the repository helper.
        async with AsyncSession(engine, expire_on_commit=False) as session:
            inserted = await insert_referral_attributed_event(
                session,
                referee_id=referee_id,
                referrer_id=referrer_id,
                referral_code=referral_code,
                occurred_at=occurred_at,
            )
            inserted_event_id = inserted.id
            await session.commit()

        # ---- Re-select in a fresh session: the row exists with the right shape.
        async with AsyncSession(engine, expire_on_commit=False) as session:
            result = await session.execute(
                select(Event).where(Event.id == inserted_event_id)
            )
            row = result.scalar_one()

        assert row.event_name == "referral_attributed"
        assert row.properties == {
            "referrer_id": str(referrer_id),
            "referral_code": referral_code,
        }
        assert row.user_id == referee_id
        assert row.anonymous_id == str(referee_id)
        assert row.occurred_at == occurred_at
    finally:
        # Clean up the seeded event + user (event first; it FKs into users).
        async with engine.begin() as conn:
            if inserted_event_id is not None:
                await conn.execute(
                    text("DELETE FROM events WHERE id = :id"),
                    {"id": inserted_event_id},
                )
            await conn.execute(
                text("DELETE FROM users WHERE id = :id"), {"id": referee_id}
            )
        await engine.dispose()
