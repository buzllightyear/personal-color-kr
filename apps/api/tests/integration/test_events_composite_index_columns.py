"""Integration test for the live ``(event_name, occurred_at)`` composite index.

Acceptance criterion covered
----------------------------
Phase 4.2 dispatch AC: "Composite index on (event_name, occurred_at) for
cohort time-window queries."

The companion test ``tests/unit/test_events_composite_index.py`` proves
the SQLAlchemy model declares the composite index with the correct
column order. This integration test proves the migration actually emits
DDL that produces the same composite index in the live database — by
introspecting the Postgres system catalogs (``pg_index`` joined with
``pg_attribute``) after ``alembic upgrade head``.

Why introspect ``pg_index`` rather than ``pg_indexes``?
-------------------------------------------------------
The user-facing ``pg_indexes`` view exposes the index *name* and the
human-readable ``indexdef`` string, but parsing column order out of a
string is fragile (whitespace, quoting, schema prefixes). The lower-level
``pg_index`` system catalog stores the column ordinal mapping in the
``indkey`` array (a ``smallint[]`` of ``pg_attribute.attnum`` values),
which is the canonical source of truth for index column order. Joining
``pg_index`` with ``pg_attribute`` lets us reconstruct the column-name
tuple in declaration order without any string parsing.

Why this matters for cohort queries
-----------------------------------
The dominant analytics query shape is::

    SELECT * FROM events
    WHERE event_name = :name
      AND occurred_at BETWEEN :start AND :end

Postgres can satisfy this via the composite index ONLY when
``event_name`` is the leading column. If the column order were
``(occurred_at, event_name)``, Postgres would still use the index for
the time-range scan but would have to evaluate ``event_name`` as a
filter on every matched row — degrading the cohort query from an
index-only scan to a sequential index scan. Asserting the live column
order in this integration test catches that regression even if the
migration file is rewritten to swap the column order.

Subprocess + self-skip conventions match ``test_events_migration.py``.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

# ---------------------------------------------------------------------------
# Path + revision constants (mirrors test_events_migration.py for consistency)
# ---------------------------------------------------------------------------
_APPS_API_ROOT: Path = Path(__file__).resolve().parents[2]
_ALEMBIC_INI_PATH: Path = _APPS_API_ROOT / "alembic.ini"

_EVENTS_REVISION: str = "phase_4_2_events"
_COMPOSITE_INDEX_NAME: str = "ix_events_event_name_occurred_at"
_EXPECTED_COMPOSITE_COLUMNS: tuple[str, ...] = ("event_name", "occurred_at")

_CLI_TIMEOUT_SECONDS: int = 60


def _resolved_database_url() -> str | None:
    """Resolve the test DB URL identically to ``test_events_migration.py``.

    Empty strings count as "unset" so a stray ``DATABASE_URL=`` line in
    ``.env`` cannot lure the integration test into a malformed URL.
    """
    candidate = os.environ.get("DATABASE_URL_TEST") or os.environ.get("DATABASE_URL")
    if candidate is None or candidate == "":
        return None
    return candidate


_RESOLVED_URL: str | None = _resolved_database_url()

_SKIP_REASON: str = (
    "Neither DATABASE_URL nor DATABASE_URL_TEST is set; skipping the "
    "real-Postgres integration test for the composite events index. To "
    "run it locally: `docker compose up -d postgres` then export "
    "DATABASE_URL_TEST=postgresql+asyncpg://<user>:<pass>@localhost:5432/<db>."
)


def _run_alembic_upgrade(target: str, db_url: str) -> subprocess.CompletedProcess[str]:
    """Run ``alembic -c <ini> upgrade <target>`` via the production CLI path.

    Reused from the pattern in ``test_events_migration.py``: drive
    ``alembic`` via subprocess so the test exercises the exact command
    surface used by docker-compose, CI services, and developer workflows.
    """
    env = os.environ.copy()
    env["DATABASE_URL"] = db_url
    return subprocess.run(
        [
            sys.executable,
            "-m",
            "alembic",
            "-c",
            str(_ALEMBIC_INI_PATH),
            "upgrade",
            target,
        ],
        env=env,
        capture_output=True,
        text=True,
        timeout=_CLI_TIMEOUT_SECONDS,
        check=False,
    )


async def _reset_db_to_blank(db_url: str) -> None:
    """Drop ``events`` + ``alembic_version`` so the next upgrade is deterministic.

    Both drops use ``IF EXISTS`` so a brand-new container is still a
    no-op. ``CASCADE`` on ``events`` is unnecessary (the table has no
    dependents in Phase 4.2) but harmless and matches the convention in
    the sibling integration test.
    """
    engine = create_async_engine(db_url, future=True)
    try:
        async with engine.begin() as conn:
            await conn.execute(text("DROP TABLE IF EXISTS events CASCADE"))

            await conn.execute(text("DROP TABLE IF EXISTS users CASCADE"))
            await conn.execute(text("DROP TABLE IF EXISTS alembic_version"))
    finally:
        await engine.dispose()


# ---------------------------------------------------------------------------
# Test — live composite index has both columns in the expected order
# ---------------------------------------------------------------------------
@pytest.mark.integration
@pytest.mark.skipif(_RESOLVED_URL is None, reason=_SKIP_REASON)
async def test_composite_index_in_pg_catalog_has_event_name_then_occurred_at() -> None:
    """``pg_index`` confirms ``ix_events_event_name_occurred_at`` is composite.

    Verification steps:
        1. Reset to a blank database and run ``alembic upgrade head``
           so the events migration ships its DDL into the live database.
        2. Query ``pg_index`` + ``pg_attribute`` for the composite index
           and reconstruct the column-name tuple in declaration order
           (the order encoded in ``pg_index.indkey``).
        3. Assert the reconstructed tuple equals exactly
           ``("event_name", "occurred_at")`` — both columns present,
           ``event_name`` as the leading column.

    Asserting the order matters: a column-swapped index would still
    pass the name-only check in ``test_events_migration.py``, but would
    silently degrade the cohort time-window query plan from an
    index-only scan to a sequential index scan + filter.
    """
    assert _RESOLVED_URL is not None  # narrowed by skipif but mypy --strict

    # ---- Step 1: deterministic starting state + upgrade.
    await _reset_db_to_blank(_RESOLVED_URL)
    upgrade_result = _run_alembic_upgrade("head", _RESOLVED_URL)
    assert upgrade_result.returncode == 0, (
        f"`alembic upgrade head` exited {upgrade_result.returncode}; "
        f"expected 0.\n--- stdout ---\n{upgrade_result.stdout}\n"
        f"--- stderr ---\n{upgrade_result.stderr}"
    )

    engine = create_async_engine(_RESOLVED_URL, future=True)
    try:
        async with engine.connect() as conn:
            # ---- Step 2: introspect the index column ordering.
            # Strategy: ``pg_index.indkey`` is a ``smallint[]`` containing
            # the column ordinals (``pg_attribute.attnum``) in declaration
            # order. ``unnest(...) WITH ORDINALITY`` preserves that order
            # so the resulting rows can be ORDERed by the ordinal position.
            # Joining against ``pg_attribute`` resolves each attnum back
            # to its human-readable column name.
            #
            # ``c.relname = :index_name`` filters to the composite index;
            # ``n.nspname = current_schema()`` confines the lookup to the
            # session's schema so a same-named index in another schema
            # cannot poison the assertion.
            cols_result = await conn.execute(
                text("""
                    SELECT a.attname
                    FROM pg_index i
                    JOIN pg_class c
                      ON c.oid = i.indexrelid
                    JOIN pg_namespace n
                      ON n.oid = c.relnamespace
                    JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
                      ON TRUE
                    JOIN pg_attribute a
                      ON a.attrelid = i.indrelid
                     AND a.attnum   = k.attnum
                    WHERE c.relname = :index_name
                      AND n.nspname = current_schema()
                    ORDER BY k.ord
                    """),
                {"index_name": _COMPOSITE_INDEX_NAME},
            )
            actual_columns: tuple[str, ...] = tuple(row[0] for row in cols_result.all())

        # ---- Step 3: assert exact column-name tuple in declaration order.
        assert actual_columns == _EXPECTED_COMPOSITE_COLUMNS, (
            f"Phase 4.2 cohort-query AC violated: live index "
            f"{_COMPOSITE_INDEX_NAME!r} must cover columns "
            f"{_EXPECTED_COMPOSITE_COLUMNS!r} in that exact order "
            f"(leading ``event_name`` for the equality predicate, "
            f"trailing ``occurred_at`` for the range scan); pg_index "
            f"reports {actual_columns!r}. Re-ordering the columns "
            f"silently degrades the cohort time-window query plan."
        )
    finally:
        await engine.dispose()
