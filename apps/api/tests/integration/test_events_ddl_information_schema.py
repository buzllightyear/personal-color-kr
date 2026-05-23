"""Migration-level DDL correctness via ``information_schema.columns``.

Acceptance criterion (Phase 4.2, this dispatch)
-----------------------------------------------
"Migration-level integration test introspects information_schema.columns
after alembic upgrade head to verify DDL correctness."

This module owns the single-purpose, AC-aligned verification of the
``events`` table's column-level DDL after the Phase 4.2 migration has been
applied. The companion module :mod:`tests.integration.test_events_migration`
already provides end-to-end migration coverage (existence, indexes,
alembic_version stamping, downgrade hygiene). This file deliberately
narrows its surface to ``information_schema.columns`` so that:

    1. The AC → assertion mapping is one-to-one and easy to grep
       (``rg information_schema.columns apps/api/tests/integration``).
    2. A regression in column-level DDL (a renamed column, a dropped NOT
       NULL constraint, an accidental ``DEFAULT '{}'::json`` instead of
       ``::jsonb``) surfaces here in a focused failure trace rather than
       being commingled with index / version / downgrade assertions.
    3. Future contributors who add a column (Phase 4.3+ work) update
       exactly one fixture (``_EXPECTED_COLUMN_DDL``) in this file when
       they extend the Seed contract.

DDL surface verified
--------------------
For every Seed-pinned column we check:

    * ``ordinal_position``    — declaration order matches the migration.
    * ``data_type``           — SQL-standard family (``text``, ``jsonb``,
                                ``uuid``, ``timestamp with time zone``).
    * ``udt_name``            — concrete Postgres type
                                (``text``, ``jsonb``, ``uuid``,
                                ``timestamptz``). Required to disambiguate
                                ``TIMESTAMPTZ`` from ``TIMESTAMP`` since
                                both report the same ``data_type`` family
                                on some pg metadata views.
    * ``is_nullable``         — every Seed column is ``NOT NULL``.
    * ``column_default``      — exactly two columns ship a server default:
                                ``properties`` (``'{}'::jsonb``) and
                                ``server_received_at`` (``now()``).
                                Everything else MUST report ``NULL``.

Why no SQLite / no mocks?
-------------------------
The Seed pins the test stack to real Postgres 16: ``JSONB`` does not
exist outside Postgres, and ``TIMESTAMPTZ`` semantics diverge from
SQLite's TEXT/REAL storage. A SQLite double would silently accept the
DDL and silently report wrong types via ``information_schema``-emulating
shims, masking real bugs. The module self-skips when no
``DATABASE_URL_TEST`` / ``DATABASE_URL`` is configured (matches every
other file in this directory).

Subprocess invocation of alembic
--------------------------------
The migration is driven via ``python -m alembic ... upgrade head`` rather
than the alembic Python API so the test exercises the exact command path
used by the docker-compose smoke step, the GitHub Actions
``services: postgres:`` job, and the developer's manual workflow. This
catches env-resolution / cwd-resolution regressions that a direct API
call would silently paper over.
"""

from __future__ import annotations

import os
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Optional, Tuple

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

# ---------------------------------------------------------------------------
# Path + revision constants
# ---------------------------------------------------------------------------
# ``parents[2]`` from apps/api/tests/integration/<this file> resolves to
# apps/api/ regardless of pytest cwd, so the alembic CLI invocation always
# receives an absolute alembic.ini path.
_APPS_API_ROOT: Path = Path(__file__).resolve().parents[2]
_ALEMBIC_INI_PATH: Path = _APPS_API_ROOT / "alembic.ini"

# Generous timeout — Phase 4.2 emits CREATE TABLE + two CREATE INDEX
# statements with no data backfill; realistic runtime is well under a
# second. 60s protects against a wedged asyncpg connection without
# making CI wait minutes on a hang.
_CLI_TIMEOUT_SECONDS: int = 60


def _resolved_database_url() -> str | None:
    """Return the test DB URL the integration test will exercise, or ``None``.

    Lookup order (matches every other file in this directory):

        1. ``DATABASE_URL_TEST`` — dedicated test database URL.
        2. ``DATABASE_URL``      — fallback for dev machines that have
                                    not split the two URLs yet.

    Empty strings count as "unset" so a stray ``DATABASE_URL=`` line in
    ``.env`` does not lure the integration test into a malformed URL.
    """
    candidate = os.environ.get("DATABASE_URL_TEST") or os.environ.get("DATABASE_URL")
    if candidate is None or candidate == "":
        return None
    return candidate


_RESOLVED_URL: str | None = _resolved_database_url()

_SKIP_REASON: str = (
    "Neither DATABASE_URL nor DATABASE_URL_TEST is set; skipping the "
    "real-Postgres DDL introspection test for the events migration. To "
    "run it locally: `docker compose up -d postgres` then export "
    "DATABASE_URL_TEST=postgresql+asyncpg://<user>:<pass>@127.0.0.1:5432/<db>."
)


# ---------------------------------------------------------------------------
# Seed-pinned DDL fixture
# ---------------------------------------------------------------------------
# Keys are the Seed-pinned column names in declaration order. Values are
# 5-tuples of ``(ordinal_position, data_type, udt_name, is_nullable,
# server_default_predicate)``.
#
# ``server_default_predicate`` is either:
#     * ``None``      — assert the introspected default is ``NULL``, OR
#     * ``Callable``  — assert ``predicate(default_str)`` returns True
#                       (used for ``properties``' ``'{}'::jsonb`` and
#                       ``server_received_at``'s ``now()`` which Postgres
#                       normalizes to slightly different literal strings
#                       across minor versions).
#
# This shape keeps every Seed contract value at module top so a future
# rename or type drift triggers a single fixture edit rather than
# scattered re-keyings deep in assertion bodies.
_DDLSpec = Tuple[int, str, str, str, Optional[Callable[[str], bool]]]


def _is_empty_jsonb_default(literal: str) -> bool:
    """Return True iff ``literal`` is the canonical ``'{}'::jsonb`` form.

    Postgres normalizes the ``server_default=text("'{}'::jsonb")`` we
    emit in the migration into a string of the form ``'{}'::jsonb``. We
    match case-insensitively on both the ``{}`` payload and the ``jsonb``
    cast so a Postgres minor version that surfaces the cast as
    ``::JSONB`` still satisfies the predicate.
    """
    lowered = literal.lower()
    return "{}" in literal and "jsonb" in lowered


def _is_now_default(literal: str) -> bool:
    """Return True iff ``literal`` references the SQL ``now()`` function.

    Postgres reports the ``server_default=text("now()")`` we emit in the
    migration as the literal ``now()`` (case-insensitive across versions).
    We avoid stricter equality because SQLAlchemy / Postgres are free to
    surface variants like ``NOW()`` or ``(now())`` depending on whether
    the default was parsed through ``func.now()`` or raw ``text()``.
    """
    return "now()" in literal.lower()


# Declaration order MUST match the order ``op.create_table`` lists the
# columns in apps/api/src/api/db/migrations/versions/
# 2026_01_02_0000-phase_4_2_events_create_events_table.py. Postgres
# assigns ``ordinal_position`` in DDL order, so the integers below double
# as a regression guard against an accidental column-reorder edit.
_EXPECTED_COLUMN_DDL: dict[str, _DDLSpec] = {
    "id": (1, "uuid", "uuid", "NO", None),
    "anonymous_id": (2, "text", "text", "NO", None),
    "event_name": (3, "text", "text", "NO", None),
    "properties": (4, "jsonb", "jsonb", "NO", _is_empty_jsonb_default),
    "occurred_at": (5, "timestamp with time zone", "timestamptz", "NO", None),
    "server_received_at": (
        6,
        "timestamp with time zone",
        "timestamptz",
        "NO",
        _is_now_default,
    ),
}


# ---------------------------------------------------------------------------
# Helpers — alembic CLI driver + DB state reset
# ---------------------------------------------------------------------------
def _run_alembic_upgrade_head(db_url: str) -> subprocess.CompletedProcess[str]:
    """Drive ``alembic -c <ini> upgrade head`` via subprocess.

    Wrapping the invocation in a local helper keeps every test in this
    module using the exact same argv shape, environment overlay, and
    timeout. ``check=False`` is deliberate: the caller asserts
    ``returncode`` explicitly so the assertion message can interpolate
    stdout + stderr (a richer failure signal than the default
    :class:`subprocess.CalledProcessError` traceback).
    """
    cli_env = os.environ.copy()
    cli_env["DATABASE_URL"] = db_url
    return subprocess.run(
        [
            sys.executable,
            "-m",
            "alembic",
            "-c",
            str(_ALEMBIC_INI_PATH),
            "upgrade",
            "head",
        ],
        env=cli_env,
        capture_output=True,
        text=True,
        timeout=_CLI_TIMEOUT_SECONDS,
        check=False,
    )


async def _reset_db_to_blank(db_url: str) -> None:
    """Drop ``events`` (CASCADE) and ``alembic_version`` for a clean baseline.

    The DDL introspection assertions are only meaningful if the migration
    actually ran from baseline; reusing a database that already carries
    the events table at head would let a stale, drifted schema appear
    "correct" simply because nothing changed. We drop ``events`` first
    (the ``CASCADE`` cleans up the table's two indexes alongside it) and
    then ``alembic_version`` so ``alembic upgrade head`` restamps the
    chain from scratch.

    Both drops are guarded with ``IF EXISTS`` so the first run on a
    brand-new container is a no-op rather than an error.
    """
    engine = create_async_engine(db_url, future=True)
    try:
        async with engine.begin() as conn:
            await conn.execute(text("DROP TABLE IF EXISTS events CASCADE"))
            await conn.execute(text("DROP TABLE IF EXISTS alembic_version"))
    finally:
        await engine.dispose()


# ---------------------------------------------------------------------------
# Test — information_schema.columns DDL correctness
# ---------------------------------------------------------------------------
@pytest.mark.integration
@pytest.mark.skipif(_RESOLVED_URL is None, reason=_SKIP_REASON)
async def test_alembic_upgrade_head_events_columns_match_seed_ddl_via_information_schema() -> (
    None
):
    """Introspect ``information_schema.columns`` and verify every Seed field.

    Steps
    -----
    1. Reset the test database to a blank slate (drop events + the
       alembic bookkeeping table) so the migration runs from baseline.
    2. Run ``alembic upgrade head`` via the production CLI path and
       assert exit code 0 — failures emit stdout + stderr inline so the
       developer sees the alembic diagnostic without re-running locally.
    3. Query ``information_schema.columns`` for the ``events`` table,
       projecting ``column_name``, ``ordinal_position``, ``data_type``,
       ``udt_name``, ``is_nullable``, and ``column_default`` in
       ``ordinal_position`` order.
    4. Assert the result has exactly six rows — neither an accidental
       seventh column nor a missing one (a single ``len == 6`` check
       short-circuits before per-column assertions so a structural
       regression surfaces with a clear top-level message).
    5. Assert the ordered column-name sequence matches the Seed contract.
       Asserting against the ordered tuple (rather than the set) ensures
       a future contributor cannot silently reorder columns and still
       satisfy the per-column type checks below.
    6. For each Seed-pinned column, assert ``(ordinal_position, data_type,
       udt_name, is_nullable, default)`` matches ``_EXPECTED_COLUMN_DDL``.
       The default check is split into a predicate so the test tolerates
       Postgres-side reformatting of ``'{}'::jsonb`` and ``now()`` while
       still catching the easy regression "I forgot the default entirely".
    """
    assert _RESOLVED_URL is not None  # narrowed by skipif but mypy --strict

    # Step 1 — deterministic starting state.
    await _reset_db_to_blank(_RESOLVED_URL)

    # Step 2 — run the migration via the production CLI path.
    result = _run_alembic_upgrade_head(_RESOLVED_URL)
    assert result.returncode == 0, (
        f"`alembic upgrade head` exited {result.returncode}; expected 0.\n"
        f"--- stdout ---\n{result.stdout}\n--- stderr ---\n{result.stderr}"
    )

    # Step 3 — introspect ``information_schema.columns``.
    engine = create_async_engine(_RESOLVED_URL, future=True)
    try:
        async with engine.connect() as conn:
            cols_result = await conn.execute(text("""
                    SELECT
                        column_name,
                        ordinal_position,
                        data_type,
                        udt_name,
                        is_nullable,
                        column_default
                    FROM information_schema.columns
                    WHERE table_schema = current_schema()
                      AND table_name = 'events'
                    ORDER BY ordinal_position
                    """))
            rows = cols_result.all()
    finally:
        await engine.dispose()

    # Step 4 — exactly six columns.
    assert len(rows) == 6, (
        "Phase 4.2 DDL drift: the events table must report exactly 6 "
        "columns in information_schema.columns after `alembic upgrade "
        f"head`; got {len(rows)} row(s). Raw rows: {rows!r}."
    )

    # Step 5 — ordered column-name sequence matches the Seed contract.
    actual_names_in_order: tuple[str, ...] = tuple(row[0] for row in rows)
    expected_names_in_order: tuple[str, ...] = tuple(_EXPECTED_COLUMN_DDL.keys())
    assert actual_names_in_order == expected_names_in_order, (
        "Phase 4.2 DDL drift: column declaration order in events does "
        "not match the Seed-pinned sequence. Expected (by ordinal "
        f"position): {expected_names_in_order!r}; got: "
        f"{actual_names_in_order!r}."
    )

    # Step 6 — per-column DDL contract.
    # Index the introspection result by column name for clear assertion
    # messages (vs. by ordinal position, which is opaque in a failure).
    by_name: dict[str, tuple[int, str, str, str, str | None]] = {
        row[0]: (row[1], row[2], row[3], row[4], row[5]) for row in rows
    }

    for column_name, expected in _EXPECTED_COLUMN_DDL.items():
        (
            expected_ord,
            expected_data_type,
            expected_udt,
            expected_nullable,
            expected_default_predicate,
        ) = expected
        (
            actual_ord,
            actual_data_type,
            actual_udt,
            actual_nullable,
            actual_default,
        ) = by_name[column_name]

        # --- ordinal_position
        assert actual_ord == expected_ord, (
            f"events.{column_name}: ordinal_position drift. Expected "
            f"{expected_ord}, got {actual_ord}. A reordering of CREATE "
            "TABLE columns slipped past review."
        )

        # --- data_type
        assert actual_data_type == expected_data_type, (
            f"events.{column_name}: data_type drift. Expected "
            f"{expected_data_type!r}, got {actual_data_type!r}."
        )

        # --- udt_name (concrete Postgres type)
        assert actual_udt == expected_udt, (
            f"events.{column_name}: udt_name drift. Expected "
            f"{expected_udt!r} (concrete Postgres type), got "
            f"{actual_udt!r}. This usually means a column was migrated "
            "to a SQL-standard family alias (e.g., TIMESTAMP without "
            "TIME ZONE) that loses the Seed's pinned semantics."
        )

        # --- is_nullable
        assert actual_nullable == expected_nullable, (
            f"events.{column_name}: nullability drift. Expected "
            f"is_nullable={expected_nullable!r}, got {actual_nullable!r}. "
            "Every Seed-pinned column is NOT NULL by contract."
        )

        # --- column_default
        if expected_default_predicate is None:
            assert actual_default is None, (
                f"events.{column_name}: must NOT have a server default. "
                f"Got column_default={actual_default!r}. Adding a default "
                "to this column violates the Seed contract — clients (or "
                "app-side logic) must populate it explicitly."
            )
        else:
            assert actual_default is not None, (
                f"events.{column_name}: missing required server default. "
                "The Seed pins a non-NULL default here; got "
                f"column_default={actual_default!r}."
            )
            assert expected_default_predicate(actual_default), (
                f"events.{column_name}: server default mismatch. The "
                "Seed-pinned default predicate rejected the introspected "
                f"value column_default={actual_default!r}."
            )
