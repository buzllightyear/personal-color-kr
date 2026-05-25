"""Shared integration-tier fixtures for ``apps/api/tests/integration/``.

Acceptance criteria covered
---------------------------
* **Sub-AC 8.1** — Async engine/session factory fixture bound to
  ``DATABASE_URL_TEST`` (fixtures ``async_engine``, ``async_session_factory``,
  ``async_session``, and helper ``resolved_test_database_url``).
* **Sub-AC 8.2** — Session-scoped fixture (``alembic_upgraded_database_url``)
  that runs ``alembic upgrade head`` against ``DATABASE_URL_TEST`` exactly
  once per pytest session, so downstream tests can assume the events table
  (and any future Phase 4.3+ tables) exists without paying a per-test
  migration cost.
* **Sub-AC 8.3** — Function-scoped transactional rollback fixture
  (``transactional_async_session``) that wraps each test in an outer
  transaction plus a nested SAVEPOINT and discards every write on teardown.
  Companion verification test
  (:mod:`tests.integration.test_transactional_rollback_fixture`) inserts a
  row through the fixture and then asserts a fresh non-transactional session
  cannot see it once the fixture has rolled back.

This module centralizes the boilerplate that the existing
``test_events_model_roundtrip.py`` / ``test_events_migration.py`` /
``test_db_health.py`` files each duplicate inline (URL resolution, engine
construction, session factory, skip decision). Phase 4.3+ tests can now
opt into the fixtures by declaring ``async_engine``, ``async_session_factory``,
or ``async_session`` as a parameter — keeping per-test setup focused on the
behavior under test rather than asyncpg plumbing.

Why does the fixture live here (not in ``apps/api/tests/conftest.py``)?
-----------------------------------------------------------------------
Putting it in the integration directory's ``conftest.py`` means:

    1. Unit-tier tests (``apps/api/tests/unit/``) cannot accidentally pull
       in a real Postgres connection by typing the fixture name — the
       fixture is invisible to those modules.
    2. The skip decision is co-located with the directory whose ``__init__``
       docstring already documents the "self-skip on missing URL" contract.
    3. Adding more integration fixtures later (e.g., a per-test transactional
       savepoint helper) lands in the same file.

Skip semantics
--------------
Both fixtures self-skip the consuming test when neither
``DATABASE_URL_TEST`` nor ``DATABASE_URL`` is set (empty strings count as
"unset" to defang stray ``DATABASE_URL=`` lines in ``.env``). The skip
matches the precedent established in
``test_db_health.py`` / ``test_events_migration.py`` so a fresh checkout
(no ``.env``, no docker-compose) can still run ``pytest -q apps/api/tests``
and stay green.

Cleanup
-------
``async_engine`` is function-scoped and disposes the engine on teardown.
Function scope (rather than session scope) keeps each test isolated from
pool-state bleed and matches the disposal pattern the existing inline
tests already use. The disposal call closes every idle asyncpg connection
so the test exits without ``ResourceWarning: unclosed transport`` noise.
"""

from __future__ import annotations

import asyncio
import os
import subprocess
import sys
from collections.abc import AsyncIterator, Iterator
from pathlib import Path

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncConnection,
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)


def _resolved_test_database_url() -> str | None:
    """Return the test DB URL (``DATABASE_URL_TEST`` ▸ ``DATABASE_URL``).

    Lookup order (matches every other file in this directory):

        1. ``DATABASE_URL_TEST`` — the dedicated test database URL.
        2. ``DATABASE_URL``      — fallback for dev machines that have
                                    not split the two URLs yet.

    Empty strings count as "unset" so a stray ``DATABASE_URL=`` line in
    ``.env`` does not lure the integration tier into a malformed URL.
    """
    candidate = os.environ.get("DATABASE_URL_TEST") or os.environ.get("DATABASE_URL")
    if candidate is None or candidate == "":
        return None
    return candidate


# Module-level constant so the skip decision (and the failure message)
# are computed once per collection rather than re-resolved per fixture.
_RESOLVED_URL: str | None = _resolved_test_database_url()

_SKIP_REASON: str = (
    "Neither DATABASE_URL_TEST nor DATABASE_URL is set; skipping the "
    "integration-tier fixture that requires a real Postgres 16 "
    "connection. To run locally: `docker compose up -d postgres` then "
    "export DATABASE_URL_TEST=postgresql+asyncpg://<user>:<pass>@"
    "127.0.0.1:5432/<db>."
)


@pytest.fixture(name="resolved_test_database_url")
def resolved_test_database_url_fixture() -> str:
    """Expose the resolved test DB URL or skip the consuming test.

    Tests that only need the URL string (e.g., subprocess invocations of
    ``alembic`` or one-off ``create_async_engine`` calls in a single test)
    can request this fixture and rely on the skip-when-missing behavior
    without re-implementing the env-var lookup.

    Returns
    -------
    str
        The resolved ``DATABASE_URL_TEST`` (or ``DATABASE_URL``) value.

    Raises
    ------
    pytest.skip.Exception
        Implicitly, via :func:`pytest.skip`, when neither variable is set.
        The reason string names the variables and the docker-compose
        bootstrap command so the developer knows exactly what to run.
    """
    if _RESOLVED_URL is None:
        pytest.skip(_SKIP_REASON)
    return _RESOLVED_URL


@pytest_asyncio.fixture(name="async_engine")
async def async_engine_fixture() -> AsyncIterator[AsyncEngine]:
    """Yield a fresh :class:`AsyncEngine` bound to the resolved test URL.

    A new engine is constructed per test (function scope) so:

        1. ``Engine.dispose`` runs on every teardown — the asyncpg pool
           closes its idle connections before pytest reports the result,
           which suppresses ``ResourceWarning: unclosed transport`` noise.
        2. Tests that mutate URL-derived behavior (rare today, but the
           Phase 4.4 cohort-sync layer may exercise per-test schemas) do
           not inherit a stale pool.
        3. The cost of building an engine without opening a connection is
           negligible — ``create_async_engine`` does no I/O until the
           first ``begin()`` / ``connect()`` call.

    Yields
    ------
    AsyncEngine
        A SQLAlchemy 2.0 async engine pointed at the resolved test URL.
    """
    if _RESOLVED_URL is None:
        pytest.skip(_SKIP_REASON)
    # ``future=True`` matches the production engine in ``api.db.engine``
    # (no-op on SQLAlchemy 2.x; documents intent and protects against
    # accidental 1.4-compat regressions).
    engine = create_async_engine(_RESOLVED_URL, future=True)
    try:
        yield engine
    finally:
        # ``AsyncEngine.dispose`` closes every idle connection in the
        # pool. Pending in-flight queries are NOT cancelled; tests must
        # close their own sessions before the fixture teardown runs.
        await engine.dispose()


@pytest_asyncio.fixture(name="async_session_factory")
async def async_session_factory_fixture(
    async_engine: AsyncEngine,
) -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    """Yield an :class:`async_sessionmaker` bound to ``async_engine``.

    Tests that need to open multiple sessions (e.g., a writer session and
    a reader session against the same engine) consume the factory directly
    instead of the single-session ``async_session`` fixture below.

    ``expire_on_commit=False`` matches the production sessionmaker in
    :func:`api.db.session.get_session`. ORM attributes therefore stay
    live after ``session.commit`` — which is irrelevant to the SELECT 1
    smoke test below but matters to Phase 4.3+ tests that read ORM rows
    after committing.

    Yields
    ------
    async_sessionmaker[AsyncSession]
        A sessionmaker bound to the per-test engine.
    """
    yield async_sessionmaker(async_engine, expire_on_commit=False)


@pytest_asyncio.fixture(name="async_session")
async def async_session_fixture(
    async_session_factory: async_sessionmaker[AsyncSession],
) -> AsyncIterator[AsyncSession]:
    """Yield a single :class:`AsyncSession` opened via ``async_session_factory``.

    The session is opened inside an ``async with`` block so the context
    manager's ``__aexit__`` rolls back any uncommitted transaction and
    closes the underlying connection on teardown — even if the test
    raises before reaching its own cleanup code.

    Yields
    ------
    AsyncSession
        A SQLAlchemy 2.0 async session ready for
        ``await session.execute(...)`` round-trips.
    """
    async with async_session_factory() as session:
        yield session


# ---------------------------------------------------------------------------
# Sub-AC 8.3 — Function-scoped transactional rollback fixture.
# ---------------------------------------------------------------------------
# The ``transactional_async_session`` fixture wraps each test in an outer
# transaction PLUS a nested SAVEPOINT bound through SQLAlchemy 2.0's
# ``join_transaction_mode="create_savepoint"`` switch. On teardown the outer
# transaction is rolled back unconditionally, so any rows the test inserted
# (or updated) are discarded before the next test runs.
#
# Why both an outer transaction AND a SAVEPOINT?
#     A bare outer transaction is enough WHEN the test never calls
#     ``session.commit()``. As soon as the test does commit (which is the
#     realistic shape of any code under test that exercises the production
#     "INSERT row, commit, re-read" flow), the commit escapes the outer
#     transaction and the rollback at teardown becomes a no-op. The
#     ``create_savepoint`` join mode makes every ``session.commit()`` release
#     a SAVEPOINT instead — the outer transaction remains open and the
#     teardown rollback can still discard the writes.
#
#     SQLAlchemy 2.0's session implementation automatically re-opens a new
#     SAVEPOINT after each release, so a single test can do an arbitrary
#     number of commit cycles inside the fixture without escaping.
#
# Why function scope?
#     Each test gets a clean slate. A session-scoped variant would let row
#     writes from one test leak as visible (uncommitted) state into the
#     next — defeating the isolation contract we are trying to enforce.
@pytest_asyncio.fixture(name="transactional_async_session")
async def transactional_async_session_fixture(
    async_engine: AsyncEngine,
) -> AsyncIterator[AsyncSession]:
    """Yield an :class:`AsyncSession` wrapped in a rollback-only transaction.

    Pattern (SQLAlchemy 2.0 "join into an external transaction")
    ------------------------------------------------------------
    1. Open a fresh :class:`AsyncConnection` from the per-test engine.
    2. Begin an outer transaction on that connection — every write the
       test performs lives inside this transaction.
    3. Open an :class:`AsyncSession` bound to the connection with
       ``join_transaction_mode="create_savepoint"`` so any
       ``session.commit()`` inside the test releases a SAVEPOINT rather
       than escaping the outer transaction.
    4. Yield the session to the test.
    5. On teardown:
         a. ``await session.close()`` releases the session's bind back to
            the connection without committing anything.
         b. ``await transaction.rollback()`` (guarded by ``is_active``)
            discards every uncommitted row the test inserted.
         c. The ``async with engine.connect()`` context manager closes the
            underlying connection cleanly, returning it to the engine
            pool (which is then disposed by ``async_engine_fixture``).

    Why the ``is_active`` guard on rollback?
        If the test code drives the connection to a hard error (e.g., a
        constraint violation that asyncpg surfaces as a broken
        transaction), the outer transaction may already be in an aborted
        state where SQLAlchemy auto-rolls-back. Calling ``rollback()``
        again would raise; the guard makes teardown idempotent.

    Yields
    ------
    AsyncSession
        A session whose writes are guaranteed to be invisible outside
        the test once the fixture tears down.
    """
    connection: AsyncConnection
    async with async_engine.connect() as connection:
        transaction = await connection.begin()
        try:
            # ``join_transaction_mode="create_savepoint"`` is the
            # SQLAlchemy 2.0 idiom for "this session lives inside an
            # external transaction; treat every commit as a savepoint
            # release instead of letting it escape upward". Equivalent to
            # the legacy event-listener `restart_savepoint` pattern but
            # built into the framework so we don't carry the listener
            # boilerplate.
            session = AsyncSession(
                bind=connection,
                expire_on_commit=False,
                join_transaction_mode="create_savepoint",
            )
            try:
                yield session
            finally:
                # Close the session first so the bind is released cleanly
                # before we roll back the outer transaction.
                await session.close()
        finally:
            # Rollback only when the transaction is still alive. If the
            # test triggered an asyncpg-level transaction abort, the
            # connection has already discarded the work and a second
            # rollback would raise ``InvalidRequestError``.
            if transaction.is_active:
                await transaction.rollback()


# ---------------------------------------------------------------------------
# Sub-AC 8.2 — Session-scoped ``alembic upgrade head`` fixture.
# ---------------------------------------------------------------------------
# ``parents[2]`` from apps/api/tests/integration/conftest.py resolves to
# apps/api/ regardless of pytest cwd, so the alembic CLI subprocess always
# receives an absolute path to ``alembic.ini``. Resolving this once at module
# import keeps the session-scoped fixture body free of path arithmetic.
_APPS_API_ROOT: Path = Path(__file__).resolve().parents[2]
_ALEMBIC_INI_PATH: Path = _APPS_API_ROOT / "alembic.ini"

# Generous ceiling for the alembic CLI subprocess. The Phase 4.2 events
# migration emits a CREATE TABLE + 2 CREATE INDEX statements with no data
# backfill; realistic runtime is well under a second. 60s protects against
# a wedged asyncpg connection without making CI wait minutes on a hang.
_ALEMBIC_CLI_TIMEOUT_SECONDS: int = 60


async def _reset_db_to_blank_for_session(db_url: str) -> None:
    """Drop ``events`` (CASCADE) and ``alembic_version`` so the upgrade is fresh.

    The session-scoped upgrade fixture must produce identical state on every
    CI run regardless of whether the docker-compose postgres volume carries
    leftover rows from a prior local run. We drop ``events`` first (the
    ``CASCADE`` clean-sweeps its two indexes alongside the table) and then
    ``alembic_version`` so ``alembic upgrade head`` re-stamps the chain
    from scratch.

    Both drops are guarded with ``IF EXISTS`` so the very first invocation
    on a brand-new container is a no-op rather than an error.

    Why a private helper rather than reusing the one in
    ``test_events_migration.py``?
        That file's helper is module-private (the leading underscore is
        deliberate — pytest treats it as test-internal). Reaching across
        modules would couple two test files; copy-paste here is the cheaper
        contract that keeps each module self-contained.
    """
    engine = create_async_engine(db_url, future=True)
    try:
        async with engine.begin() as conn:
            await conn.execute(text("DROP TABLE IF EXISTS events CASCADE"))

            await conn.execute(text("DROP TABLE IF EXISTS users CASCADE"))
            await conn.execute(text("DROP TABLE IF EXISTS alembic_version"))
    finally:
        await engine.dispose()


@pytest.fixture(scope="session", name="alembic_upgraded_database_url")
def alembic_upgraded_database_url_fixture() -> Iterator[str]:
    """Run ``alembic upgrade head`` once per pytest session.

    Acceptance criterion (Sub-AC 8.2)
    ---------------------------------
    "Add session-scoped alembic upgrade fixture that runs migrations to
    head on setup against ``DATABASE_URL_TEST``."

    Why session scope?
        Migrating from baseline to head is identical for every test that
        wants to assume "the schema is at head"; amortizing the cost across
        the whole pytest session keeps the integration tier fast on CI
        while still exercising the production CLI path. Tests that depend
        on schema *transitions* (the existing
        ``test_alembic_downgrade_to_baseline_drops_events_table_cleanly``)
        deliberately do NOT consume this fixture — they own their own
        ``upgrade``/``downgrade`` sequencing.

    Why sync ``@pytest.fixture`` rather than ``@pytest_asyncio.fixture``?
        Session-scoped async fixtures under ``asyncio_mode = "auto"``
        require either a session-scoped event loop (intrusive for
        unrelated tests) or careful ``loop_scope`` annotations that vary
        across pytest-asyncio versions. The alembic CLI subprocess is
        already synchronous; the only async work is the optional
        pre-upgrade cleanup, which we drive via :func:`asyncio.run` from
        the sync fixture body. ``asyncio.run`` is safe here because the
        sync fixture executes outside any active event loop (pytest sets
        up async-test loops per function, not at session-scope teardown).

    Why ``Iterator[str]`` (yield) instead of plain return?
        The yield form lets the fixture publish a teardown step if a
        future revision needs one (e.g., a final ``alembic downgrade base``
        for CI hygiene). Today the teardown is intentionally empty: the
        next session's session-fixture invocation will re-drop and
        re-upgrade, so leaving the schema at head between sessions is a
        no-op for correctness and faster for repeated local runs.

    Skip semantics
    --------------
    Falls back to ``DATABASE_URL`` when ``DATABASE_URL_TEST`` is unset
    (matching every other fixture in this file). When neither is set, the
    fixture calls :func:`pytest.skip` so any consuming test self-skips
    with the same diagnostic message users see on the rest of the tier.

    Yields
    ------
    str
        The resolved test database URL. Downstream tests can pass this to
        ``create_async_engine`` to query schema state introspectively.
    """
    if _RESOLVED_URL is None:
        pytest.skip(_SKIP_REASON)

    # Step 1 — deterministic starting state. ``asyncio.run`` builds and
    # tears down an event loop just for the cleanup coroutine; the loop
    # closes cleanly before the alembic subprocess starts, so the pool
    # has no chance of stranding connections that would race the
    # subsequent CREATE TABLE.
    asyncio.run(_reset_db_to_blank_for_session(_RESOLVED_URL))

    # Step 2 — invoke ``alembic upgrade head`` via the production CLI
    # path. ``sys.executable -m alembic`` guarantees the subprocess uses
    # the same Python interpreter (and therefore the same alembic
    # version) as the pytest process. The absolute alembic.ini path
    # decouples the test from subprocess cwd. We export DATABASE_URL into
    # the subprocess environment so ``env.py``'s URL resolver picks up
    # the same value our cleanup engine used.
    cli_env = os.environ.copy()
    cli_env["DATABASE_URL"] = _RESOLVED_URL

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

    # Step 3 — surface a rich diagnostic if the CLI fails. The session
    # fixture is the upstream of many downstream tests, so a single clear
    # message here saves debugging a cascade of mysterious AssertionErrors.
    assert completed.returncode == 0, (
        "Session-scoped fixture `alembic_upgraded_database_url` failed: "
        f"`alembic -c {_ALEMBIC_INI_PATH} upgrade head` exited with "
        f"{completed.returncode}; expected 0. Common failure modes are: "
        "(a) Postgres container not running (check `docker compose ps`), "
        "(b) DATABASE_URL_TEST points at a DB that refuses connections, "
        "(c) env.py raised during async engine construction.\n"
        f"--- alembic stdout ---\n{completed.stdout}\n"
        f"--- alembic stderr ---\n{completed.stderr}"
    )

    # Step 4 — publish the URL. ``yield`` rather than ``return`` so a
    # future revision can attach teardown logic without changing the
    # fixture's call signature.
    yield _RESOLVED_URL
