"""Real-Postgres round-trip for the ``trend_recipe_freshness`` migration.

Codex-review requirement (pivot M1 plan): the two new recipe columns must be
proven against a real database — ``upgrade head`` → columns exist with the
right types + nullability → ``downgrade content_gen_recipe_meta`` → columns
gone → ``upgrade head`` again succeeds (re-entrancy).

Skips (like every integration test here) when neither ``DATABASE_URL_TEST``
nor ``DATABASE_URL`` is set.
"""

from __future__ import annotations

import asyncio
import os
import subprocess
import sys
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

_APPS_API_ROOT = Path(__file__).resolve().parents[2]
_ALEMBIC_INI_PATH = _APPS_API_ROOT / "alembic.ini"

_HEAD_REVISION = "trend_recipe_freshness"
_PREVIOUS_REVISION = "content_gen_recipe_meta"
_CLI_TIMEOUT_SECONDS = 60


def _resolved_database_url() -> str | None:
    candidate = os.environ.get("DATABASE_URL_TEST") or os.environ.get("DATABASE_URL")
    return candidate or None


_RESOLVED_URL: str | None = _resolved_database_url()

_SKIP_REASON = (
    "Neither DATABASE_URL nor DATABASE_URL_TEST is set; skipping the "
    "real-Postgres round-trip for the trend_recipe_freshness migration. "
    "Locally: `docker compose up -d postgres` + export DATABASE_URL_TEST=..."
)


def _run_alembic(command: str, target: str, db_url: str) -> None:
    env = os.environ.copy()
    env["DATABASE_URL"] = db_url
    proc = subprocess.run(
        [
            sys.executable,
            "-m",
            "alembic",
            "-c",
            str(_ALEMBIC_INI_PATH),
            command,
            target,
        ],
        env=env,
        capture_output=True,
        text=True,
        timeout=_CLI_TIMEOUT_SECONDS,
        check=False,
    )
    assert proc.returncode == 0, (
        f"alembic {command} {target} failed (rc={proc.returncode}).\n"
        f"stdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
    )


def _recipe_columns(db_url: str) -> dict[str, tuple[str, str]]:
    """Return {column_name: (data_type, is_nullable)} for ``recipes``."""

    async def _query() -> dict[str, tuple[str, str]]:
        engine = create_async_engine(db_url, future=True)
        try:
            async with engine.connect() as conn:
                rows = await conn.execute(
                    text(
                        "SELECT column_name, data_type, is_nullable "
                        "FROM information_schema.columns "
                        "WHERE table_name = 'recipes'"
                    )
                )
                return {r[0]: (r[1], r[2]) for r in rows}
        finally:
            await engine.dispose()

    return asyncio.run(_query())


@pytest.mark.integration
@pytest.mark.skipif(_RESOLVED_URL is None, reason=_SKIP_REASON)
def test_trend_freshness_migration_round_trips_on_real_postgres() -> None:
    assert _RESOLVED_URL is not None  # narrowed by skipif; for mypy --strict

    # ---- Upgrade to head: both columns exist, correctly typed, nullable.
    _run_alembic("upgrade", "head", _RESOLVED_URL)
    cols = _recipe_columns(_RESOLVED_URL)
    assert cols.get("expires_at") == ("timestamp with time zone", "YES"), (
        f"recipes.expires_at must be a nullable timestamptz after upgrade; "
        f"got {cols.get('expires_at')!r}"
    )
    assert cols.get("format_template") == ("jsonb", "YES"), (
        f"recipes.format_template must be nullable jsonb after upgrade; "
        f"got {cols.get('format_template')!r}"
    )

    # ---- Downgrade one step: both columns are gone, the rest survive.
    _run_alembic("downgrade", _PREVIOUS_REVISION, _RESOLVED_URL)
    cols = _recipe_columns(_RESOLVED_URL)
    assert "expires_at" not in cols
    assert "format_template" not in cols
    assert "title" in cols, "downgrade must not touch the recipe_meta columns"

    # ---- Re-upgrade: the migration is re-entrant on the same database.
    _run_alembic("upgrade", "head", _RESOLVED_URL)
    cols = _recipe_columns(_RESOLVED_URL)
    assert "expires_at" in cols
    assert "format_template" in cols
