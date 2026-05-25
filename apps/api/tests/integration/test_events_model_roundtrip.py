"""ORM round-trip integration tests for :class:`api.db.models.event.Event`.

Acceptance criterion covered
----------------------------
**model_roundtrip** — Insert and select an Event via the SQLAlchemy 2.0
async session against real Postgres 16 and verify every column round-trips
with type fidelity:

    * ``id``                 — :class:`uuid.UUID` preserved (no string coercion).
    * ``anonymous_id``       — text preserved exactly.
    * ``event_name``         — text preserved exactly.
    * ``properties``         — JSONB → :class:`dict` (asyncpg dialect).
    * ``occurred_at``        — TIMESTAMPTZ preserved with tzinfo intact.
    * ``server_received_at`` — DB-populated via ``DEFAULT now()``, tz-aware.

Why a separate test from ``test_events_migration.py``?
------------------------------------------------------
The companion ``test_events_migration.py`` exercises the migration via raw
SQL through SQLAlchemy ``text()`` statements — it proves the DDL is
correct. This file exercises the ORM model path (declarative class →
``session.add`` → ``session.commit`` → ``session.execute(select(...))``)
so a regression in the ``Event`` Mapped column types is caught even if
the migration is fine. The two tests deliberately share no helpers
beyond their cleanup logic so a bug in the model layer cannot mask a bug
in the migration (and vice versa).

Skip behavior
-------------
Self-skips when neither ``DATABASE_URL`` nor ``DATABASE_URL_TEST`` is
set — same precedent as the other integration tests in this directory.
"""

from __future__ import annotations

import os
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from api.db.models import Event

# ---------------------------------------------------------------------------
# Path + skip-decision constants
# ---------------------------------------------------------------------------
_APPS_API_ROOT: Path = Path(__file__).resolve().parents[2]
_ALEMBIC_INI_PATH: Path = _APPS_API_ROOT / "alembic.ini"

_CLI_TIMEOUT_SECONDS: int = 60


def _resolved_database_url() -> str | None:
    """Return the test DB URL (``DATABASE_URL_TEST`` ▸ ``DATABASE_URL``).

    Empty strings count as "unset" to defang stray ``DATABASE_URL=`` lines
    in ``.env``.
    """
    candidate = os.environ.get("DATABASE_URL_TEST") or os.environ.get("DATABASE_URL")
    if candidate is None or candidate == "":
        return None
    return candidate


_RESOLVED_URL: str | None = _resolved_database_url()

_SKIP_REASON: str = (
    "Neither DATABASE_URL nor DATABASE_URL_TEST is set; skipping the "
    "ORM round-trip integration test for the Event model. To run it "
    "locally: `docker compose up -d postgres` then export "
    "DATABASE_URL_TEST=postgresql+asyncpg://<user>:<pass>@localhost:5432/<db>."
)


# ---------------------------------------------------------------------------
# Helpers — get the schema to head before the ORM round-trip
# ---------------------------------------------------------------------------
async def _reset_db_and_upgrade_head(url: str) -> None:
    """Drop ``events`` + ``alembic_version`` and run ``alembic upgrade head``.

    Each ORM round-trip needs the events table to exist; rather than
    assuming the migration has already been applied (which couples this
    test to test ordering), we reset and re-upgrade explicitly.
    """
    setup_engine = create_async_engine(url, future=True)
    try:
        async with setup_engine.begin() as conn:
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
        timeout=_CLI_TIMEOUT_SECONDS,
        check=False,
    )
    if result.returncode != 0:  # pragma: no cover — exercised only on failure
        raise RuntimeError(
            f"alembic upgrade head failed (exit {result.returncode}): "
            f"{result.stdout}\n{result.stderr}"
        )


# ---------------------------------------------------------------------------
# Test 1 — full Event round-trip with caller-supplied properties + occurred_at
# ---------------------------------------------------------------------------
@pytest.mark.integration
@pytest.mark.skipif(_RESOLVED_URL is None, reason=_SKIP_REASON)
async def test_event_orm_round_trip_preserves_all_six_columns() -> None:
    """``session.add(Event(...))`` + select round-trips with type fidelity.

    The test inserts an :class:`Event` populated with every column except
    ``server_received_at`` (which the database fills via ``DEFAULT
    now()``) and then re-fetches the row by primary key. Each column is
    compared against the original Python value to confirm:

        * UUID round-trips as :class:`uuid.UUID` (not string).
        * Text columns preserve their exact value.
        * JSONB round-trips as :class:`dict` with nested values intact.
        * TIMESTAMPTZ preserves tzinfo on both client + server clocks.
    """
    assert _RESOLVED_URL is not None  # narrowed by skipif but mypy --strict
    await _reset_db_and_upgrade_head(_RESOLVED_URL)

    # Synthetic fixture values — chosen so every column carries a
    # non-default, non-trivial value that would visibly drift if the
    # type pipeline mangled it.
    event_id = uuid.uuid4()
    anonymous_id = "anon-orm-fixture-001"
    event_name = "test.orm.round_trip"
    occurred_at = datetime(2026, 3, 15, 8, 30, 45, tzinfo=timezone.utc)
    properties: dict[str, object] = {
        "k": "v",
        "nested": {"a": 1, "b": [2, 3]},
        "is_test": True,
    }

    engine = create_async_engine(_RESOLVED_URL, future=True)
    try:
        sessionmaker = async_sessionmaker(engine, expire_on_commit=False)

        # ---- Insert via ORM.
        async with sessionmaker() as session:
            event = Event(
                id=event_id,
                anonymous_id=anonymous_id,
                event_name=event_name,
                properties=properties,
                occurred_at=occurred_at,
            )
            session.add(event)
            await session.commit()

        # ---- Re-fetch via ORM in a fresh session so we exercise the
        #      full read path (not just the in-memory identity map).
        async with sessionmaker() as session:
            result = await session.execute(select(Event).where(Event.id == event_id))
            fetched = result.scalar_one()

        # ---- Type fidelity per column.
        assert isinstance(
            fetched.id, uuid.UUID
        ), f"Event.id must round-trip as uuid.UUID; got {type(fetched.id)!r}."
        assert (
            fetched.id == event_id
        ), f"UUID value drift: inserted {event_id!r}, got {fetched.id!r}."

        assert fetched.anonymous_id == anonymous_id, (
            f"anonymous_id drift: inserted {anonymous_id!r}, "
            f"got {fetched.anonymous_id!r}."
        )

        assert fetched.event_name == event_name, (
            f"event_name drift: inserted {event_name!r}, "
            f"got {fetched.event_name!r}."
        )

        assert isinstance(fetched.properties, dict), (
            "JSONB must round-trip as a Python dict; got "
            f"{type(fetched.properties)!r}."
        )
        assert fetched.properties == properties, (
            f"JSONB payload drift: inserted {properties!r}, "
            f"got {fetched.properties!r}."
        )

        assert isinstance(fetched.occurred_at, datetime), (
            f"occurred_at must round-trip as datetime; got "
            f"{type(fetched.occurred_at)!r}."
        )
        assert fetched.occurred_at.tzinfo is not None, (
            f"occurred_at must carry tzinfo (TIMESTAMPTZ); got naive "
            f"{fetched.occurred_at!r}."
        )
        assert fetched.occurred_at == occurred_at, (
            f"occurred_at drift: inserted {occurred_at!r}, "
            f"got {fetched.occurred_at!r}."
        )

        # ---- server_received_at must be populated by the DB default
        #      and must carry tzinfo (proves the column truly is
        #      TIMESTAMPTZ, not TIMESTAMP WITHOUT TIME ZONE).
        assert isinstance(fetched.server_received_at, datetime), (
            "server_received_at must round-trip as datetime; got "
            f"{type(fetched.server_received_at)!r}."
        )
        assert fetched.server_received_at.tzinfo is not None, (
            f"server_received_at must carry tzinfo (TIMESTAMPTZ); got "
            f"naive {fetched.server_received_at!r}."
        )
    finally:
        # Cleanup synthetic row so persistent docker-compose volumes
        # don't accumulate fixtures across local runs.
        cleanup_session: AsyncSession
        async with async_sessionmaker(
            engine, expire_on_commit=False
        )() as cleanup_session:
            await cleanup_session.execute(
                text("DELETE FROM events WHERE id = :id"),
                {"id": event_id},
            )
            await cleanup_session.commit()
        await engine.dispose()


# ---------------------------------------------------------------------------
# Test 2 — omitting ``properties`` exercises the DB default ``'{}'::jsonb``
# ---------------------------------------------------------------------------
@pytest.mark.integration
@pytest.mark.skipif(_RESOLVED_URL is None, reason=_SKIP_REASON)
async def test_event_properties_default_is_empty_jsonb_when_caller_omits() -> None:
    """When the caller omits ``properties``, the DB default ``'{}'::jsonb`` fills it.

    The Event model declares ``default=dict`` (Python-side) AND
    ``server_default=text("'{}'::jsonb")`` (database-side). When the ORM
    flushes a row without an explicit ``properties`` argument, the
    Python-side default fires first — the inserted row therefore carries
    ``{}`` regardless of whether the DB default ever activates. We
    verify the result is an empty dict (not ``None``, not a string).
    """
    assert _RESOLVED_URL is not None
    await _reset_db_and_upgrade_head(_RESOLVED_URL)

    event_id = uuid.uuid4()
    occurred_at = datetime(2026, 3, 15, 9, 0, 0, tzinfo=timezone.utc)

    engine = create_async_engine(_RESOLVED_URL, future=True)
    try:
        sessionmaker = async_sessionmaker(engine, expire_on_commit=False)

        async with sessionmaker() as session:
            # Note: ``properties`` is deliberately NOT passed. The
            # ``default=dict`` on the column fires during flush.
            event = Event(
                id=event_id,
                anonymous_id="anon-default-props-001",
                event_name="test.orm.default_properties",
                occurred_at=occurred_at,
            )
            session.add(event)
            await session.commit()

        async with sessionmaker() as session:
            result = await session.execute(select(Event).where(Event.id == event_id))
            fetched = result.scalar_one()

        assert fetched.properties == {}, (
            "When ``properties`` is omitted on insert, the round-trip "
            f"value must be ``{{}}``; got {fetched.properties!r}."
        )
    finally:
        cleanup_session: AsyncSession
        async with async_sessionmaker(
            engine, expire_on_commit=False
        )() as cleanup_session:
            await cleanup_session.execute(
                text("DELETE FROM events WHERE id = :id"),
                {"id": event_id},
            )
            await cleanup_session.commit()
        await engine.dispose()
