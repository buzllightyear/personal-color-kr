"""Integration test for the session-scoped ``alembic upgrade head`` fixture.

Acceptance criterion covered (Sub-AC 8.2)
-----------------------------------------
**Add session-scoped alembic upgrade fixture that runs migrations to head
on setup against ``DATABASE_URL_TEST`` with a test asserting the events
table exists post-upgrade.**

The fixture itself lives in :mod:`apps.api.tests.integration.conftest`
under the name ``alembic_upgraded_database_url``; this module is the
verification that the fixture actually does what its docstring promises:

    1. It runs ``alembic upgrade head`` against the resolved test DB URL
       exactly once at session setup.
    2. After the fixture has run, the ``events`` table is present in the
       current schema (information_schema.tables).
    3. The session-scoped fixture publishes a URL string that downstream
       tests can pass to ``create_async_engine`` for schema introspection.

Why a focused, single-assertion test rather than re-asserting the full
6-column / 2-index schema?
    The exact column / index / default contract is already covered by
    ``test_events_migration.py`` (the per-test ``upgrade head`` driver).
    Sub-AC 8.2 asks for a narrowly-scoped existence check that proves the
    *fixture* — not the migration itself — leaves the schema in the
    expected post-upgrade state. Splitting the AC → assertion mapping at
    this granularity keeps the failure trace explicit when a future
    regression breaks one but not the other.

Skip semantics
--------------
The consuming test inherits the fixture's skip behavior automatically —
``alembic_upgraded_database_url`` calls :func:`pytest.skip` internally
when neither ``DATABASE_URL_TEST`` nor ``DATABASE_URL`` is set, so this
file does not need its own ``skipif`` decorator. The skip message in
``conftest.py`` already names the docker-compose bootstrap command, so
developers running ``pytest -q apps/api/tests`` on a fresh checkout see
the same actionable diagnostic everywhere.

Subprocess invocation
---------------------
The fixture drives alembic via ``subprocess.run([sys.executable, "-m",
"alembic", ...])`` — the exact CLI shape used by the docker-compose smoke
step and the GitHub Actions ``services: postgres:`` CI job. We rely on
the fixture for the subprocess invocation here; the test body only opens
a fresh :class:`AsyncEngine` to inspect ``information_schema.tables``.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine


@pytest.mark.integration
async def test_alembic_upgraded_database_url_fixture_creates_events_table(
    alembic_upgraded_database_url: str,
) -> None:
    """The session-scoped upgrade fixture leaves ``events`` present in the DB.

    The fixture (see ``conftest.py``) runs ``alembic upgrade head`` once
    at session setup. After it has run, querying
    ``information_schema.tables`` for ``table_name = 'events'`` in the
    current schema must return exactly one row — proving the migration
    was actually applied (not silently skipped) and the events table
    survived alembic's stamping of ``alembic_version``.

    Verification steps:
        1. Receive the resolved test DB URL from the fixture (the
           fixture's own setup has already run ``alembic upgrade head``
           by the time the test body executes).
        2. Open a fresh :class:`AsyncEngine` against the same URL.
        3. Query ``information_schema.tables`` filtered to
           ``table_name = 'events'`` in ``current_schema()``.
        4. Assert exactly one row, with ``table_name == 'events'``.
        5. Dispose the engine on the way out so the asyncpg connection
           pool releases its connections cleanly before the test exits.

    Why a non-empty / single-element assertion instead of just "len >= 1"?
        A length of zero would indicate the fixture silently no-op'd
        (alembic CLI returned 0 but the migration didn't actually create
        the table). A length greater than one would indicate the schema
        contains a duplicate (impossible under PG's unique-table-name
        constraint per schema, but we assert exact shape so a future
        refactor that changes ``current_schema()`` resolution doesn't
        slip through.) Asserting ``rows == [("events",)]`` pins both.
    """
    # Step 1 — the fixture has already migrated the schema to head. The
    # type-narrowed ``str`` parameter guarantees the fixture did not
    # skip; the consuming test inherits that skip path automatically.
    assert alembic_upgraded_database_url, (
        "alembic_upgraded_database_url fixture returned an empty string; "
        "this should be impossible — the fixture is supposed to skip "
        "(not return '') when no DB URL is configured. Investigate "
        "apps/api/tests/integration/conftest.py:_resolved_test_database_url."
    )

    # Step 2 — fresh engine for the introspection query. We do not reuse
    # the fixture's engine because the fixture's cleanup engine has
    # already been disposed by the time the test body runs (the
    # subprocess.run boundary is what actually applied the migration).
    engine = create_async_engine(alembic_upgraded_database_url, future=True)
    try:
        # Step 3 — query information_schema for the events table. Using
        # ``current_schema()`` (rather than hardcoding ``'public'``)
        # keeps the assertion robust against future schema-isolation
        # changes; today both resolve to ``public`` on Postgres 16's
        # default config but the wire contract is "in the current
        # schema", not "in public".
        async with engine.connect() as conn:
            cursor = await conn.execute(text("""
                    SELECT table_name
                    FROM information_schema.tables
                    WHERE table_schema = current_schema()
                      AND table_name = 'events'
                    """))
            # Materialize as ``list[tuple[...]]`` so the equality comparison
            # below is mypy --strict friendly. ``cursor.all()`` returns a
            # ``Sequence[Row[Any]]`` whose equality semantics against a
            # literal list-of-tuples are flagged as non-overlapping by
            # mypy; unpacking each ``Row`` via ``tuple()`` lifts the
            # comparison onto a stable type the checker understands.
            rows: list[tuple[str, ...]] = [tuple(row) for row in cursor.all()]

        # Step 4 — assert exactly one row containing 'events'. The
        # assertion message names the fixture (not the migration) so a
        # failure here points reviewers at conftest.py first.
        assert rows == [("events",)], (
            "Session-scoped fixture `alembic_upgraded_database_url` did not "
            "leave the events table present in information_schema.tables "
            "(current_schema). Expected exactly one row [('events',)]; got "
            f"{rows!r}. Likely causes: (a) `alembic upgrade head` exited 0 "
            "but the Phase 4.2 events migration was skipped because of a "
            "broken chain, (b) the migration's `upgrade()` raised after "
            "alembic stamped the version row, (c) the fixture's pre-upgrade "
            "drop ran on a different schema than the upgrade itself."
        )
    finally:
        # Step 5 — dispose the verification engine so asyncpg closes
        # idle connections before pytest reports the test result.
        await engine.dispose()
