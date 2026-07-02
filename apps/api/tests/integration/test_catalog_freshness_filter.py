"""Real-Postgres verification of the catalog freshness filter (pivot M1).

Codex review R1: the catalog's compound WHERE —
``status = 'published' AND (expires_at IS NULL OR expires_at > now)`` —
cannot be proven by the unit-tier stub session (a wrong query could still
pass), so the exclusion/inclusion semantics are pinned here against real
Postgres with seeded rows, including a near-boundary case.

Uses the shared integration fixtures: ``alembic_upgraded_database_url``
(schema at head, once per session) + ``transactional_async_session``
(rollback-only — seeded rows never leak).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from api.db.models.recipe import RECIPE_STATUS_PUBLISHED, Recipe
from api.routers.recipes import build_catalog_statement


def _recipe(recipe_id: str, expires_at: datetime | None) -> Recipe:
    recipe = Recipe()
    recipe.id = uuid.uuid4()
    recipe.recipe_id = recipe_id
    recipe.model_id = "fal-ai/flux-2/edit"
    recipe.prompt_template = "trend look"
    recipe.title = recipe_id
    recipe.status = RECIPE_STATUS_PUBLISHED
    recipe.publish_date = datetime.now(timezone.utc)
    recipe.expires_at = expires_at
    return recipe


@pytest.mark.integration
async def test_catalog_statement_freshness_semantics_on_real_postgres(
    alembic_upgraded_database_url: str,
    transactional_async_session: AsyncSession,
) -> None:
    session = transactional_async_session
    now = datetime.now(timezone.utc)

    session.add_all(
        [
            _recipe("it_evergreen", None),
            _recipe("it_fresh", now + timedelta(days=7)),
            _recipe("it_barely_fresh", now + timedelta(minutes=1)),
            _recipe("it_expired", now - timedelta(days=1)),
            _recipe("it_barely_expired", now - timedelta(seconds=1)),
        ]
    )
    await session.commit()

    result = await session.execute(build_catalog_statement(now))
    ids = {r.recipe_id for r in result.scalars().all() if r.recipe_id.startswith("it_")}

    assert ids == {"it_evergreen", "it_fresh", "it_barely_fresh"}, (
        f"freshness filter must include evergreen (NULL) + future expiries and "
        f"exclude past expiries (boundary: -1s is out, +1min is in); got {ids!r}"
    )
