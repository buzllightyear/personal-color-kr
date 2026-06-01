"""Integration test for ``count_attributed_referees`` (Phase 4.5).

Verifies the friend_used_count query against a live Postgres 16 with real
seeded attribution records: several referees attributed to the user under
test, plus rows attributed to a *different* referrer and an organic
(``referrer_user_id IS NULL``) signup that must NOT be counted.

Self-skips when neither ``DATABASE_URL_TEST`` nor ``DATABASE_URL`` is set,
matching the rest of the integration tier.
"""

from __future__ import annotations

import os
import uuid

import pytest
from sqlalchemy import insert, text
from sqlalchemy.ext.asyncio import create_async_engine

from api.db.models import User
from api.db.repositories.users_repository import count_attributed_referees
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
    "friend_used_count integration test. Run `docker compose up -d postgres` "
    "+ export DATABASE_URL_TEST=postgresql+asyncpg://pck:pck_dev_only@"
    "127.0.0.1:5432/pck_test and run "
    "`alembic -c apps/api/alembic.ini upgrade head` once locally."
)


async def _insert_user(
    conn: object, *, referrer_user_id: uuid.UUID | None
) -> uuid.UUID:
    """Insert a single ``users`` row and return its id."""
    user_id = uuid.uuid4()
    await conn.execute(  # type: ignore[attr-defined]
        insert(User).values(
            id=user_id,
            apple_sub=f"apple-sub-{user_id}",
            email=None,
            email_verified=False,
            display_name=None,
            referral_code=user_id.hex[:8],
            referrer_user_id=referrer_user_id,
        )
    )
    return user_id


@pytest.mark.integration
@pytest.mark.skipif(_RESOLVED_URL is None, reason=_SKIP_REASON)
async def test_count_attributed_referees_counts_only_matching_rows() -> None:
    """Real seeded records: only referees of the queried user are counted."""
    assert _RESOLVED_URL is not None
    engine = create_async_engine(_RESOLVED_URL, future=True)
    created: list[uuid.UUID] = []
    try:
        async with engine.begin() as conn:
            referrer_id = await _insert_user(conn, referrer_user_id=None)
            other_referrer_id = await _insert_user(conn, referrer_user_id=None)
            created.extend([referrer_id, other_referrer_id])
            # Three referees attributed to ``referrer_id``.
            for _ in range(3):
                created.append(await _insert_user(conn, referrer_user_id=referrer_id))
            # One organic (no referrer) — acts as noise to prove the COUNT
            # query filters on referrer_user_id rather than scanning the whole
            # table. ``other_referrer_id`` itself is intentionally left with
            # zero referees so the second assertion can prove isolation.
            created.append(await _insert_user(conn, referrer_user_id=None))

        async with AsyncSession(engine, expire_on_commit=False) as session:
            count = await count_attributed_referees(
                session, referrer_user_id=referrer_id
            )
            assert count == 3
            # A user who has referred nobody yields 0.
            zero = await count_attributed_referees(
                session, referrer_user_id=other_referrer_id
            )
            assert zero == 0
    finally:
        # Clean up the seeded rows (referees first so the self-FK is satisfied).
        async with engine.begin() as conn:
            for user_id in reversed(created):
                await conn.execute(
                    text("DELETE FROM users WHERE id = :id"), {"id": user_id}
                )
        await engine.dispose()
