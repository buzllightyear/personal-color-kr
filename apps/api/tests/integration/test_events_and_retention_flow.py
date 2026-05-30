"""End-to-end integration: ingest events + assemble retention (Phase 4.4).

Runs against a real Postgres 16 (``DATABASE_URL_TEST`` / ``DATABASE_URL``);
self-skips otherwise via the shared ``transactional_async_session``
fixture. All writes roll back on teardown.

Validated:

    * ``POST /v1/events`` inserts exactly one row for the authenticated
      user and returns HTTP 201 with the forced ``user_id``.
    * ``GET /v1/metrics/retention`` assembles the cohort denominator and
      active numerator from the ``events`` table and returns the correct
      ``retention_rate`` (1 of 4 cohort users active → 0.25) — proving the
      events table is the sole source of truth for the calculation.
"""

from __future__ import annotations

import os
import subprocess
import sys
import uuid
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from api.db.models.user import User
from api.db.repositories.events_repository import insert_event
from api.db.session import get_session
from api.dependencies.auth import require_current_user
from api.main import create_app

# ``parents[2]`` from apps/api/tests/integration/test_*.py resolves to apps/api/
# so the alembic CLI subprocess receives an absolute path regardless of pytest cwd.
_APPS_API_ROOT: Path = Path(__file__).resolve().parents[2]
_ALEMBIC_INI_PATH: Path = _APPS_API_ROOT / "alembic.ini"
_ALEMBIC_CLI_TIMEOUT_SECONDS: int = 60


async def _reset_db_and_upgrade_head(url: str) -> None:
    """Drop ``events`` + ``users`` + ``alembic_version`` and run ``alembic upgrade head``.

    The seeded_app fixture needs both tables at head; ``test_alembic_upgrade_head.py``
    (alphabetically prior) leaves the DB at the baseline revision, so we cannot
    assume the schema is already at head. Mirrors the pattern in
    ``test_events_model_roundtrip.py``.
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
        timeout=_ALEMBIC_CLI_TIMEOUT_SECONDS,
        check=False,
    )
    if result.returncode != 0:  # pragma: no cover — exercised only on failure
        raise RuntimeError(
            f"alembic upgrade head failed (exit {result.returncode}): "
            f"{result.stdout}\n{result.stderr}"
        )


async def _make_user(session: AsyncSession, apple_sub: str) -> User:
    now = datetime.now(timezone.utc)
    user = User(
        id=uuid.uuid4(),
        apple_sub=apple_sub,
        email=None,
        email_verified=False,
        display_name=None,
        created_at=now,
        updated_at=now,
    )
    session.add(user)
    await session.flush()
    return user


@pytest_asyncio.fixture(name="seeded_app")
async def seeded_app_fixture(
    resolved_test_database_url: str,
    transactional_async_session: AsyncSession,
) -> AsyncIterator[tuple[Any, User]]:
    """Seed 4 cohort users (1 active) and yield an app bound to the session.

    Calls ``_reset_db_and_upgrade_head`` first so the test is robust to whatever
    schema state prior tests left behind (e.g. ``test_alembic_upgrade_head.py``
    intentionally downgrades to baseline).
    """
    await _reset_db_and_upgrade_head(resolved_test_database_url)
    session = transactional_async_session
    cohort_users = [await _make_user(session, f"sub-{i}") for i in range(4)]

    cohort_at = datetime(2026, 1, 3, 12, 0, tzinfo=timezone.utc)
    active_at = datetime(2026, 1, 20, 12, 0, tzinfo=timezone.utc)

    # All four users are in the cohort (emitted magazine_delivered in window).
    for user in cohort_users:
        await insert_event(
            session,
            anonymous_id=f"anon-{user.apple_sub}",
            event_name="magazine_delivered",
            occurred_at=cohort_at,
            properties={},
            user_id=user.id,
        )
    # Only the first user is active (emitted magazine_viewed in the window).
    await insert_event(
        session,
        anonymous_id="anon-active",
        event_name="magazine_viewed",
        occurred_at=active_at,
        properties={},
        user_id=cohort_users[0].id,
    )
    await session.flush()

    app = create_app()
    auth_user = cohort_users[0]

    def _override_user() -> User:
        return auth_user

    async def _override_session() -> AsyncIterator[AsyncSession]:
        yield session

    app.dependency_overrides[require_current_user] = _override_user
    app.dependency_overrides[get_session] = _override_session
    yield app, auth_user


@pytest.mark.integration
async def test_post_event_inserts_row(
    seeded_app: tuple[Any, User],
) -> None:
    app, auth_user = seeded_app
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        response = await client.post(
            "/v1/events",
            json={
                "anonymous_id": "anon-ingest",
                "event_name": "magazine_shared",
                "occurred_at": "2026-01-25T09:30:00+00:00",
            },
        )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["user_id"] == str(auth_user.id)
    assert body["event_name"] == "magazine_shared"


@pytest.mark.integration
async def test_get_retention_from_events_table(
    seeded_app: tuple[Any, User],
) -> None:
    app, _ = seeded_app
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        response = await client.get(
            "/v1/metrics/retention",
            params={
                "cohort_event": "magazine_delivered",
                "cohort_start": "2026-01-01",
                "cohort_end": "2026-01-07",
                "active_event": "magazine_viewed",
                "window_days": "30",
            },
        )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["cohort_size"] == 4
    assert body["active_size"] == 1
    assert body["retention_rate"] == pytest.approx(0.25)
    assert body["threshold_met"] is True
