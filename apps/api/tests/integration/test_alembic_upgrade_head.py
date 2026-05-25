"""Integration test for the Phase 4.1 baseline alembic upgrade.

Acceptance criterion (Phase 4.1 Sub-AC 3) being verified
--------------------------------------------------------
Running

    alembic -c apps/api/alembic.ini upgrade phase_4_1_baseline

against a freshly provisioned Postgres 16 container (docker-compose locally,
GitHub Actions ``services: postgres:`` in CI) succeeds, and the resulting
``alembic_version`` bookkeeping table contains exactly one row whose
``version_num`` equals the Phase 4.1 baseline migration's deterministic
revision id (``phase_4_1_baseline``).

The target was tightened from ``head`` to the explicit baseline revision
once Phase 4.2 introduced the ``events`` migration: ``upgrade head`` now
runs past the baseline, so testing the baseline in isolation requires
naming it explicitly. The Phase 4.2 head behavior (``upgrade head`` →
``phase_4_2_events``) is covered by ``test_events_migration.py``.

Verification technique
----------------------
The test invokes the alembic CLI through ``subprocess.run`` with
``[sys.executable, "-m", "alembic", "-c", <abs-path-to-alembic.ini>,
"upgrade", "head"]`` so the assertion truly exercises the production
command path — the same invocation the CI workflow uses and the docker
smoke step runs locally. After the subprocess exits, the test opens a
SQLAlchemy 2.0 ``AsyncEngine`` against the same ``DATABASE_URL`` and
queries ``alembic_version`` directly to confirm the row count + value.

Pre-flight cleanup
------------------
Because the baseline migration's ``upgrade()`` is a no-op ``SELECT 1``
(zero DDL in Phase 4.1) and ``alembic upgrade head`` is naturally
idempotent — a second invocation against a DB already at ``head`` is a
no-op — running this test repeatedly against a persistent local
docker-compose volume should still produce exactly one row. To make the
"freshly provisioned" framing unconditional regardless of whether the
postgres container was just provisioned (CI) or was reused from a prior
``docker compose up`` (developer machine), the test drops
``alembic_version`` (if present) before invoking the CLI. The drop is
guarded by ``IF EXISTS`` so the very first run on a truly empty DB
remains a no-op.

Skip behavior
-------------
The test self-skips when neither ``DATABASE_URL`` nor
``DATABASE_URL_TEST`` is set, matching the precedent established by
``test_db_health.py`` in this directory. This keeps
``pytest -q apps/api/tests`` green on fresh checkouts that have not yet
brought up the postgres service container.
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
# ``parents[2]`` from apps/api/tests/integration/test_alembic_upgrade_head.py
# resolves to the apps/api/ root regardless of the pytest invocation cwd, so
# the alembic CLI invocation receives an absolute path to alembic.ini and
# never depends on the working directory at subprocess launch.
_APPS_API_ROOT: Path = Path(__file__).resolve().parents[2]
_ALEMBIC_INI_PATH: Path = _APPS_API_ROOT / "alembic.ini"

# The Phase 4.1 baseline migration ships ``revision = "phase_4_1_baseline"``
# as a deterministic, reviewable string id (Seed constraint:
# "revision_id fixed string"). Mirroring it as a module-level constant here
# couples the integration check to the same literal — if a future migration
# accidentally drops or rewrites the baseline, this test fails fast.
_EXPECTED_BASELINE_REVISION_ID: str = "phase_4_1_baseline"

# Alembic CLI subprocess timeout. The empty baseline migration's only DDL is
# a no-op ``SELECT 1``, so the realistic runtime is well under a second; 60s
# is a generous ceiling that protects against a wedged asyncpg connection
# without making a CI failure wait minutes.
_CLI_TIMEOUT_SECONDS: int = 60


def _resolved_database_url() -> str | None:
    """Return the test DB URL the integration test will exercise, or ``None``.

    Preference order mirrors ``test_db_health.py``:

        1. ``DATABASE_URL_TEST`` — the dedicated test database URL the Seed
           introduces alongside ``DATABASE_URL``.
        2. ``DATABASE_URL`` — fallback for developer machines that have not
           split the two URLs yet.

    Both lookups go through ``os.environ`` directly (not through
    :func:`api.config.env.get_database_url`) so the skip check stays fast
    and doesn't trigger a ``find_dotenv`` walk before pytest has even
    decided whether to collect the test.
    """
    candidate = os.environ.get("DATABASE_URL_TEST") or os.environ.get("DATABASE_URL")
    # Treat empty strings as "unset" so a stray ``DATABASE_URL=`` line in
    # ``.env`` doesn't lure the integration test into a malformed URL.
    if candidate is None or candidate == "":
        return None
    return candidate


# Skip decorator evaluated at collection time. We compute the resolved URL
# once and pass the bool to ``pytest.mark.skipif`` so the reason string can
# name the specific env var the developer needs to set.
_RESOLVED_URL: str | None = _resolved_database_url()


@pytest.mark.integration
@pytest.mark.skipif(
    _RESOLVED_URL is None,
    reason=(
        "Neither DATABASE_URL nor DATABASE_URL_TEST is set; skipping the "
        "real-Postgres integration test for `alembic upgrade head`. To run "
        "it locally: `docker compose up -d postgres` then export "
        "DATABASE_URL_TEST=postgresql+asyncpg://<user>:<pass>@localhost:5432/<db>."
    ),
)
async def test_alembic_upgrade_head_succeeds_and_writes_baseline_revision() -> None:
    """``alembic upgrade head`` → exit 0 + single baseline row in ``alembic_version``.

    The test:

        1. Drops the ``alembic_version`` bookkeeping table (if it exists)
           so the upgrade always runs against the "fresh" state described
           in the acceptance criterion, regardless of whether the postgres
           container persisted state from a prior run.
        2. Invokes ``python -m alembic -c <apps/api/alembic.ini> upgrade
           head`` via ``subprocess.run``, passing ``DATABASE_URL`` through
           the subprocess environment so ``env.py`` resolves the same URL
           the test uses for the post-condition query.
        3. Asserts the subprocess exit code is exactly 0; on a non-zero
           exit, surfaces the captured stdout + stderr in the assertion
           message so CI logs name the failure mode without requiring a
           re-run.
        4. Opens a fresh ``AsyncEngine`` and queries
           ``SELECT version_num FROM alembic_version`` — asserts exactly
           one row, and asserts that row's ``version_num`` equals
           ``"phase_4_1_baseline"`` (the Seed-pinned baseline revision id).
        5. Disposes the engine on the way out so the asyncpg pool releases
           its connections cleanly before the test exits.
    """
    # ``_RESOLVED_URL`` is guaranteed non-None here by the ``skipif`` above,
    # but the explicit assert satisfies mypy --strict's narrowing.
    assert _RESOLVED_URL is not None

    # ----- Step 1: drop alembic_version (if present) to simulate a fresh DB.
    # The drop runs in its own engine so the subprocess inherits no open
    # connections; ``begin()`` wraps the DROP in a transaction so the table
    # removal commits before the alembic CLI subprocess starts.
    setup_engine = create_async_engine(_RESOLVED_URL, future=True)
    try:
        async with setup_engine.begin() as conn:
            # Drop any Phase 4.2+ tables alongside the alembic bookkeeping
            # table so a re-run after the events migration shipped doesn't
            # collide on ``CREATE TABLE events`` (which is what alembic
            # would emit if a previous test left the table behind).
            await conn.execute(text("DROP TABLE IF EXISTS events CASCADE"))

            await conn.execute(text("DROP TABLE IF EXISTS users CASCADE"))
            await conn.execute(text("DROP TABLE IF EXISTS alembic_version"))
    finally:
        await setup_engine.dispose()

    # ----- Step 2: invoke alembic upgrade head via subprocess.
    # Use ``sys.executable -m alembic`` so the subprocess runs the same
    # Python interpreter (and therefore the same alembic version) the
    # pytest process is using. Passing the alembic.ini path absolutely
    # decouples the test from the subprocess working directory.
    env = os.environ.copy()
    env["DATABASE_URL"] = _RESOLVED_URL

    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "alembic",
            "-c",
            str(_ALEMBIC_INI_PATH),
            "upgrade",
            _EXPECTED_BASELINE_REVISION_ID,
        ],
        env=env,
        capture_output=True,
        text=True,
        timeout=_CLI_TIMEOUT_SECONDS,
        check=False,  # We assert returncode explicitly below for a richer message.
    )

    # ----- Step 3: assert exit code 0 with a diagnostic message on failure.
    assert result.returncode == 0, (
        f"`alembic -c {_ALEMBIC_INI_PATH} upgrade {_EXPECTED_BASELINE_REVISION_ID}` "
        f"exited with {result.returncode}; expected 0. Common failure modes are: "
        f"(a) Postgres container not running, (b) DATABASE_URL points at a "
        f"DB that refuses connections, (c) env.py raised during async engine "
        f"construction.\n"
        f"--- alembic stdout ---\n{result.stdout}\n"
        f"--- alembic stderr ---\n{result.stderr}"
    )

    # ----- Step 4: open a fresh engine and verify the alembic_version row.
    # A separate engine instance (rather than reusing ``setup_engine``,
    # which was disposed in step 1) keeps the pre-/post-condition phases
    # textually distinct and prevents any cached state from masking a
    # regression.
    verify_engine = create_async_engine(_RESOLVED_URL, future=True)
    try:
        async with verify_engine.connect() as conn:
            cursor = await conn.execute(text("SELECT version_num FROM alembic_version"))
            rows = cursor.all()

        # Exactly one row — the baseline migration is the only revision
        # shipped at the head when upgrading to phase_4_1_baseline, so
        # ``upgrade phase_4_1_baseline`` must produce exactly one stamp
        # in alembic_version.
        assert len(rows) == 1, (
            f"`alembic_version` must contain exactly one row after "
            f"`upgrade {_EXPECTED_BASELINE_REVISION_ID}`; found {len(rows)} "
            f"row(s): {rows!r}. More than one row indicates the migration "
            f"chain branched (which Phase 4.1 explicitly disallows); zero "
            f"rows indicates the upgrade silently no-op'd without stamping."
        )

        # The single row's version_num must equal the deterministic
        # baseline revision id pinned by the Seed.
        actual_revision = rows[0][0]
        assert actual_revision == _EXPECTED_BASELINE_REVISION_ID, (
            f"`alembic_version.version_num` must equal "
            f"{_EXPECTED_BASELINE_REVISION_ID!r} (the Phase 4.1 baseline "
            f"revision id); got {actual_revision!r}. A drifted value "
            f"indicates the baseline migration's ``revision`` constant was "
            f"renamed without updating this test (or vice versa)."
        )
    finally:
        # ----- Step 5: dispose the verification engine.
        # Wrapped in ``try/finally`` so a failed assertion still triggers
        # connection-pool cleanup before the test exits.
        await verify_engine.dispose()
