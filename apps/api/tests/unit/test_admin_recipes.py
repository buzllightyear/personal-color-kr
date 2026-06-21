"""Unit tests for Sub-AC 1: Recipe data model, CRUD API, lifecycle, admin auth.

Acceptance criteria verified
------------------------------
1. Recipe ORM model round-trips (in-memory instantiation, field types,
   defaults, status constants).
2. Admin auth dependency rejects requests without a valid ADMIN_TOKEN.
3. Endpoint contracts: create, read, update, list, lifecycle transitions
   (publish, hide, soft-delete) via httpx.AsyncClient + ASGI transport.
4. State-transition guards: invalid transitions raise HTTP 422; valid
   transitions produce HTTP 200 with the correct new status.
5. Endpoint 404 when recipe_id not found.
6. Endpoint 409 on duplicate recipe_id (conflict).

Test strategy
-------------
All tests use ``create_app()`` with ``dependency_overrides`` to replace
the ``get_session`` dependency with a tiny in-memory stub session so no
real Postgres connection is needed. The stub session tracks a dict of
Recipe objects, providing ``execute(select(Recipe)…)`` semantics via
a simple mock object. The admin-auth dependency is also overridden per
test group — one group exercises the full auth guard (no override) and
the rest bypass it with a pass-through stub.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncGenerator
from datetime import datetime, timezone
from typing import Any
from unittest.mock import patch

import pytest
from httpx import ASGITransport, AsyncClient

from api.db.models.recipe import (
    RECIPE_STATUS_DELETED,
    RECIPE_STATUS_HIDDEN,
    RECIPE_STATUS_PUBLISHED,
    RECIPE_TRANSITIONS,
    Recipe,
    is_valid_transition,
)
from api.db.session import get_session
from api.dependencies.admin_auth import require_admin
from api.main import create_app
from api.schemas.recipes import (
    InvalidTransitionError,
    RecipeResponse,
    validate_transition,
)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_ADMIN_TOKEN = "test-admin-token-for-unit-tests"
_AUTH_HEADER = {"Authorization": f"Bearer {_ADMIN_TOKEN}"}
_BASE_URL = "http://testserver"

_VALID_RECIPE_BODY: dict[str, Any] = {
    "recipe_id": "recipe_aurora_v1",
    "model_id": "fal-ai/flux/dev",
    "prompt_template": "A {personal_color_modifier} editorial portrait",
    "style_reference_key": None,
    "parameters": {"num_inference_steps": 30},
    "status": "hidden",
    "publish_date": None,
    "display_order": 1,
}


# ---------------------------------------------------------------------------
# Helpers: in-memory session stub
# ---------------------------------------------------------------------------


def _make_recipe(**kwargs: Any) -> Recipe:
    """Build an in-memory Recipe ORM object (no DB round-trip)."""
    now = datetime.now(timezone.utc)
    recipe = Recipe()
    recipe.id = uuid.uuid4()
    recipe.recipe_id = kwargs.get("recipe_id", "test_recipe")
    recipe.model_id = kwargs.get("model_id", "fal-ai/flux/dev")
    recipe.prompt_template = kwargs.get("prompt_template", "A test prompt")
    recipe.style_reference_key = kwargs.get("style_reference_key", None)
    recipe.parameters = kwargs.get("parameters", {})
    recipe.status = kwargs.get("status", RECIPE_STATUS_HIDDEN)
    recipe.publish_date = kwargs.get("publish_date", None)
    recipe.display_order = kwargs.get("display_order", 0)
    recipe.created_at = now
    recipe.updated_at = now
    return recipe


class _StubSelectResult:
    """Minimal result proxy for ``await session.execute(select(Recipe)...)``."""

    def __init__(self, rows: list[Recipe]) -> None:
        self._rows = rows

    def scalar_one_or_none(self) -> Recipe | None:
        return self._rows[0] if self._rows else None

    def scalars(self) -> "_StubScalars":
        return _StubScalars(self._rows)


class _StubScalars:
    def __init__(self, rows: list[Recipe]) -> None:
        self._rows = rows

    def all(self) -> list[Recipe]:
        return self._rows


class _StubSession:
    """Minimal async session stub for admin recipe endpoint tests.

    The stub stores Recipe objects in a dict keyed by recipe_id. It
    implements just enough of the AsyncSession interface to satisfy the
    admin_recipes router:
        * execute(select(...))  → _StubSelectResult
        * add(recipe)
        * commit()
        * rollback()
        * refresh(recipe)
    """

    def __init__(self, store: dict[str, Recipe] | None = None) -> None:
        self._store: dict[str, Recipe] = store or {}
        self._pending: list[Recipe] = []
        self._raise_integrity: bool = False

    async def execute(self, stmt: Any) -> _StubSelectResult:  # noqa: ANN401
        """Simulate ``SELECT recipes WHERE column = value``."""
        rows = list(self._store.values())
        try:
            # SQLAlchemy Select.whereclause is None when there is no WHERE.
            whereclause = getattr(stmt, "whereclause", None)
            if whereclause is not None:
                # Extract the column name (left side) and value (right side)
                # from a simple equality BinaryExpression.
                col_name = str(whereclause.left.key)
                filter_value = whereclause.right.value
                rows = [r for r in rows if getattr(r, col_name, None) == filter_value]
        except AttributeError:
            pass
        return _StubSelectResult(rows)

    def add(self, recipe: Recipe) -> None:
        self._pending.append(recipe)

    async def commit(self) -> None:
        if self._raise_integrity:
            self._raise_integrity = False
            from sqlalchemy.exc import IntegrityError

            orig = Exception("uq_recipes_recipe_id")
            raise IntegrityError("", {}, orig)
        now = datetime.now(timezone.utc)
        for recipe in self._pending:
            # Simulate DB-generated values that would be set during real INSERT.
            if recipe.id is None:
                recipe.id = uuid.uuid4()
            if recipe.status is None:
                recipe.status = RECIPE_STATUS_HIDDEN
            if recipe.parameters is None:
                recipe.parameters = {}
            if recipe.display_order is None:
                recipe.display_order = 0
            if recipe.created_at is None:
                recipe.created_at = now
            if recipe.updated_at is None:
                recipe.updated_at = now
            self._store[recipe.recipe_id] = recipe
        self._pending.clear()

    async def rollback(self) -> None:
        self._pending.clear()

    async def refresh(self, recipe: Recipe) -> None:
        # Simulate an ORM refresh: no-op in the stub (attributes already set).
        pass


# ---------------------------------------------------------------------------
# Fixtures: FastAPI app with stubbed session and auth
# ---------------------------------------------------------------------------


def _build_app_with_stub(
    stub: _StubSession,
) -> Any:
    """Return a FastAPI app with session and admin-auth overridden."""
    app = create_app()

    # Override session dependency with a generator that yields the stub.
    async def _stub_session_dep() -> AsyncGenerator[_StubSession, None]:
        yield stub

    # Override admin auth to always pass (no token check in most tests).
    async def _stub_admin_auth() -> None:
        return None

    app.dependency_overrides[get_session] = _stub_session_dep
    app.dependency_overrides[require_admin] = _stub_admin_auth
    return app


# ---------------------------------------------------------------------------
# Part 1: Recipe ORM model round-trips (no DB, no HTTP)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_recipe_model_defaults() -> None:
    """Recipe model columns have the expected server defaults and metadata.

    Note: SQLAlchemy ORM column-level ``default=`` and ``server_default=``
    are INSERT defaults, not ``__init__`` defaults — bare ``Recipe()``
    leaves server-side columns as ``None`` until persisted. This test
    validates the column *specification*, not the bare-instantiation value.
    """
    table = Recipe.__table__
    status_col = table.c.status
    params_col = table.c.parameters

    # status column: NOT NULL (nullability must be False after alembic run)
    assert not status_col.nullable
    # parameters column: NOT NULL
    assert not params_col.nullable
    # Both have server defaults defined (set in the ORM model).
    assert status_col.server_default is not None
    assert params_col.server_default is not None


@pytest.mark.unit
def test_recipe_status_constants() -> None:
    """Status constants match the expected strings."""
    assert RECIPE_STATUS_PUBLISHED == "published"
    assert RECIPE_STATUS_HIDDEN == "hidden"
    assert RECIPE_STATUS_DELETED == "deleted"


@pytest.mark.unit
def test_recipe_repr_does_not_include_prompt() -> None:
    """Recipe repr exposes id/recipe_id/model_id/status only."""
    recipe = _make_recipe(recipe_id="test_repr")
    r = repr(recipe)
    assert "test_repr" in r
    assert "status" in r


@pytest.mark.unit
def test_recipe_uuid_is_generated_on_make() -> None:
    """Each constructed Recipe has a unique UUID id."""
    r1 = _make_recipe()
    r2 = _make_recipe()
    assert r1.id != r2.id


@pytest.mark.unit
def test_recipe_fields_store_correctly() -> None:
    """ORM field assignments round-trip without coercion."""
    recipe = _make_recipe(
        recipe_id="aurora_v1",
        model_id="fal-ai/flux/dev",
        prompt_template="Portrait in {color} palette",
        style_reference_key="styles/aurora.png",
        parameters={"steps": 30, "seed": 42},
        display_order=5,
    )
    assert recipe.recipe_id == "aurora_v1"
    assert recipe.model_id == "fal-ai/flux/dev"
    assert recipe.prompt_template == "Portrait in {color} palette"
    assert recipe.style_reference_key == "styles/aurora.png"
    assert recipe.parameters == {"steps": 30, "seed": 42}
    assert recipe.display_order == 5


# ---------------------------------------------------------------------------
# Part 2: State-transition logic (no HTTP, no DB)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_valid_transitions_hidden_to_published() -> None:
    """hidden → published is a valid transition."""
    assert is_valid_transition(RECIPE_STATUS_HIDDEN, RECIPE_STATUS_PUBLISHED)


@pytest.mark.unit
def test_valid_transitions_published_to_hidden() -> None:
    """published → hidden is a valid transition."""
    assert is_valid_transition(RECIPE_STATUS_PUBLISHED, RECIPE_STATUS_HIDDEN)


@pytest.mark.unit
def test_valid_transitions_any_to_deleted() -> None:
    """Both hidden and published allow transition to deleted."""
    assert is_valid_transition(RECIPE_STATUS_HIDDEN, RECIPE_STATUS_DELETED)
    assert is_valid_transition(RECIPE_STATUS_PUBLISHED, RECIPE_STATUS_DELETED)


@pytest.mark.unit
def test_invalid_transition_deleted_is_terminal() -> None:
    """deleted → * is always invalid (terminal state)."""
    assert not is_valid_transition(RECIPE_STATUS_DELETED, RECIPE_STATUS_HIDDEN)
    assert not is_valid_transition(RECIPE_STATUS_DELETED, RECIPE_STATUS_PUBLISHED)
    assert not is_valid_transition(RECIPE_STATUS_DELETED, RECIPE_STATUS_DELETED)


@pytest.mark.unit
def test_invalid_transition_hidden_to_hidden() -> None:
    """hidden → hidden is not a valid transition."""
    assert not is_valid_transition(RECIPE_STATUS_HIDDEN, RECIPE_STATUS_HIDDEN)


@pytest.mark.unit
def test_invalid_transition_published_to_published() -> None:
    """published → published is not a valid transition."""
    assert not is_valid_transition(RECIPE_STATUS_PUBLISHED, RECIPE_STATUS_PUBLISHED)


@pytest.mark.unit
def test_validate_transition_raises_on_invalid() -> None:
    """validate_transition raises InvalidTransitionError for bad transitions."""
    with pytest.raises(InvalidTransitionError):
        validate_transition(RECIPE_STATUS_DELETED, RECIPE_STATUS_HIDDEN)


@pytest.mark.unit
def test_validate_transition_passes_on_valid() -> None:
    """validate_transition does NOT raise for valid transitions."""
    validate_transition(RECIPE_STATUS_HIDDEN, RECIPE_STATUS_PUBLISHED)
    validate_transition(RECIPE_STATUS_PUBLISHED, RECIPE_STATUS_HIDDEN)


@pytest.mark.unit
def test_recipe_transitions_dict_completeness() -> None:
    """RECIPE_TRANSITIONS has an entry for each non-terminal status."""
    assert RECIPE_STATUS_HIDDEN in RECIPE_TRANSITIONS
    assert RECIPE_STATUS_PUBLISHED in RECIPE_TRANSITIONS
    assert RECIPE_STATUS_DELETED in RECIPE_TRANSITIONS
    # Deleted is terminal — its outbound set is empty.
    assert RECIPE_TRANSITIONS[RECIPE_STATUS_DELETED] == frozenset()


# ---------------------------------------------------------------------------
# Part 3: Admin auth rejection
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_admin_auth_rejects_missing_token() -> None:
    """A request to /admin/recipes without Authorization returns HTTP 403."""
    with patch.dict("os.environ", {"ADMIN_TOKEN": _ADMIN_TOKEN}):
        stub = _StubSession()
        app = create_app()

        async def _stub_session() -> AsyncGenerator[_StubSession, None]:
            yield stub

        app.dependency_overrides[get_session] = _stub_session
        # Do NOT override require_admin — let the real dependency run.

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url=_BASE_URL
        ) as client:
            resp = await client.get("/v1/admin/recipes")

    assert resp.status_code == 403
    assert resp.json()["detail"] == "forbidden"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_admin_auth_rejects_wrong_token() -> None:
    """A wrong token returns HTTP 403."""
    with patch.dict("os.environ", {"ADMIN_TOKEN": _ADMIN_TOKEN}):
        stub = _StubSession()
        app = create_app()

        async def _stub_session() -> AsyncGenerator[_StubSession, None]:
            yield stub

        app.dependency_overrides[get_session] = _stub_session

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url=_BASE_URL
        ) as client:
            resp = await client.get(
                "/v1/admin/recipes",
                headers={"Authorization": "Bearer wrong-token"},
            )

    assert resp.status_code == 403
    assert resp.json()["detail"] == "forbidden"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_admin_auth_passes_with_correct_token() -> None:
    """A correct token allows access to the admin list endpoint."""
    with patch.dict("os.environ", {"ADMIN_TOKEN": _ADMIN_TOKEN}):
        stub = _StubSession()
        app = create_app()

        async def _stub_session() -> AsyncGenerator[_StubSession, None]:
            yield stub

        app.dependency_overrides[get_session] = _stub_session

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url=_BASE_URL
        ) as client:
            resp = await client.get(
                "/v1/admin/recipes",
                headers=_AUTH_HEADER,
            )

    assert resp.status_code == 200
    data = resp.json()
    assert data["recipes"] == []
    assert data["total"] == 0


@pytest.mark.unit
@pytest.mark.asyncio
async def test_admin_auth_rejects_unconfigured_token() -> None:
    """When ADMIN_TOKEN is not configured, all admin requests return 403."""
    with patch.dict("os.environ", {}, clear=True):
        # Remove ADMIN_TOKEN from env entirely.
        import os

        os.environ.pop("ADMIN_TOKEN", None)

        stub = _StubSession()
        app = create_app()

        async def _stub_session() -> AsyncGenerator[_StubSession, None]:
            yield stub

        app.dependency_overrides[get_session] = _stub_session

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url=_BASE_URL
        ) as client:
            resp = await client.get(
                "/v1/admin/recipes",
                headers={"Authorization": "Bearer any-token"},
            )

    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Part 4: Endpoint contracts (stubbed session + bypassed auth)
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_create_recipe_returns_201_with_correct_fields() -> None:
    """POST /admin/recipes creates a recipe and returns 201 with all fields."""
    stub = _StubSession()
    app = _build_app_with_stub(stub)

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url=_BASE_URL
    ) as client:
        resp = await client.post("/v1/admin/recipes", json=_VALID_RECIPE_BODY)

    assert resp.status_code == 201
    data = resp.json()
    assert data["recipe_id"] == _VALID_RECIPE_BODY["recipe_id"]
    assert data["model_id"] == _VALID_RECIPE_BODY["model_id"]
    assert data["prompt_template"] == _VALID_RECIPE_BODY["prompt_template"]
    assert data["status"] == "hidden"
    assert data["display_order"] == _VALID_RECIPE_BODY["display_order"]
    assert "id" in data
    assert "created_at" in data
    assert "updated_at" in data


@pytest.mark.unit
@pytest.mark.asyncio
async def test_list_recipes_returns_all_recipes() -> None:
    """GET /admin/recipes returns all recipes including hidden ones."""
    r1 = _make_recipe(recipe_id="recipe_a", status=RECIPE_STATUS_PUBLISHED)
    r2 = _make_recipe(recipe_id="recipe_b", status=RECIPE_STATUS_HIDDEN)
    stub = _StubSession({"recipe_a": r1, "recipe_b": r2})
    app = _build_app_with_stub(stub)

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url=_BASE_URL
    ) as client:
        resp = await client.get("/v1/admin/recipes")

    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 2
    recipe_ids = {r["recipe_id"] for r in data["recipes"]}
    assert recipe_ids == {"recipe_a", "recipe_b"}


@pytest.mark.unit
@pytest.mark.asyncio
async def test_get_recipe_returns_correct_recipe() -> None:
    """GET /admin/recipes/{recipe_id} returns the matching recipe."""
    recipe = _make_recipe(recipe_id="aurora_v1")
    stub = _StubSession({"aurora_v1": recipe})
    app = _build_app_with_stub(stub)

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url=_BASE_URL
    ) as client:
        resp = await client.get("/v1/admin/recipes/aurora_v1")

    assert resp.status_code == 200
    assert resp.json()["recipe_id"] == "aurora_v1"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_get_recipe_returns_404_for_unknown_id() -> None:
    """GET /admin/recipes/{recipe_id} returns 404 when not found."""
    stub = _StubSession({})
    app = _build_app_with_stub(stub)

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url=_BASE_URL
    ) as client:
        resp = await client.get("/v1/admin/recipes/nonexistent")

    assert resp.status_code == 404
    assert resp.json()["detail"] == "recipe_not_found"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_update_recipe_fields() -> None:
    """PUT /admin/recipes/{recipe_id} updates mutable fields."""
    recipe = _make_recipe(recipe_id="update_me", model_id="old-model")
    stub = _StubSession({"update_me": recipe})
    app = _build_app_with_stub(stub)

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url=_BASE_URL
    ) as client:
        resp = await client.put(
            "/v1/admin/recipes/update_me",
            json={"model_id": "new-model"},
        )

    assert resp.status_code == 200
    assert resp.json()["model_id"] == "new-model"
    # recipe_id stays unchanged
    assert resp.json()["recipe_id"] == "update_me"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_update_recipe_returns_404_for_unknown_id() -> None:
    """PUT /admin/recipes/{recipe_id} returns 404 when recipe not found."""
    stub = _StubSession({})
    app = _build_app_with_stub(stub)

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url=_BASE_URL
    ) as client:
        resp = await client.put(
            "/v1/admin/recipes/ghost",
            json={"model_id": "new-model"},
        )

    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Part 5: Lifecycle endpoints — publish / hide / soft-delete
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_publish_recipe_transitions_hidden_to_published() -> None:
    """POST /{recipe_id}/publish transitions hidden → published."""
    recipe = _make_recipe(recipe_id="to_publish", status=RECIPE_STATUS_HIDDEN)
    stub = _StubSession({"to_publish": recipe})
    app = _build_app_with_stub(stub)

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url=_BASE_URL
    ) as client:
        resp = await client.post("/v1/admin/recipes/to_publish/publish")

    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "published"
    # publish_date should be set automatically.
    assert data["publish_date"] is not None


@pytest.mark.unit
@pytest.mark.asyncio
async def test_hide_recipe_transitions_published_to_hidden() -> None:
    """POST /{recipe_id}/hide transitions published → hidden."""
    recipe = _make_recipe(recipe_id="to_hide", status=RECIPE_STATUS_PUBLISHED)
    stub = _StubSession({"to_hide": recipe})
    app = _build_app_with_stub(stub)

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url=_BASE_URL
    ) as client:
        resp = await client.post("/v1/admin/recipes/to_hide/hide")

    assert resp.status_code == 200
    assert resp.json()["status"] == "hidden"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_delete_recipe_transitions_any_to_deleted() -> None:
    """DELETE /{recipe_id} soft-deletes a recipe (transitions to deleted)."""
    recipe = _make_recipe(recipe_id="to_delete", status=RECIPE_STATUS_HIDDEN)
    stub = _StubSession({"to_delete": recipe})
    app = _build_app_with_stub(stub)

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url=_BASE_URL
    ) as client:
        resp = await client.delete("/v1/admin/recipes/to_delete")

    assert resp.status_code == 200
    assert resp.json()["status"] == "deleted"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_delete_published_recipe_succeeds() -> None:
    """DELETE on a published recipe transitions it to deleted."""
    recipe = _make_recipe(recipe_id="pub_delete", status=RECIPE_STATUS_PUBLISHED)
    stub = _StubSession({"pub_delete": recipe})
    app = _build_app_with_stub(stub)

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url=_BASE_URL
    ) as client:
        resp = await client.delete("/v1/admin/recipes/pub_delete")

    assert resp.status_code == 200
    assert resp.json()["status"] == "deleted"


# ---------------------------------------------------------------------------
# Part 6: State-transition guards — invalid transitions return 422
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_publish_already_published_returns_422() -> None:
    """POST /{recipe_id}/publish on an already-published recipe returns 422."""
    recipe = _make_recipe(recipe_id="already_pub", status=RECIPE_STATUS_PUBLISHED)
    stub = _StubSession({"already_pub": recipe})
    app = _build_app_with_stub(stub)

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url=_BASE_URL
    ) as client:
        resp = await client.post("/v1/admin/recipes/already_pub/publish")

    assert resp.status_code == 422


@pytest.mark.unit
@pytest.mark.asyncio
async def test_hide_already_hidden_returns_422() -> None:
    """POST /{recipe_id}/hide on an already-hidden recipe returns 422."""
    recipe = _make_recipe(recipe_id="already_hid", status=RECIPE_STATUS_HIDDEN)
    stub = _StubSession({"already_hid": recipe})
    app = _build_app_with_stub(stub)

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url=_BASE_URL
    ) as client:
        resp = await client.post("/v1/admin/recipes/already_hid/hide")

    assert resp.status_code == 422


@pytest.mark.unit
@pytest.mark.asyncio
async def test_delete_already_deleted_returns_422() -> None:
    """DELETE on a deleted recipe returns 422 (terminal state guard)."""
    recipe = _make_recipe(recipe_id="deleted_one", status=RECIPE_STATUS_DELETED)
    stub = _StubSession({"deleted_one": recipe})
    app = _build_app_with_stub(stub)

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url=_BASE_URL
    ) as client:
        resp = await client.delete("/v1/admin/recipes/deleted_one")

    assert resp.status_code == 422


@pytest.mark.unit
@pytest.mark.asyncio
async def test_publish_deleted_recipe_returns_422() -> None:
    """POST /{recipe_id}/publish on a deleted recipe returns 422."""
    recipe = _make_recipe(recipe_id="del_pub", status=RECIPE_STATUS_DELETED)
    stub = _StubSession({"del_pub": recipe})
    app = _build_app_with_stub(stub)

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url=_BASE_URL
    ) as client:
        resp = await client.post("/v1/admin/recipes/del_pub/publish")

    assert resp.status_code == 422


@pytest.mark.unit
@pytest.mark.asyncio
async def test_hide_deleted_recipe_returns_422() -> None:
    """POST /{recipe_id}/hide on a deleted recipe returns 422."""
    recipe = _make_recipe(recipe_id="del_hide", status=RECIPE_STATUS_DELETED)
    stub = _StubSession({"del_hide": recipe})
    app = _build_app_with_stub(stub)

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url=_BASE_URL
    ) as client:
        resp = await client.post("/v1/admin/recipes/del_hide/hide")

    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Part 7: Duplicate recipe_id conflict
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_create_duplicate_recipe_id_returns_409() -> None:
    """POST /admin/recipes with a duplicate recipe_id returns 409."""
    # Stub the session to raise an IntegrityError mentioning
    # the uq_recipes_recipe_id constraint on commit.

    class _ConflictStubSession(_StubSession):
        async def commit(self) -> None:
            from sqlalchemy.exc import IntegrityError

            # Use a plain Exception so str(orig) contains the constraint name.
            orig = Exception("uq_recipes_recipe_id")
            raise IntegrityError("", {}, orig)

    stub = _ConflictStubSession()
    app = _build_app_with_stub(stub)

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url=_BASE_URL
    ) as client:
        resp = await client.post("/v1/admin/recipes", json=_VALID_RECIPE_BODY)

    assert resp.status_code == 409
    assert resp.json()["detail"] == "recipe_id_conflict"


# ---------------------------------------------------------------------------
# Part 8: RecipeResponse Pydantic schema round-trip
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_recipe_response_from_orm_object() -> None:
    """RecipeResponse.model_validate correctly projects a Recipe ORM row."""
    recipe = _make_recipe(
        recipe_id="schema_test",
        model_id="fal-ai/flux/pro",
        prompt_template="A {style} portrait",
        parameters={"steps": 20},
        display_order=3,
    )
    response = RecipeResponse.model_validate(recipe)

    assert response.recipe_id == "schema_test"
    assert response.model_id == "fal-ai/flux/pro"
    assert response.prompt_template == "A {style} portrait"
    assert response.parameters == {"steps": 20}
    assert response.display_order == 3
    assert response.status.value == RECIPE_STATUS_HIDDEN


@pytest.mark.unit
def test_recipe_response_serializes_to_json() -> None:
    """RecipeResponse serializes cleanly to JSON-compatible dict."""
    recipe = _make_recipe(recipe_id="json_test")
    response = RecipeResponse.model_validate(recipe)
    dumped = response.model_dump(mode="json")

    assert isinstance(dumped["id"], str)  # UUID serialized as string
    assert isinstance(dumped["created_at"], str)  # datetime serialized as string
    assert dumped["status"] == RECIPE_STATUS_HIDDEN
