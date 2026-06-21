"""Integration tests for the Phase 4.2 ``events`` table migration.

Acceptance criteria covered
---------------------------
* **migration_applies** — ``alembic upgrade head`` against a clean Postgres
  16 produces the ``events`` table whose ``information_schema.columns``
  + ``pg_indexes`` rows match the 6-column / 2-index Seed spec exactly.
* **downgrade_clean** — ``alembic downgrade phase_4_1_baseline`` drops the
  ``events`` table without residue (it disappears from
  ``information_schema.tables`` and its indexes vanish from ``pg_indexes``).

Why no SQLite / no mocks?
-------------------------
The Seed constraint pins the test stack to real Postgres 16 because two
columns rely on dialect-specific semantics: ``JSONB`` (Postgres only — not
in the SQL standard, not in SQLite) and ``TIMESTAMPTZ`` (SQLite stores
timestamps as naive TEXT/REAL). A SQLite double would silently accept the
DDL and silently mis-represent type fidelity on round-trip, masking real
bugs. Every test in this module therefore self-skips when no
``DATABASE_URL`` / ``DATABASE_URL_TEST`` is set (matching the precedent in
``test_alembic_upgrade_head.py`` / ``test_db_health.py``).

Subprocess invocation
---------------------
We drive ``alembic`` through ``subprocess.run([sys.executable, "-m",
"alembic", ...])`` rather than calling the alembic Python API directly so
the tests exercise the exact command path used by:

    * the docker-compose smoke step,
    * the GitHub Actions ``services: postgres:`` CI job,
    * the developer's manual ``alembic ... upgrade head`` workflow.

That keeps the integration tier honest about the production invocation
shape and surfaces env-resolution / cwd-resolution regressions that a
direct API call would silently paper over.
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
# Path + revision constants
# ---------------------------------------------------------------------------
# ``parents[2]`` from apps/api/tests/integration/test_events_migration.py
# resolves to apps/api/ regardless of pytest cwd, so the alembic CLI
# invocation always receives an absolute alembic.ini path.
_APPS_API_ROOT: Path = Path(__file__).resolve().parents[2]
_ALEMBIC_INI_PATH: Path = _APPS_API_ROOT / "alembic.ini"

# Revision identifiers, mirrored as module-level literals so a rename of
# either the baseline or the events migration triggers a single-line fix
# here instead of a confusing test failure deep in an assertion message.
_BASELINE_REVISION: str = "phase_4_1_baseline"
_EVENTS_REVISION: str = "phase_4_2_events"
# The Content Generation phase extended the chain past Phase 4.5: AC1/AC5
# added ``content_gen_recipes`` and AC4 added ``content_gen_generations`` on
# top. ``alembic upgrade head`` now stamps alembic_version to the latter.
_HEAD_REVISION: str = "content_gen_generations"

# Generous timeout — the events migration emits two ``CREATE INDEX``
# statements but no data backfill; 60s protects against a wedged asyncpg
# connection without making CI wait minutes on a real failure.
_CLI_TIMEOUT_SECONDS: int = 60


def _resolved_database_url() -> str | None:
    """Return the test DB URL the integration test will exercise, or ``None``.

    Lookup order (matches ``test_alembic_upgrade_head.py``):
        1. ``DATABASE_URL_TEST`` — dedicated test database URL.
        2. ``DATABASE_URL``      — fallback for dev machines that have not
                                    split the two URLs yet.

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
    "real-Postgres integration test for the events migration. To run "
    "it locally: `docker compose up -d postgres` then export "
    "DATABASE_URL_TEST=postgresql+asyncpg://<user>:<pass>@localhost:5432/<db>."
)


# ---------------------------------------------------------------------------
# Helpers — alembic CLI driver + DB state reset
# ---------------------------------------------------------------------------
def _run_alembic(target: str, db_url: str) -> subprocess.CompletedProcess[str]:
    """Drive ``alembic -c <ini> <upgrade|downgrade> <target>`` via subprocess.

    Centralizing the invocation here keeps every test using the exact same
    argv shape, environment overlay, and timeout. ``check=False`` is
    deliberate: callers assert ``returncode`` explicitly so the assertion
    message can interpolate stdout + stderr (a richer failure signal than
    the default ``CalledProcessError`` traceback).
    """
    cmd = (
        "upgrade"
        if target in ("head", _EVENTS_REVISION, _HEAD_REVISION)
        else "downgrade"
    )

    env = os.environ.copy()
    env["DATABASE_URL"] = db_url
    return subprocess.run(
        [
            sys.executable,
            "-m",
            "alembic",
            "-c",
            str(_ALEMBIC_INI_PATH),
            cmd,
            target,
        ],
        env=env,
        capture_output=True,
        text=True,
        timeout=_CLI_TIMEOUT_SECONDS,
        check=False,
    )


async def _reset_db_to_blank(db_url: str) -> None:
    """Drop the ``events`` table + the alembic bookkeeping table.

    The integration tests are designed to be reproducible regardless of
    whether the postgres container was just provisioned (CI) or carries
    state from a prior local run. We drop ``events`` first (cascades to
    its indexes) and then ``alembic_version`` so ``alembic upgrade head``
    starts from a truly blank slate.

    Both drops are guarded with ``IF EXISTS`` so the very first run on a
    brand-new container is still a no-op.
    """
    engine = create_async_engine(db_url, future=True)
    try:
        async with engine.begin() as conn:
            await conn.execute(text("DROP TABLE IF EXISTS generations CASCADE"))
            await conn.execute(text("DROP TABLE IF EXISTS recipes CASCADE"))
            await conn.execute(text("DROP TABLE IF EXISTS events CASCADE"))

            await conn.execute(text("DROP TABLE IF EXISTS users CASCADE"))
            await conn.execute(text("DROP TABLE IF EXISTS alembic_version"))
    finally:
        await engine.dispose()


# ---------------------------------------------------------------------------
# Test 0 — Sub-AC 2 bookmark: migration runs and events table EXISTS
# ---------------------------------------------------------------------------
@pytest.mark.integration
@pytest.mark.skipif(_RESOLVED_URL is None, reason=_SKIP_REASON)
async def test_alembic_upgrade_head_creates_events_table_present_in_information_schema() -> (
    None
):
    """Phase 4.2 Sub-AC 2: migration runs and the ``events`` table exists.

    This is the narrowest, single-purpose integration test for Sub-AC 2 of
    the Phase 4.2 dispatch contract:

        "Write an integration test against postgres:16 that runs the
         migration and asserts the events table exists in the database."

    The companion test
    :func:`test_alembic_upgrade_head_creates_events_table_with_exact_schema`
    goes further and asserts the full 6-column / 2-index schema shape.
    This focused test deliberately asserts ONLY existence so that a
    regression in the column / index spec does not mask a regression in
    the table-creation step itself (and vice versa).

    Verification steps:
        1. Drop ``events`` + ``alembic_version`` for a deterministic
           starting state.
        2. Run ``alembic upgrade head`` via the production CLI path
           (``python -m alembic -c <ini> upgrade head``) and assert exit 0.
        3. Query ``information_schema.tables WHERE table_name = 'events'``
           and assert the row is present (the events table exists in the
           current schema after migration).
    """
    assert _RESOLVED_URL is not None  # narrowed by skipif but mypy --strict

    # ---- Step 1: deterministic starting state.
    await _reset_db_to_blank(_RESOLVED_URL)

    # ---- Step 2: run the migration via the production CLI path.
    result = _run_alembic("head", _RESOLVED_URL)
    assert result.returncode == 0, (
        f"`alembic upgrade head` exited {result.returncode}; expected 0.\n"
        f"--- stdout ---\n{result.stdout}\n--- stderr ---\n{result.stderr}"
    )

    # ---- Step 3: assert the events table EXISTS (single-purpose check).
    engine = create_async_engine(_RESOLVED_URL, future=True)
    try:
        async with engine.connect() as conn:
            tbl_result = await conn.execute(text("""
                    SELECT table_name
                    FROM information_schema.tables
                    WHERE table_schema = current_schema()
                      AND table_name = 'events'
                    """))
            tbl_rows = tbl_result.all()
        assert len(tbl_rows) == 1 and tbl_rows[0][0] == "events", (
            "Phase 4.2 Sub-AC 2 violated: after `alembic upgrade head`, "
            "the `events` table must exist exactly once in the current "
            f"schema (information_schema.tables). Got rows: {tbl_rows!r}."
        )
    finally:
        await engine.dispose()


# ---------------------------------------------------------------------------
# Test 0b — Sub-AC 3 bookmark: all 6 columns exist with the correct types
# ---------------------------------------------------------------------------
# Type fixtures pinned in module scope so a future column rename / type drift
# triggers a single-line edit here rather than scattered re-keyings deep in
# the test body. Keys are the Seed-pinned column names; values are the
# expected ``(data_type, udt_name)`` pair as reported by
# ``information_schema.columns`` on Postgres 16.
#
# Why both ``data_type`` AND ``udt_name``?
#     * ``data_type`` is the standard-ish report (e.g. ``timestamp with time
#       zone`` for TIMESTAMPTZ).
#     * ``udt_name`` is the Postgres-specific underlying type name (``uuid``,
#       ``jsonb``, ``text``, ``timestamptz``) — required to disambiguate
#       between concrete Postgres types that share a SQL-standard family
#       (e.g. TIMESTAMPTZ vs TIMESTAMP).
# Asserting against the pair locks the schema to the Postgres-flavored types
# we explicitly chose, not just to a SQL-standard family that could silently
# be implemented by a different concrete dialect type. The values below were
# verified against Postgres 16 directly by querying
# ``information_schema.columns`` after ``alembic upgrade head``.
_EXPECTED_COLUMN_TYPES: dict[str, tuple[str, str]] = {
    "id": ("uuid", "uuid"),
    "anonymous_id": ("text", "text"),
    "event_name": ("text", "text"),
    "properties": ("jsonb", "jsonb"),
    "occurred_at": ("timestamp with time zone", "timestamptz"),
    "server_received_at": ("timestamp with time zone", "timestamptz"),
}


@pytest.mark.integration
@pytest.mark.skipif(_RESOLVED_URL is None, reason=_SKIP_REASON)
async def test_alembic_upgrade_head_creates_events_table_with_six_columns_of_correct_types() -> (
    None
):
    """Phase 4.2 Sub-AC 3: all 6 columns exist with the correct names + types.

    This is the narrowest, single-purpose integration test for Sub-AC 3 of
    the Phase 4.2 dispatch contract:

        "Write an integration test against postgres:16 that runs the
         migration and asserts all 6 specified columns exist on the events
         table with correct names and types."

    The companion test
    :func:`test_alembic_upgrade_head_creates_events_table_with_exact_schema`
    goes further and additionally asserts nullability, defaults, indexes,
    and the alembic_version stamp. This focused test deliberately asserts
    ONLY column names and types so that a regression in default values or
    indexes does not mask a regression in the column-name / column-type
    pair (and vice versa). Tying each Sub-AC to a single-purpose test keeps
    the AC → assertion mapping explicit in the failure trace.

    Verification steps:
        1. Reset to a blank database (drop ``events`` + ``alembic_version``)
           so the migration starts from a deterministic state.
        2. Run ``alembic upgrade head`` via the production CLI path and
           assert exit code 0.
        3. Introspect ``information_schema.columns`` for the ``events``
           table and assert:
             a) The exact set of column names matches the 6-name Seed spec
                (no extras, no missing).
             b) Each column's ``(data_type, udt_name)`` pair matches the
                ``_EXPECTED_COLUMN_TYPES`` fixture above, which encodes the
                concrete Postgres types (uuid / text / jsonb / timestamptz).
    """
    assert _RESOLVED_URL is not None  # narrowed by skipif but mypy --strict

    # ---- Step 1: deterministic starting state.
    await _reset_db_to_blank(_RESOLVED_URL)

    # ---- Step 2: run the migration via the production CLI path.
    result = _run_alembic("head", _RESOLVED_URL)
    assert result.returncode == 0, (
        f"`alembic upgrade head` exited {result.returncode}; expected 0.\n"
        f"--- stdout ---\n{result.stdout}\n--- stderr ---\n{result.stderr}"
    )

    # ---- Step 3: introspect columns and assert names + types match.
    engine = create_async_engine(_RESOLVED_URL, future=True)
    try:
        async with engine.connect() as conn:
            cols_result = await conn.execute(text("""
                    SELECT column_name, data_type, udt_name
                    FROM information_schema.columns
                    WHERE table_schema = current_schema()
                      AND table_name = 'events'
                    ORDER BY ordinal_position
                    """))
            rows = cols_result.all()

        # Build a {column_name: (data_type, udt_name)} dict so the
        # assertion messages can reference the column by name rather than
        # by ordinal position.
        actual: dict[str, tuple[str, str]] = {row[0]: (row[1], row[2]) for row in rows}

        # ---- Step 3a: exact column-name set (Phase 4.2's 6 + Phase 4.3 user_id).
        # Asserting against a literal set surfaces both missing and extra
        # columns in a single diff so reviewers see the full delta.
        expected_column_names = set(_EXPECTED_COLUMN_TYPES.keys()) | {"user_id"}
        assert set(actual.keys()) == expected_column_names, (
            f"Phase 4.3 events table column NAMES drifted from the spec "
            f"(6 Phase 4.2 + Phase 4.3 user_id). Expected exactly: "
            f"{sorted(expected_column_names)!r}; got: "
            f"{sorted(actual.keys())!r}."
        )

        # ---- Step 3b: each column has the expected (data_type, udt_name).
        # We iterate so a single column-type mismatch produces a focused
        # assertion message rather than a giant dict-vs-dict diff.
        for column_name, expected_pair in _EXPECTED_COLUMN_TYPES.items():
            actual_pair = actual[column_name]
            assert actual_pair == expected_pair, (
                f"Phase 4.2 Sub-AC 3 violated: events.{column_name} type "
                f"drifted from the Seed spec. Expected "
                f"(data_type, udt_name)={expected_pair!r}; got "
                f"{actual_pair!r}."
            )
    finally:
        await engine.dispose()


# ---------------------------------------------------------------------------
# Test 1 — upgrade head creates the events table with the 6-column spec
# ---------------------------------------------------------------------------
@pytest.mark.integration
@pytest.mark.skipif(_RESOLVED_URL is None, reason=_SKIP_REASON)
async def test_alembic_upgrade_head_creates_events_table_with_exact_schema() -> None:
    """``upgrade head`` → ``events`` table with all 6 Seed-pinned columns.

    Verification steps:
        1. Drop ``events`` + ``alembic_version`` for a clean baseline.
        2. Run ``alembic upgrade head`` and assert exit 0.
        3. Query ``information_schema.columns WHERE table_name='events'``
           and assert the column set, types, nullability, and defaults all
           match the Seed contract column-by-column.
        4. Query ``pg_indexes`` and assert the two expected indexes exist.
        5. Query ``alembic_version`` and assert the head revision is
           ``phase_4_2_events`` (proves the chain extended past the baseline).
    """
    assert _RESOLVED_URL is not None  # narrowed by skipif but mypy --strict

    await _reset_db_to_blank(_RESOLVED_URL)

    result = _run_alembic("head", _RESOLVED_URL)
    assert result.returncode == 0, (
        f"`alembic upgrade head` exited {result.returncode}; expected 0.\n"
        f"--- stdout ---\n{result.stdout}\n--- stderr ---\n{result.stderr}"
    )

    engine = create_async_engine(_RESOLVED_URL, future=True)
    try:
        async with engine.connect() as conn:
            # ---- Step 3: introspect events columns from information_schema.
            cols_result = await conn.execute(text("""
                    SELECT
                        column_name,
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

            # Build a name -> row dict for clearer assertions.
            cols: dict[str, tuple[str, str, str, str | None]] = {
                row[0]: (row[1], row[2], row[3], row[4]) for row in rows
            }

            # Exact column set — Phase 4.2's 6 + Phase 4.3 user_id.
            assert set(cols.keys()) == {
                "id",
                "anonymous_id",
                "event_name",
                "properties",
                "occurred_at",
                "server_received_at",
                "user_id",
            }, (
                f"events table column set drifted from the Phase 4.3 spec. "
                f"Expected seven columns "
                f"(id, anonymous_id, event_name, properties, occurred_at, "
                f"server_received_at, user_id); got: {sorted(cols.keys())!r}."
            )

            # ---- id: UUID NOT NULL, no default.
            id_data_type, id_udt, id_nullable, id_default = cols["id"]
            assert id_udt == "uuid", (
                f"events.id must be PostgreSQL UUID (udt_name='uuid'); "
                f"got udt_name={id_udt!r}, data_type={id_data_type!r}."
            )
            assert id_nullable == "NO", "events.id must be NOT NULL."
            assert id_default is None, (
                "events.id must have NO server default — the Seed mandates "
                f"app-side uuid4 generation. Got default={id_default!r}."
            )

            # ---- anonymous_id: TEXT NOT NULL, no default.
            (
                anon_data_type,
                anon_udt,
                anon_nullable,
                anon_default,
            ) = cols["anonymous_id"]
            assert (
                anon_data_type == "text"
            ), f"events.anonymous_id must be TEXT; got data_type={anon_data_type!r}."
            assert anon_nullable == "NO", "events.anonymous_id must be NOT NULL."
            assert anon_default is None, (
                f"events.anonymous_id must have no server default; got "
                f"{anon_default!r}."
            )

            # ---- event_name: TEXT NOT NULL, no default.
            (
                ev_data_type,
                _ev_udt,
                ev_nullable,
                ev_default,
            ) = cols["event_name"]
            assert (
                ev_data_type == "text"
            ), f"events.event_name must be TEXT; got data_type={ev_data_type!r}."
            assert ev_nullable == "NO", "events.event_name must be NOT NULL."
            assert (
                ev_default is None
            ), f"events.event_name must have no server default; got {ev_default!r}."

            # ---- properties: JSONB NOT NULL DEFAULT '{}'::jsonb.
            (
                props_data_type,
                props_udt,
                props_nullable,
                props_default,
            ) = cols["properties"]
            assert props_udt == "jsonb", (
                f"events.properties must be JSONB (udt_name='jsonb'); got "
                f"udt_name={props_udt!r}, data_type={props_data_type!r}."
            )
            assert props_nullable == "NO", "events.properties must be NOT NULL."
            # Postgres normalizes ``'{}'::jsonb`` in column_default to a
            # form like ``'{}'::jsonb`` — case-insensitively contains both
            # ``{}`` and ``jsonb``.
            assert props_default is not None and (
                "{}" in props_default and "jsonb" in props_default.lower()
            ), (
                f"events.properties must default to an empty JSONB object "
                f"(``'{{}}'::jsonb``); got default={props_default!r}."
            )

            # ---- occurred_at: TIMESTAMPTZ NOT NULL, no default.
            (
                occ_data_type,
                _occ_udt,
                occ_nullable,
                occ_default,
            ) = cols["occurred_at"]
            assert occ_data_type == "timestamp with time zone", (
                f"events.occurred_at must be TIMESTAMPTZ; got "
                f"data_type={occ_data_type!r}."
            )
            assert occ_nullable == "NO", "events.occurred_at must be NOT NULL."
            assert occ_default is None, (
                f"events.occurred_at must have NO server default — clients "
                f"are required to provide it. Got default={occ_default!r}."
            )

            # ---- server_received_at: TIMESTAMPTZ NOT NULL DEFAULT now().
            (
                srv_data_type,
                _srv_udt,
                srv_nullable,
                srv_default,
            ) = cols["server_received_at"]
            assert srv_data_type == "timestamp with time zone", (
                f"events.server_received_at must be TIMESTAMPTZ; got "
                f"data_type={srv_data_type!r}."
            )
            assert srv_nullable == "NO", "events.server_received_at must be NOT NULL."
            assert srv_default is not None and "now()" in srv_default.lower(), (
                f"events.server_received_at must default to ``now()``; got "
                f"default={srv_default!r}."
            )

            # ---- Step 4: introspect indexes.
            idx_result = await conn.execute(text("""
                    SELECT indexname
                    FROM pg_indexes
                    WHERE schemaname = current_schema()
                      AND tablename = 'events'
                    ORDER BY indexname
                    """))
            index_names = {row[0] for row in idx_result.all()}
            # Postgres auto-creates ``events_pkey`` for the UUID primary key.
            # We assert membership rather than equality so a future phase
            # can add more indexes without breaking this test, but the two
            # Seed-pinned indexes MUST be present.
            assert "ix_events_anonymous_id" in index_names, (
                f"Missing index ``ix_events_anonymous_id``; found indexes: "
                f"{sorted(index_names)!r}."
            )
            assert "ix_events_event_name_occurred_at" in index_names, (
                f"Missing index ``ix_events_event_name_occurred_at``; "
                f"found indexes: {sorted(index_names)!r}."
            )

            # ---- Step 5: alembic_version is now stamped to the events rev.
            ver_result = await conn.execute(
                text("SELECT version_num FROM alembic_version")
            )
            ver_rows = ver_result.all()
            assert len(ver_rows) == 1, (
                f"alembic_version must contain exactly one row after "
                f"upgrade head; found {len(ver_rows)}: {ver_rows!r}."
            )
            assert ver_rows[0][0] == _HEAD_REVISION, (
                f"alembic_version.version_num must equal "
                f"{_HEAD_REVISION!r} (chain head) after upgrade head; "
                f"got {ver_rows[0][0]!r}."
            )
    finally:
        await engine.dispose()


# ---------------------------------------------------------------------------
# Test 2 — downgrade to baseline drops the events table cleanly
# ---------------------------------------------------------------------------
@pytest.mark.integration
@pytest.mark.skipif(_RESOLVED_URL is None, reason=_SKIP_REASON)
async def test_alembic_downgrade_to_baseline_drops_events_table_cleanly() -> None:
    """``downgrade phase_4_1_baseline`` → events table gone, no residue.

    Verification steps:
        1. Reset to blank, then ``upgrade head`` so the events table exists.
        2. Run ``alembic downgrade phase_4_1_baseline`` and assert exit 0.
        3. Query ``information_schema.tables`` — ``events`` must be absent.
        4. Query ``pg_indexes`` — both Seed-pinned event indexes must be
           absent (proves no orphan index objects survived the rollback).
        5. Query ``alembic_version`` — version must be back at
           ``phase_4_1_baseline`` (proves the chain rewound exactly one
           step, not more).
    """
    assert _RESOLVED_URL is not None

    # ---- Step 1: blank → head.
    await _reset_db_to_blank(_RESOLVED_URL)
    upgrade_result = _run_alembic("head", _RESOLVED_URL)
    assert (
        upgrade_result.returncode == 0
    ), f"pre-condition upgrade failed: {upgrade_result.stderr!r}"

    # ---- Step 2: head → baseline.
    downgrade_result = _run_alembic(_BASELINE_REVISION, _RESOLVED_URL)
    assert downgrade_result.returncode == 0, (
        f"`alembic downgrade {_BASELINE_REVISION}` exited "
        f"{downgrade_result.returncode}; expected 0.\n"
        f"--- stdout ---\n{downgrade_result.stdout}\n"
        f"--- stderr ---\n{downgrade_result.stderr}"
    )

    engine = create_async_engine(_RESOLVED_URL, future=True)
    try:
        async with engine.connect() as conn:
            # ---- Step 3: events table gone.
            tbl_result = await conn.execute(text("""
                    SELECT table_name
                    FROM information_schema.tables
                    WHERE table_schema = current_schema()
                      AND table_name = 'events'
                    """))
            tbl_rows = tbl_result.all()
            assert tbl_rows == [], (
                f"events table must be DROPped after downgrade to baseline; "
                f"information_schema still reports: {tbl_rows!r}."
            )

            # ---- Step 4: indexes gone.
            idx_result = await conn.execute(text("""
                    SELECT indexname
                    FROM pg_indexes
                    WHERE schemaname = current_schema()
                      AND indexname IN (
                        'ix_events_anonymous_id',
                        'ix_events_event_name_occurred_at'
                      )
                    """))
            idx_rows = idx_result.all()
            assert idx_rows == [], (
                "events indexes must be DROPped on downgrade; pg_indexes "
                f"still reports: {idx_rows!r}."
            )

            # ---- Step 5: alembic_version rewound to baseline.
            ver_result = await conn.execute(
                text("SELECT version_num FROM alembic_version")
            )
            ver_rows = ver_result.all()
            assert len(ver_rows) == 1, (
                "alembic_version must contain exactly one row after "
                f"downgrade; found {len(ver_rows)}: {ver_rows!r}."
            )
            assert ver_rows[0][0] == _BASELINE_REVISION, (
                f"alembic_version.version_num must equal "
                f"{_BASELINE_REVISION!r} after downgrade; got "
                f"{ver_rows[0][0]!r}."
            )
    finally:
        await engine.dispose()


# ---------------------------------------------------------------------------
# Test 3 — raw SQL round-trip proves JSONB + TIMESTAMPTZ + UUID type fidelity
# ---------------------------------------------------------------------------
@pytest.mark.integration
@pytest.mark.skipif(_RESOLVED_URL is None, reason=_SKIP_REASON)
async def test_events_table_supports_raw_sql_insert_select_round_trip() -> None:
    """Insert a synthetic event via raw SQL and read it back unchanged.

    This test verifies that the migration produces a table that actually
    accepts and returns the JSONB / TIMESTAMPTZ / UUID values without
    silent coercion. It complements the ORM-model round-trip test (which
    lives in ``test_events_model.py``) by exercising the SAME schema
    through a different driver path — SQLAlchemy Core ``text()`` SQL with
    bound parameters — so a regression in the migration is caught even if
    the ORM model layer has a covering bug.

    Why raw SQL rather than ORM here?
        The migration is the unit under test; binding the assertion to
        the ORM model would couple two independent layers and obscure
        which one broke when an assertion fails. The companion
        ``test_events_model.py`` exercises the ORM path.
    """
    import uuid
    from datetime import datetime, timezone

    assert _RESOLVED_URL is not None

    # Ensure the table is present (idempotent if already at head).
    await _reset_db_to_blank(_RESOLVED_URL)
    upgrade_result = _run_alembic("head", _RESOLVED_URL)
    assert (
        upgrade_result.returncode == 0
    ), f"pre-condition upgrade failed: {upgrade_result.stderr!r}"

    event_id = uuid.uuid4()
    anonymous_id = "anon-test-fixture-001"
    event_name = "test.round_trip"
    occurred_at = datetime(2026, 2, 1, 12, 0, 0, tzinfo=timezone.utc)
    # JSON-encoded as a string for the JSONB cast; psycopg/asyncpg both
    # accept ``::jsonb`` casts on string bind parameters.
    properties_json = '{"k": "v", "n": 7}'

    engine = create_async_engine(_RESOLVED_URL, future=True)
    try:
        async with engine.begin() as conn:
            await conn.execute(
                text("""
                    INSERT INTO events
                        (id, anonymous_id, event_name, properties, occurred_at)
                    VALUES
                        (:id, :anonymous_id, :event_name,
                         CAST(:properties AS jsonb), :occurred_at)
                    """),
                {
                    "id": event_id,
                    "anonymous_id": anonymous_id,
                    "event_name": event_name,
                    "properties": properties_json,
                    "occurred_at": occurred_at,
                },
            )

        async with engine.connect() as conn:
            row_result = await conn.execute(
                text("""
                    SELECT
                        id,
                        anonymous_id,
                        event_name,
                        properties,
                        occurred_at,
                        server_received_at
                    FROM events
                    WHERE id = :id
                    """),
                {"id": event_id},
            )
            rows = row_result.all()

        assert len(rows) == 1, (
            f"Expected exactly one event for id={event_id!r}; got "
            f"{len(rows)} row(s)."
        )
        (
            r_id,
            r_anon,
            r_event,
            r_props,
            r_occurred,
            r_server,
        ) = rows[0]

        assert (
            r_id == event_id
        ), f"UUID round-trip failed: inserted {event_id!r}, got {r_id!r}."
        assert (
            r_anon == anonymous_id
        ), f"TEXT round-trip failed: inserted {anonymous_id!r}, got {r_anon!r}."
        assert (
            r_event == event_name
        ), f"TEXT round-trip failed: inserted {event_name!r}, got {r_event!r}."
        # asyncpg returns JSONB as a Python dict directly (jsonb -> dict).
        assert r_props == {"k": "v", "n": 7}, (
            f"JSONB round-trip failed: inserted {properties_json!r}, "
            f"got {r_props!r}."
        )
        # occurred_at preserves tz (TIMESTAMPTZ); compare to the same UTC
        # value we inserted.
        assert r_occurred == occurred_at, (
            f"TIMESTAMPTZ round-trip failed: inserted {occurred_at!r}, "
            f"got {r_occurred!r}."
        )
        # server_received_at must be populated by the DB default and must
        # carry a timezone (the type guarantees that; we double-check the
        # tzinfo is not None as a regression guard against an accidental
        # ``TIMESTAMP WITHOUT TIME ZONE`` column).
        assert r_server is not None, "server_received_at must be populated by DEFAULT."
        assert r_server.tzinfo is not None, (
            f"server_received_at must carry tzinfo (TIMESTAMPTZ); got naive "
            f"{r_server!r}."
        )
    finally:
        # Clean up the synthetic row so repeated local runs don't accumulate
        # fixture data in a persistent docker-compose volume.
        try:
            cleanup_engine = create_async_engine(_RESOLVED_URL, future=True)
            try:
                async with cleanup_engine.begin() as conn:
                    await conn.execute(
                        text("DELETE FROM events WHERE id = :id"),
                        {"id": event_id},
                    )
            finally:
                await cleanup_engine.dispose()
        finally:
            await engine.dispose()
