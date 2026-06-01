"""Integration test for the ``users.referrer_user_id`` self-referential FK.

Verifies the two FK invariants the Phase 4.5 referral-attribution column
ships:

* ``ON DELETE SET NULL``: deleting a referrer anonymizes the referee's
  attribution (sets ``users.referrer_user_id = NULL``) without dropping the
  referee row — referred users survive a referrer's GDPR delete.
* Orphan blocking: inserting a user whose ``referrer_user_id`` does NOT
  match an existing ``users.id`` raises a foreign-key violation.

Both tests require a live Postgres 16 — they self-skip when neither
``DATABASE_URL_TEST`` nor ``DATABASE_URL`` is set.
"""

from __future__ import annotations

import os
import uuid

import pytest
from sqlalchemy import insert, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import create_async_engine

from api.db.models import User


def _resolved_database_url() -> str | None:
    """Return DATABASE_URL_TEST ▸ DATABASE_URL, or None if neither set."""
    candidate = os.environ.get("DATABASE_URL_TEST") or os.environ.get("DATABASE_URL")
    if candidate is None or candidate == "":
        return None
    return candidate


_RESOLVED_URL: str | None = _resolved_database_url()
_SKIP_REASON: str = (
    "Neither DATABASE_URL_TEST nor DATABASE_URL set; skipping the referrer "
    "FK integration test. Run `docker compose up -d postgres` + export "
    "DATABASE_URL_TEST=postgresql+asyncpg://pck:pck_dev_only@127.0.0.1:5432/pck_test "
    "and run `alembic -c apps/api/alembic.ini upgrade head` once locally."
)


@pytest.mark.integration
@pytest.mark.skipif(_RESOLVED_URL is None, reason=_SKIP_REASON)
async def test_deleting_referrer_sets_referee_referrer_user_id_null() -> None:
    """SET NULL: deleting a referrer anonymizes the referee's attribution."""
    assert _RESOLVED_URL is not None
    engine = create_async_engine(_RESOLVED_URL, future=True)
    try:
        async with engine.begin() as conn:
            # ---- 1. Insert the referrer.
            referrer_id = uuid.uuid4()
            await conn.execute(
                insert(User).values(
                    id=referrer_id,
                    apple_sub=f"apple-sub-referrer-{referrer_id}",
                    email=None,
                    email_verified=False,
                    display_name=None,
                )
            )
            # ---- 2. Insert the referee, attributed to the referrer.
            referee_id = uuid.uuid4()
            await conn.execute(
                insert(User).values(
                    id=referee_id,
                    apple_sub=f"apple-sub-referee-{referee_id}",
                    email=None,
                    email_verified=False,
                    display_name=None,
                    referrer_user_id=referrer_id,
                )
            )
            # ---- 3. Delete the referrer. SET NULL fires automatically.
            await conn.execute(
                text("DELETE FROM users WHERE id = :id"), {"id": referrer_id}
            )
            # ---- 4. Verify: the referee row still exists, attribution NULL.
            result = await conn.execute(
                text("SELECT referrer_user_id FROM users WHERE id = :id"),
                {"id": referee_id},
            )
            row = result.fetchone()
            assert row is not None, (
                f"referee row with id={referee_id!r} must still exist after "
                f"the referrer is deleted; ON DELETE SET NULL preserves it."
            )
            assert row[0] is None, (
                f"users.referrer_user_id must be NULL after the referrer is "
                f"deleted; got {row[0]!r}."
            )
            # Cleanup.
            await conn.execute(
                text("DELETE FROM users WHERE id = :id"), {"id": referee_id}
            )
    finally:
        await engine.dispose()


@pytest.mark.integration
@pytest.mark.skipif(_RESOLVED_URL is None, reason=_SKIP_REASON)
async def test_inserting_user_with_unknown_referrer_id_raises_fk_violation() -> None:
    """ORPHAN: a user whose referrer_user_id has no matching row is blocked."""
    assert _RESOLVED_URL is not None
    engine = create_async_engine(_RESOLVED_URL, future=True)
    try:
        nonexistent_referrer_id = uuid.uuid4()
        referee_id = uuid.uuid4()
        with pytest.raises(IntegrityError) as excinfo:
            async with engine.begin() as conn:
                await conn.execute(
                    insert(User).values(
                        id=referee_id,
                        apple_sub=f"apple-sub-orphan-{referee_id}",
                        email=None,
                        email_verified=False,
                        display_name=None,
                        referrer_user_id=nonexistent_referrer_id,
                    )
                )
        message = str(excinfo.value).lower()
        assert "foreign key" in message or "fk_users_referrer_user_id" in message
    finally:
        await engine.dispose()
