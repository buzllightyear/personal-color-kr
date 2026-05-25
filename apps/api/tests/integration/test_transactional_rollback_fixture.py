"""Verify the ``transactional_async_session`` fixture rolls back every write.

Acceptance criterion covered (Sub-AC 8.3)
-----------------------------------------
**Add function-scoped transactional rollback fixture wrapping each test in
a SAVEPOINT/transaction with a test verifying inserted rows are not
visible after the test completes.**

The fixture itself lives in :mod:`apps.api.tests.integration.conftest` under
the name ``transactional_async_session``. This module is the executable
contract that proves the fixture actually rolls back: a row inserted by
the *first* test must be absent when the *second* test queries it through
an independent, fresh engine outside the fixture's transactional scope.

Test architecture
-----------------
The two tests are written so they MUST run in definition order. Pytest's
default collector preserves in-file declaration order, and the asserted
behavior depends on that ordering (test 2 looks for a row inserted by
test 1). The marker UUID is module-level so it survives across the two
test invocations.

    1. ``test_a_transactional_fixture_persists_inserts_within_test``
       (the alphabetical leader): inserts an :class:`Event` through
       ``transactional_async_session``, commits, re-reads on the *same*
       session, and asserts the row is visible. This proves the fixture
       does not silently rollback DURING the test body — only at
       teardown.

    2. ``test_b_transactional_fixture_rolls_back_inserts_after_test``
       (the alphabetical follower): opens an independent engine + session
       (NOT the fixture) and asserts the marker UUID is absent from the
       ``events`` table. Because the fixture rolled back between the two
       tests, this fresh session must NOT see test_a's insert.

Why a UUID-based marker rather than a row count?
    Row-count assertions are fragile in the presence of concurrent test
    runs against the same docker-compose container. Filtering by a fresh
    UUID generated at module import time isolates this test from anything
    else exercising the events table in the same pytest session.

Why two functions instead of one big test with an embedded sub-session?
    "Not visible after the test completes" is exactly a contract about
    the boundary between two tests. Cramming it into one body would force
    us to drive teardown manually (defeating the point of the fixture
    being a pytest fixture) or use a try/finally that double-counts the
    rollback. Two ordered tests express the contract directly.

Skip semantics
--------------
``transactional_async_session`` depends transitively on
``resolved_test_database_url`` and ``async_engine``; both call
:func:`pytest.skip` when neither ``DATABASE_URL_TEST`` nor
``DATABASE_URL`` is set. Test ``b`` re-runs the same resolution explicitly
because it does NOT consume the fixture (it builds its own engine to prove
visibility from outside the fixture's transaction).
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
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from api.db.models import Event

# ---------------------------------------------------------------------------
# Module-level constants
# ---------------------------------------------------------------------------
# A single UUID generated at import time is the "marker" both tests use:
#   * test_a inserts an Event with this id through the transactional fixture.
#   * test_b queries for this id outside the fixture and asserts None.
# Generated at import (not inside test_a) so test_b can reference it without
# threading state through a function-scoped fixture.
_MARKER_EVENT_ID: uuid.UUID = uuid.uuid4()
_MARKER_ANONYMOUS_ID: str = "anon-savepoint-rollback-fixture"
_MARKER_EVENT_NAME: str = "test.transactional.rollback.marker"
_MARKER_OCCURRED_AT: datetime = datetime(2026, 3, 15, 12, 0, 0, tzinfo=timezone.utc)

# Path to the apps/api root + alembic.ini for the per-module schema bootstrap
# in test_a. test_b never invokes alembic; it only opens a read-only session.
_APPS_API_ROOT: Path = Path(__file__).resolve().parents[2]
_ALEMBIC_INI_PATH: Path = _APPS_API_ROOT / "alembic.ini"
_ALEMBIC_CLI_TIMEOUT_SECONDS: int = 60


def _resolved_database_url() -> str | None:
    """Return the resolved test DB URL (``DATABASE_URL_TEST`` ▸ ``DATABASE_URL``).

    Matches the lookup used in ``conftest.py``: prefer the dedicated test
    URL; fall back to ``DATABASE_URL``; treat empty strings as unset.
    """
    candidate = os.environ.get("DATABASE_URL_TEST") or os.environ.get("DATABASE_URL")
    if candidate is None or candidate == "":
        return None
    return candidate


_RESOLVED_URL: str | None = _resolved_database_url()

_SKIP_REASON: str = (
    "Neither DATABASE_URL_TEST nor DATABASE_URL is set; skipping the "
    "transactional rollback fixture verification test. To run it "
    "locally: `docker compose up -d postgres` then export "
    "DATABASE_URL_TEST=postgresql+asyncpg://<user>:<pass>@127.0.0.1:5432/<db>."
)


async def _reset_db_and_upgrade_head(url: str) -> None:
    """Drop ``events`` + ``alembic_version`` then run ``alembic upgrade head``.

    The transactional rollback fixture only manages row-level state — it
    does NOT create tables. We bootstrap the schema once at the top of
    test_a so the fixture has somewhere to insert.

    Implementation mirrors ``test_events_model_roundtrip.py``: a fresh
    create_async_engine for the drop, then a subprocess.run of the
    production alembic CLI so the test exercises the same upgrade path
    the CI smoke step uses.
    """
    setup_engine = create_async_engine(url, future=True)
    try:
        async with setup_engine.begin() as conn:
            await conn.execute(text("DROP TABLE IF EXISTS events CASCADE"))

            await conn.execute(text("DROP TABLE IF EXISTS users CASCADE"))
            await conn.execute(text("DROP TABLE IF EXISTS alembic_version"))
    finally:
        await setup_engine.dispose()

    cli_env = os.environ.copy()
    cli_env["DATABASE_URL"] = url
    completed = subprocess.run(
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
        timeout=_ALEMBIC_CLI_TIMEOUT_SECONDS,
        check=False,
    )
    if completed.returncode != 0:  # pragma: no cover — exercised only on failure
        raise RuntimeError(
            "alembic upgrade head failed during transactional rollback "
            f"fixture bootstrap (exit {completed.returncode}): "
            f"{completed.stdout}\n{completed.stderr}"
        )


# ---------------------------------------------------------------------------
# Test A — insert via the fixture, verify visibility WITHIN the test body
# ---------------------------------------------------------------------------
@pytest.mark.integration
@pytest.mark.skipif(_RESOLVED_URL is None, reason=_SKIP_REASON)
async def test_a_transactional_fixture_persists_inserts_within_test(
    transactional_async_session: AsyncSession,
) -> None:
    """The fixture allows writes during the test, before rollback at teardown.

    This is the "positive" half of the Sub-AC 8.3 contract: the fixture
    must not silently roll back DURING the test body — only at teardown.
    We exercise the common "INSERT row, commit, re-read on the same
    session" cycle that production code follows so the SAVEPOINT-based
    join_transaction_mode plumbing is verified end-to-end:

        1. Bootstrap the schema once (drop + alembic upgrade head). This
           is the only test in the file that creates the events table; the
           sibling rollback assertion in test_b reuses the same table.
        2. Insert an :class:`Event` populated with the module-level marker
           values. The id is the module-scoped ``_MARKER_EVENT_ID`` so
           test_b can look it up later.
        3. ``await session.commit()`` — under the fixture's
           ``join_transaction_mode="create_savepoint"`` setting this
           releases the SAVEPOINT but the outer transaction stays open.
        4. Re-read the row by primary key on the SAME session.
        5. Assert the marker columns survived the round-trip. If
           ``fetched`` is None, either the SAVEPOINT escape went the
           wrong direction (the row was rolled back DURING the test) or
           the commit never executed.

    The fixture's teardown — invisible from inside the test body — then
    rolls back the outer transaction so test_b can prove the row is gone.
    """
    assert _RESOLVED_URL is not None  # narrowed by skipif; mypy --strict
    # Bootstrap the schema once for the whole module. test_b consumes the
    # same schema state (the events table created here survives the
    # rollback — only the row state is reverted).
    await _reset_db_and_upgrade_head(_RESOLVED_URL)

    # Insert the marker row through the transactional fixture.
    event = Event(
        id=_MARKER_EVENT_ID,
        anonymous_id=_MARKER_ANONYMOUS_ID,
        event_name=_MARKER_EVENT_NAME,
        occurred_at=_MARKER_OCCURRED_AT,
    )
    transactional_async_session.add(event)
    # ``commit`` here drives the SAVEPOINT path. Under
    # ``join_transaction_mode="create_savepoint"`` the commit releases
    # the nested SAVEPOINT; the outer transaction (which the fixture
    # owns) stays open. SQLAlchemy automatically begins a new SAVEPOINT
    # for any subsequent work, so this is safe to combine with further
    # session.execute() calls below.
    await transactional_async_session.commit()

    # Re-read on the same session to prove the write is visible from
    # within the transaction the fixture manages.
    result = await transactional_async_session.execute(
        select(Event).where(Event.id == _MARKER_EVENT_ID)
    )
    fetched = result.scalar_one_or_none()

    assert fetched is not None, (
        "transactional_async_session must let the test see its own writes "
        "during the test body. Found no row for "
        f"id={_MARKER_EVENT_ID!r}. Either the SAVEPOINT release escaped "
        "outward and was rolled back prematurely, or the session.commit() "
        "above never fired."
    )
    assert fetched.id == _MARKER_EVENT_ID, (
        f"Round-trip UUID mismatch: inserted {_MARKER_EVENT_ID!r}, "
        f"got {fetched.id!r}."
    )
    assert fetched.anonymous_id == _MARKER_ANONYMOUS_ID, (
        f"Round-trip anonymous_id mismatch: inserted {_MARKER_ANONYMOUS_ID!r}, "
        f"got {fetched.anonymous_id!r}."
    )
    assert fetched.event_name == _MARKER_EVENT_NAME, (
        f"Round-trip event_name mismatch: inserted {_MARKER_EVENT_NAME!r}, "
        f"got {fetched.event_name!r}."
    )


# ---------------------------------------------------------------------------
# Test B — verify the marker row is gone once the fixture has torn down
# ---------------------------------------------------------------------------
@pytest.mark.integration
@pytest.mark.skipif(_RESOLVED_URL is None, reason=_SKIP_REASON)
async def test_b_transactional_fixture_rolls_back_inserts_after_test() -> None:
    """A fresh non-transactional session cannot see test_a's marker row.

    This is the core Sub-AC 8.3 assertion: "inserted rows are not visible
    after the test completes." We deliberately do NOT consume
    ``transactional_async_session`` here — that fixture's teardown rolls
    back its OWN transaction, but the marker row from test_a was inserted
    in a *previous* fixture instance, whose rollback already ran when
    test_a finished. We open an independent engine + session to query the
    database through a completely separate connection, mimicking a real
    out-of-test client (e.g., the FastAPI process):

        1. Resolve the DB URL via the same precedence used everywhere in
           this directory (``DATABASE_URL_TEST`` ▸ ``DATABASE_URL``).
        2. Build a fresh :class:`AsyncEngine` and sessionmaker.
        3. ``select(Event).where(Event.id == _MARKER_EVENT_ID)`` — query
           the marker UUID inserted by test_a.
        4. Assert the result is ``None``. If we get a row back, the
           fixture failed to roll back and the rollback contract is
           broken; the diagnostic message tells the reviewer exactly
           which fixture and which file to inspect.
        5. Dispose the engine cleanly so asyncpg releases the connection
           pool before pytest reports the result.

    Note on test ordering
    ---------------------
    Pytest preserves in-file declaration order for tests in the same
    module by default (collector ``Module.collect`` walks the AST top to
    bottom). Tests prefixed ``a_`` / ``b_`` document the dependency in
    the function names so a future contributor doesn't shuffle them.
    """
    assert _RESOLVED_URL is not None  # narrowed by skipif; mypy --strict

    # Build an independent engine + sessionmaker. We deliberately do NOT
    # reuse the fixture's engine because the fixture is function-scoped
    # and its engine has already been disposed by the time test_b runs
    # (this is precisely the boundary we want to assert across).
    engine = create_async_engine(_RESOLVED_URL, future=True)
    try:
        sessionmaker = async_sessionmaker(engine, expire_on_commit=False)
        async with sessionmaker() as session:
            result = await session.execute(
                select(Event).where(Event.id == _MARKER_EVENT_ID)
            )
            fetched = result.scalar_one_or_none()

        assert fetched is None, (
            "transactional_async_session fixture failed to roll back the "
            "row inserted by test_a. Expected a fresh session to find no "
            f"row for id={_MARKER_EVENT_ID!r}, but got "
            f"{fetched!r}. Investigate "
            "apps/api/tests/integration/conftest.py:"
            "transactional_async_session_fixture — likely a missing "
            "transaction.rollback() in the finally clause, or a leaked "
            "session.commit() that escaped the SAVEPOINT boundary."
        )
    finally:
        await engine.dispose()
