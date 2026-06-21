"""Integration test for the attribution *path* event persistence (Phase 4.5).

Sub-AC 3. The unit suite (``tests/unit/test_auth_referral_attribution.py``)
already proves the attribution helper's control flow with in-memory session
doubles, and ``test_referral_attributed_event_persistence.py`` proves the
repository write primitive against a live Postgres. This module closes the gap
between them: it drives the auth router's
:func:`api.routers.auth._attempt_referral_attribution` — the real attribution
path — against a live Postgres 16 and asserts the *side effect on the events
table*:

    * **success** — a valid, non-self, un-attributed referee attribution writes
      **exactly one** ``referral_attributed`` row whose JSON ``properties`` bag
      is precisely ``{referrer_id, referral_code}`` (and the ``referrer_user_id``
      link is persisted in the same committed transaction),
    * **failed / skipped attribution** — an invalid code and a self-referral
      each leave **zero** ``referral_attributed`` rows behind (the path returns
      before any event is staged, so the events table is untouched).

This is the integration-tier proof that "successful attribution invokes the
event persistence; failed attribution writes none" holds through the production
code path rather than only through the isolated repository helper.

Self-skips when neither ``DATABASE_URL_TEST`` nor ``DATABASE_URL`` is set,
matching the rest of the integration tier (run ``docker compose up -d
postgres`` + ``alembic -c apps/api/alembic.ini upgrade head`` once locally).
"""

from __future__ import annotations

import os
import secrets
import subprocess
import sys
import uuid
from pathlib import Path

import pytest
from sqlalchemy import insert, select, text
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine

from api.db.models import Event, User
from api.db.session import AsyncSession
from api.referrals.attribution_event import REFERRAL_ATTRIBUTED_EVENT_NAME
from api.routers.auth import (
    ATTRIBUTION_STATUS_ATTRIBUTED,
    ATTRIBUTION_STATUS_SKIPPED_INVALID_CODE,
    ATTRIBUTION_STATUS_SKIPPED_SELF_REFERRAL,
    _attempt_referral_attribution,
)

# ``parents[2]`` from apps/api/tests/integration/test_*.py resolves to apps/api/
# so the alembic CLI subprocess receives an absolute path regardless of pytest cwd.
_APPS_API_ROOT: Path = Path(__file__).resolve().parents[2]
_ALEMBIC_INI_PATH: Path = _APPS_API_ROOT / "alembic.ini"
_ALEMBIC_CLI_TIMEOUT_SECONDS: int = 60


async def _reset_db_and_upgrade_head(url: str) -> None:
    """Drop ``events`` + ``users`` + ``alembic_version`` and run ``alembic upgrade head``.

    ``test_alembic_upgrade_head.py`` (alphabetically prior) leaves the DB at the
    baseline revision, so we cannot assume the schema is already at head.
    Mirrors the pattern in ``test_events_model_roundtrip.py`` and
    ``test_events_and_retention_flow.py``.
    """
    setup_engine = create_async_engine(url, future=True)
    try:
        async with setup_engine.begin() as conn:
            await conn.execute(text("DROP TABLE IF EXISTS generations CASCADE"))
            await conn.execute(text("DROP TABLE IF EXISTS recipes CASCADE"))
            await conn.execute(text("DROP TABLE IF EXISTS events CASCADE"))
            await conn.execute(text("DROP TABLE IF EXISTS users CASCADE"))
            await conn.execute(text("DROP TABLE IF EXISTS alembic_version"))
    finally:
        await setup_engine.dispose()

    env = os.environ.copy()
    env["DATABASE_URL"] = url
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "alembic",
            "-c",
            str(_ALEMBIC_INI_PATH),
            "upgrade",
            "head",
        ],
        env=env,
        capture_output=True,
        text=True,
        timeout=_ALEMBIC_CLI_TIMEOUT_SECONDS,
        check=False,
    )
    if result.returncode != 0:  # pragma: no cover — exercised only on failure
        raise RuntimeError(
            f"alembic upgrade head failed (exit {result.returncode}): "
            f"{result.stdout}\n{result.stderr}"
        )


def _resolved_database_url() -> str | None:
    """Return DATABASE_URL_TEST ▸ DATABASE_URL, or None if neither set."""
    candidate = os.environ.get("DATABASE_URL_TEST") or os.environ.get("DATABASE_URL")
    if candidate is None or candidate == "":
        return None
    return candidate


_RESOLVED_URL: str | None = _resolved_database_url()
_SKIP_REASON: str = (
    "Neither DATABASE_URL_TEST nor DATABASE_URL set; skipping the "
    "attribution-path event-persistence integration test. Run `docker compose "
    "up -d postgres` + export DATABASE_URL_TEST=postgresql+asyncpg://pck:"
    "pck_dev_only@127.0.0.1:5432/pck_test and run "
    "`alembic -c apps/api/alembic.ini upgrade head` once locally."
)


async def _seed_user(
    conn: AsyncConnection,
    *,
    referral_code: str,
    referrer_user_id: uuid.UUID | None = None,
) -> uuid.UUID:
    """Insert one ``users`` row with the given code/link and return its id."""
    user_id = uuid.uuid4()
    await conn.execute(
        insert(User).values(
            id=user_id,
            apple_sub=f"apple-sub-{user_id}",
            email=None,
            email_verified=False,
            display_name=None,
            referral_code=referral_code,
            referrer_user_id=referrer_user_id,
        )
    )
    return user_id


async def _count_attribution_events(
    *, engine_url: str, referee_id: uuid.UUID
) -> list[Event]:
    """Return all ``referral_attributed`` events for ``referee_id`` (fresh read).

    Read in a brand-new session so the assertion reflects committed state, not
    the optimistic in-memory contents of the session the path wrote through.
    """
    engine = create_async_engine(engine_url, future=True)
    try:
        async with AsyncSession(engine, expire_on_commit=False) as session:
            result = await session.execute(
                select(Event)
                .where(Event.event_name == REFERRAL_ATTRIBUTED_EVENT_NAME)
                .where(Event.user_id == referee_id)
            )
            return list(result.scalars().all())
    finally:
        await engine.dispose()


async def _cleanup(*, engine_url: str, user_ids: list[uuid.UUID]) -> None:
    """Delete every event for + every seeded user (events first for the FK)."""
    engine = create_async_engine(engine_url, future=True)
    try:
        async with engine.begin() as conn:
            for user_id in user_ids:
                await conn.execute(
                    text("DELETE FROM events WHERE user_id = :id"), {"id": user_id}
                )
            # Referees first, then referrers, so the self-referential FK holds.
            for user_id in reversed(user_ids):
                await conn.execute(
                    text("DELETE FROM users WHERE id = :id"), {"id": user_id}
                )
    finally:
        await engine.dispose()


@pytest.mark.integration
@pytest.mark.skipif(_RESOLVED_URL is None, reason=_SKIP_REASON)
async def test_successful_attribution_path_writes_exactly_one_event() -> None:
    """A valid attribution writes one referral_attributed row + the link."""
    assert _RESOLVED_URL is not None
    referrer_code = secrets.token_urlsafe(6)
    referee_code = secrets.token_urlsafe(6)
    await _reset_db_and_upgrade_head(_RESOLVED_URL)
    engine = create_async_engine(_RESOLVED_URL, future=True)
    seeded: list[uuid.UUID] = []
    try:
        async with engine.begin() as conn:
            referrer_id = await _seed_user(conn, referral_code=referrer_code)
            referee_id = await _seed_user(conn, referral_code=referee_code)
            seeded.extend([referrer_id, referee_id])

        # ---- Drive the real attribution path against the live DB. The referee
        # is fetched through the session so it is a managed ORM instance, just
        # like the auth router's refetched ``user_row``.
        async with AsyncSession(engine, expire_on_commit=False) as session:
            referee = (
                await session.execute(select(User).where(User.id == referee_id))
            ).scalar_one()
            status_ = await _attempt_referral_attribution(
                session=session,
                referee=referee,
                referral_code=referrer_code,
            )
            assert status_ == ATTRIBUTION_STATUS_ATTRIBUTED
            # The link is persisted in the committed transaction.
            assert referee.referrer_user_id == referrer_id

        # ---- Exactly one event, with the precise {referrer_id, referral_code}.
        events = await _count_attribution_events(
            engine_url=_RESOLVED_URL, referee_id=referee_id
        )
        assert len(events) == 1
        event = events[0]
        assert event.event_name == REFERRAL_ATTRIBUTED_EVENT_NAME
        assert event.user_id == referee_id
        assert event.anonymous_id == str(referee_id)
        assert event.properties == {
            "referrer_id": str(referrer_id),
            "referral_code": referrer_code,
        }
    finally:
        await engine.dispose()
        await _cleanup(engine_url=_RESOLVED_URL, user_ids=seeded)


@pytest.mark.integration
@pytest.mark.skipif(_RESOLVED_URL is None, reason=_SKIP_REASON)
async def test_invalid_code_attribution_path_writes_no_event() -> None:
    """An unknown referral_code skips attribution → zero events persisted."""
    assert _RESOLVED_URL is not None
    referee_code = secrets.token_urlsafe(6)
    await _reset_db_and_upgrade_head(_RESOLVED_URL)
    engine = create_async_engine(_RESOLVED_URL, future=True)
    seeded: list[uuid.UUID] = []
    try:
        async with engine.begin() as conn:
            referee_id = await _seed_user(conn, referral_code=referee_code)
            seeded.append(referee_id)

        async with AsyncSession(engine, expire_on_commit=False) as session:
            referee = (
                await session.execute(select(User).where(User.id == referee_id))
            ).scalar_one()
            status_ = await _attempt_referral_attribution(
                session=session,
                referee=referee,
                # A code that resolves to no user — the invalid-code skip path.
                referral_code=secrets.token_urlsafe(6),
            )
            assert status_ == ATTRIBUTION_STATUS_SKIPPED_INVALID_CODE
            assert referee.referrer_user_id is None

        events = await _count_attribution_events(
            engine_url=_RESOLVED_URL, referee_id=referee_id
        )
        assert events == []
    finally:
        await engine.dispose()
        await _cleanup(engine_url=_RESOLVED_URL, user_ids=seeded)


@pytest.mark.integration
@pytest.mark.skipif(_RESOLVED_URL is None, reason=_SKIP_REASON)
async def test_self_referral_attribution_path_writes_no_event() -> None:
    """A code resolving to the signer itself skips → zero events persisted."""
    assert _RESOLVED_URL is not None
    self_code = secrets.token_urlsafe(6)
    await _reset_db_and_upgrade_head(_RESOLVED_URL)
    engine = create_async_engine(_RESOLVED_URL, future=True)
    seeded: list[uuid.UUID] = []
    try:
        async with engine.begin() as conn:
            user_id = await _seed_user(conn, referral_code=self_code)
            seeded.append(user_id)

        async with AsyncSession(engine, expire_on_commit=False) as session:
            referee = (
                await session.execute(select(User).where(User.id == user_id))
            ).scalar_one()
            status_ = await _attempt_referral_attribution(
                session=session,
                referee=referee,
                # The user's own code — the application-level self-referral guard.
                referral_code=self_code,
            )
            assert status_ == ATTRIBUTION_STATUS_SKIPPED_SELF_REFERRAL
            assert referee.referrer_user_id is None

        events = await _count_attribution_events(
            engine_url=_RESOLVED_URL, referee_id=user_id
        )
        assert events == []
    finally:
        await engine.dispose()
        await _cleanup(engine_url=_RESOLVED_URL, user_ids=seeded)
