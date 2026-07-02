"""Unit tests for Sub-AC 1: ``GET /v1/recipes`` public catalog endpoint.

Acceptance criteria verified
------------------------------
1. Sort order — only published recipes returned, sorted by
   ``publish_date DESC, display_order ASC``.
2. Empty catalog — ``GET /v1/recipes`` returns ``{"recipes": [], "total": 0}``
   when no recipes are published.
3. Auth-gated access — the endpoint requires a valid bearer JWT;
   requests without a token receive HTTP 401.

Test strategy
-------------
All tests use ``create_app()`` with ``dependency_overrides`` to replace
``get_session`` with an in-memory stub so no real Postgres connection is
needed.

For the auth-gated test, the conftest auto-stub for
``require_current_user`` is cleared (``dependency_overrides.pop``) so
the real dependency runs and returns HTTP 401 on a missing
``Authorization`` header.

The sort-order test populates the stub with recipes that are already
in descending-publish_date / ascending-display_order sequence (matching
what PostgreSQL would return) and verifies that the endpoint preserves
and projects them correctly.  A secondary assertion verifies that
hidden and deleted recipes are excluded from the response even when
the stub holds them alongside published entries.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncGenerator
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient

from api.db.models.recipe import (
    RECIPE_STATUS_DELETED,
    RECIPE_STATUS_HIDDEN,
    RECIPE_STATUS_PUBLISHED,
    Recipe,
)
from api.db.models.user import User
from api.db.session import get_session
from api.dependencies.auth import require_current_user
from api.main import create_app

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_BASE_URL = "http://testserver"
_CATALOG_URL = "/v1/recipes"

_NOW = datetime.now(timezone.utc)
_DAY1 = _NOW - timedelta(days=1)
_DAY2 = _NOW - timedelta(days=2)
_DAY3 = _NOW - timedelta(days=3)


# ---------------------------------------------------------------------------
# Helpers: in-memory stub session
# ---------------------------------------------------------------------------


def _make_recipe(
    *,
    recipe_id: str,
    status: str = RECIPE_STATUS_PUBLISHED,
    publish_date: datetime | None = None,
    display_order: int = 0,
    expires_at: datetime | None = None,
) -> Recipe:
    """Build an in-memory Recipe ORM object (no DB round-trip)."""
    recipe = Recipe()
    recipe.id = uuid.uuid4()
    recipe.recipe_id = recipe_id
    recipe.model_id = "fal-ai/flux/dev"
    recipe.prompt_template = "A test prompt for {personal_color_modifier}"
    recipe.style_reference_key = None
    recipe.parameters = {}
    recipe.status = status
    recipe.publish_date = publish_date
    recipe.display_order = display_order
    recipe.created_at = _NOW
    recipe.updated_at = _NOW
    recipe.title = "Test Recipe"
    recipe.description = None
    recipe.tags = []
    recipe.thumbnail_url = None
    recipe.expires_at = expires_at
    recipe.format_template = None
    return recipe


class _StubSelectResult:
    """Minimal result proxy for ``await session.execute(select(Recipe)...)``."""

    def __init__(self, rows: list[Recipe]) -> None:
        self._rows = rows

    def scalars(self) -> "_StubScalars":
        return _StubScalars(self._rows)

    def scalar_one_or_none(self) -> Recipe | None:
        return self._rows[0] if self._rows else None


class _StubScalars:
    def __init__(self, rows: list[Recipe]) -> None:
        self._rows = rows

    def all(self) -> list[Recipe]:
        return self._rows


def _row_matches_clause(row: Recipe, clause: Any) -> bool:
    """Duck-typed interpreter for the catalog query's WHERE tree.

    Understands AND/OR lists, ``==``, ``IS NULL``, and ``>`` — the exact
    operators the catalog statement uses (status equality + the freshness
    ``expires_at IS NULL OR expires_at > now`` disjunction). Anything else
    raises AttributeError so the stub fails loud instead of silently
    returning unfiltered rows.

    NOTE: this stub interprets the clause like Postgres would for these
    operators, but the authoritative freshness verification is the
    integration-tier seeded test (unit stubs cannot prove SQL semantics —
    codex review R1).
    """
    children = getattr(clause, "clauses", None)
    op_name = getattr(getattr(clause, "operator", None), "__name__", "")
    if children is not None:
        results = [_row_matches_clause(row, child) for child in children]
        if op_name == "or_":
            return any(results)
        return all(results)
    col_name = str(clause.left.key)
    value = getattr(row, col_name, None)
    right = clause.right
    if op_name == "is_" and type(right).__name__ == "Null":
        return value is None
    if op_name == "eq":
        return bool(value == right.value)
    if op_name == "gt":
        return value is not None and bool(value > right.value)
    raise AttributeError(f"unsupported operator in stub: {op_name!r}")


class _CatalogStubSession:
    """In-memory async session stub for catalog endpoint tests.

    Interprets the statement's WHERE tree via :func:`_row_matches_clause`
    (status equality + the freshness disjunction).  Returns rows in the
    order they were provided to the constructor (callers are responsible
    for supplying them in the DB-sorted order they wish to simulate).
    """

    def __init__(self, recipes: list[Recipe]) -> None:
        self._recipes = list(recipes)

    async def execute(self, stmt: Any) -> _StubSelectResult:
        """Simulate ``SELECT recipes WHERE ... ORDER BY ...``."""
        rows = list(self._recipes)
        whereclause = getattr(stmt, "whereclause", None)
        if whereclause is not None:
            rows = [r for r in rows if _row_matches_clause(r, whereclause)]
        return _StubSelectResult(rows)


# ---------------------------------------------------------------------------
# Fixtures: deterministic stub user (for auth-bypassed tests)
# ---------------------------------------------------------------------------


def _known_user() -> User:
    """Return a deterministic in-memory User (no DB round-trip)."""
    user = User()
    user.id = uuid.uuid4()
    user.apple_sub = "stub-apple-sub-for-catalog-tests"
    user.email = None
    user.email_verified = False
    user.display_name = None
    user.referral_code = "AAAAAAAA"
    user.referrer_user_id = None
    user.created_at = _NOW
    user.updated_at = _NOW
    return user


def _build_catalog_app(recipes: list[Recipe]) -> Any:
    """Return a FastAPI app with session and auth overridden for catalog tests."""
    app = create_app()
    stub = _CatalogStubSession(recipes)

    async def _stub_session() -> AsyncGenerator[_CatalogStubSession, None]:
        yield stub

    app.dependency_overrides[get_session] = _stub_session
    app.dependency_overrides[require_current_user] = _known_user
    return app


# ---------------------------------------------------------------------------
# Tests: 1 — Sort order and status filtering
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_catalog_returns_only_published_recipes() -> None:
    """GET /v1/recipes excludes hidden and deleted recipes."""
    published = _make_recipe(
        recipe_id="pub_only",
        status=RECIPE_STATUS_PUBLISHED,
        publish_date=_DAY1,
        display_order=0,
    )
    hidden = _make_recipe(
        recipe_id="hidden_excluded",
        status=RECIPE_STATUS_HIDDEN,
    )
    deleted = _make_recipe(
        recipe_id="deleted_excluded",
        status=RECIPE_STATUS_DELETED,
    )
    # Provide all three; stub filters by status so only published returns.
    app = _build_catalog_app([published, hidden, deleted])

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url=_BASE_URL
    ) as client:
        resp = await client.get(_CATALOG_URL)

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["total"] == 1
    recipe_ids = [r["recipe_id"] for r in data["recipes"]]
    assert recipe_ids == ["pub_only"]
    assert "hidden_excluded" not in recipe_ids
    assert "deleted_excluded" not in recipe_ids


@pytest.mark.unit
@pytest.mark.asyncio
async def test_catalog_sort_order_publish_date_desc_display_order_asc() -> None:
    """GET /v1/recipes returns published recipes in the expected sort order.

    The endpoint delegates sorting to the DB (``ORDER BY publish_date DESC,
    display_order ASC``). The stub simulates the DB by providing recipes in
    the expected sorted order; the test verifies the endpoint preserves and
    projects that order correctly.

    Expected order (published_date DESC, display_order ASC):
        1. recipe_day1_ord1  (publish_date=DAY1, display_order=1) ← newest
        2. recipe_day1_ord2  (publish_date=DAY1, display_order=2) ← same date, higher order
        3. recipe_day2_ord0  (publish_date=DAY2, display_order=0) ← older date
        4. recipe_day3_ord5  (publish_date=DAY3, display_order=5) ← oldest
    """
    # Build recipes in the DB-sorted order (as PostgreSQL would return them).
    r1 = _make_recipe(
        recipe_id="recipe_day1_ord1",
        status=RECIPE_STATUS_PUBLISHED,
        publish_date=_DAY1,
        display_order=1,
    )
    r2 = _make_recipe(
        recipe_id="recipe_day1_ord2",
        status=RECIPE_STATUS_PUBLISHED,
        publish_date=_DAY1,
        display_order=2,
    )
    r3 = _make_recipe(
        recipe_id="recipe_day2_ord0",
        status=RECIPE_STATUS_PUBLISHED,
        publish_date=_DAY2,
        display_order=0,
    )
    r4 = _make_recipe(
        recipe_id="recipe_day3_ord5",
        status=RECIPE_STATUS_PUBLISHED,
        publish_date=_DAY3,
        display_order=5,
    )

    # Provide in expected sort order (simulating DB ORDER BY).
    app = _build_catalog_app([r1, r2, r3, r4])

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url=_BASE_URL
    ) as client:
        resp = await client.get(_CATALOG_URL)

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["total"] == 4

    returned_ids = [r["recipe_id"] for r in data["recipes"]]
    expected_ids = [
        "recipe_day1_ord1",
        "recipe_day1_ord2",
        "recipe_day2_ord0",
        "recipe_day3_ord5",
    ]
    assert (
        returned_ids == expected_ids
    ), f"Expected sort order {expected_ids!r} but got {returned_ids!r}"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_catalog_sort_order_most_recent_publish_date_first() -> None:
    """Newer publish_date ranks before older in the catalog (DESC order)."""
    older = _make_recipe(
        recipe_id="older_recipe",
        status=RECIPE_STATUS_PUBLISHED,
        publish_date=_DAY3,
        display_order=0,
    )
    newer = _make_recipe(
        recipe_id="newer_recipe",
        status=RECIPE_STATUS_PUBLISHED,
        publish_date=_DAY1,
        display_order=0,
    )
    # Provide in DB-sorted order: newer first (publish_date DESC).
    app = _build_catalog_app([newer, older])

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url=_BASE_URL
    ) as client:
        resp = await client.get(_CATALOG_URL)

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["total"] == 2
    ids = [r["recipe_id"] for r in data["recipes"]]
    assert ids[0] == "newer_recipe", "Most recently published recipe should come first"
    assert ids[1] == "older_recipe"


# ---------------------------------------------------------------------------
# Tests: 2 — Empty catalog
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_catalog_returns_empty_list_when_no_published_recipes() -> None:
    """GET /v1/recipes returns ``{"recipes": [], "total": 0}`` with no published recipes."""
    app = _build_catalog_app([])

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url=_BASE_URL
    ) as client:
        resp = await client.get(_CATALOG_URL)

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["recipes"] == []
    assert data["total"] == 0


@pytest.mark.unit
@pytest.mark.asyncio
async def test_catalog_empty_when_only_hidden_recipes_exist() -> None:
    """GET /v1/recipes returns empty list when all recipes are hidden."""
    hidden = _make_recipe(recipe_id="hidden_only", status=RECIPE_STATUS_HIDDEN)
    app = _build_catalog_app([hidden])

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url=_BASE_URL
    ) as client:
        resp = await client.get(_CATALOG_URL)

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["recipes"] == []
    assert data["total"] == 0


@pytest.mark.unit
@pytest.mark.asyncio
async def test_catalog_empty_when_only_deleted_recipes_exist() -> None:
    """GET /v1/recipes returns empty list when all recipes are deleted."""
    deleted = _make_recipe(recipe_id="deleted_only", status=RECIPE_STATUS_DELETED)
    app = _build_catalog_app([deleted])

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url=_BASE_URL
    ) as client:
        resp = await client.get(_CATALOG_URL)

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["recipes"] == []
    assert data["total"] == 0


# ---------------------------------------------------------------------------
# Tests: 3 — Auth-gated access
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_catalog_requires_authentication_returns_401() -> None:
    """GET /v1/recipes without a bearer token returns HTTP 401.

    The conftest auto-stub for ``require_current_user`` is cleared so the
    REAL dependency runs and 401s on the missing ``Authorization`` header.
    The session is still overridden to avoid a real DB connection — the 401
    fires before the handler body (and thus the session) is reached.
    """
    app = create_app()
    # Clear the conftest auto-stub — let the real require_current_user run.
    app.dependency_overrides.pop(require_current_user, None)

    stub = _CatalogStubSession([])

    async def _stub_session() -> AsyncGenerator[_CatalogStubSession, None]:
        yield stub

    app.dependency_overrides[get_session] = _stub_session

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url=_BASE_URL
    ) as client:
        resp = await client.get(_CATALOG_URL)

    assert resp.status_code == 401, resp.text
    assert resp.json()["detail"] == "invalid_authorization"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_catalog_requires_authentication_with_wrong_token_returns_401() -> None:
    """GET /v1/recipes with an invalid bearer token returns HTTP 401."""
    from unittest.mock import patch

    app = create_app()
    app.dependency_overrides.pop(require_current_user, None)

    stub = _CatalogStubSession([])

    async def _stub_session() -> AsyncGenerator[_CatalogStubSession, None]:
        yield stub

    app.dependency_overrides[get_session] = _stub_session

    # Provide a well-formed but wrong JWT.
    with patch.dict("os.environ", {"JWT_SECRET": "test-secret"}):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url=_BASE_URL
        ) as client:
            resp = await client.get(
                _CATALOG_URL,
                headers={"Authorization": "Bearer not-a-real-jwt"},
            )

    assert resp.status_code == 401, resp.text


# ---------------------------------------------------------------------------
# Tests: 4 — Response schema projection
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_catalog_response_schema_fields() -> None:
    """GET /v1/recipes response omits internal fields (model_id, prompt_template, parameters)."""
    recipe = _make_recipe(
        recipe_id="schema_check_recipe",
        status=RECIPE_STATUS_PUBLISHED,
        publish_date=_DAY1,
        display_order=0,
    )
    app = _build_catalog_app([recipe])

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url=_BASE_URL
    ) as client:
        resp = await client.get(_CATALOG_URL)

    assert resp.status_code == 200, resp.text
    item = resp.json()["recipes"][0]

    # Public fields MUST be present.
    assert "recipe_id" in item
    assert "style_reference_key" in item
    assert "publish_date" in item
    assert "display_order" in item
    assert "created_at" in item
    assert "title" in item
    assert "description" in item
    assert "tags" in item
    assert "thumbnail_url" in item

    # Internal generation fields MUST NOT be exposed.
    assert "model_id" not in item
    assert "prompt_template" not in item
    assert "parameters" not in item
    # Internal UUID PK also excluded.
    assert "id" not in item
    # Status field excluded (only published shown; redundant to expose).
    assert "status" not in item


@pytest.mark.unit
@pytest.mark.asyncio
async def test_catalog_response_field_values_are_correct() -> None:
    """GET /v1/recipes returns the correct field values for each recipe."""
    recipe = _make_recipe(
        recipe_id="field_values_recipe",
        status=RECIPE_STATUS_PUBLISHED,
        publish_date=_DAY2,
        display_order=3,
    )
    recipe.style_reference_key = "styles/aurora.png"
    app = _build_catalog_app([recipe])

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url=_BASE_URL
    ) as client:
        resp = await client.get(_CATALOG_URL)

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["total"] == 1
    item = data["recipes"][0]
    assert item["recipe_id"] == "field_values_recipe"
    assert item["style_reference_key"] == "styles/aurora.png"
    assert item["display_order"] == 3
    # publish_date is a timezone-aware ISO string.
    assert item["publish_date"] is not None


# ---------------------------------------------------------------------------
# Tests: freshness filter (pivot M1 — expires_at)
# ---------------------------------------------------------------------------
# NOTE: the stub interprets the WHERE tree faithfully for these operators,
# but the authoritative proof runs on real Postgres:
# tests/integration/test_catalog_freshness_filter.py (codex review R1 —
# a wrong query could still pass a stub).


@pytest.mark.unit
@pytest.mark.asyncio
async def test_catalog_excludes_expired_recipes() -> None:
    """A published recipe whose expires_at has passed is hidden from the catalog."""
    fresh = _make_recipe(
        recipe_id="fresh", expires_at=_NOW + timedelta(days=7), publish_date=_DAY1
    )
    expired = _make_recipe(
        recipe_id="expired", expires_at=_NOW - timedelta(days=1), publish_date=_DAY1
    )
    app = _build_catalog_app([fresh, expired])

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url=_BASE_URL
    ) as client:
        resp = await client.get(_CATALOG_URL)

    assert resp.status_code == 200
    recipe_ids = [r["recipe_id"] for r in resp.json()["recipes"]]
    assert "fresh" in recipe_ids
    assert "expired" not in recipe_ids


@pytest.mark.unit
@pytest.mark.asyncio
async def test_catalog_includes_evergreen_null_expiry_recipes() -> None:
    """expires_at IS NULL = evergreen — every pre-pivot recipe stays visible."""
    evergreen = _make_recipe(recipe_id="evergreen", expires_at=None)
    app = _build_catalog_app([evergreen])

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url=_BASE_URL
    ) as client:
        resp = await client.get(_CATALOG_URL)

    assert resp.status_code == 200
    assert [r["recipe_id"] for r in resp.json()["recipes"]] == ["evergreen"]


@pytest.mark.unit
@pytest.mark.asyncio
async def test_catalog_response_includes_expires_at_but_never_format_template() -> None:
    """expires_at is public (client countdown); format_template is INTERNAL —
    like prompt_template it must never leave the server (INVARIANTS #4)."""
    recipe = _make_recipe(recipe_id="trend", expires_at=_NOW + timedelta(days=7))
    recipe.format_template = {
        "version": 1,
        "kind": "text_overlay",
        "text": "이번 주 트렌드",
        "position": "bottom",
    }
    app = _build_catalog_app([recipe])

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url=_BASE_URL
    ) as client:
        resp = await client.get(_CATALOG_URL)

    assert resp.status_code == 200
    item = resp.json()["recipes"][0]
    assert "expires_at" in item
    assert item["expires_at"] is not None
    assert "format_template" not in item
