"""Admin recipe CRUD, lifecycle, and fal.ai preview API (Content Generation Phase).

All endpoints are under the ``/admin/recipes`` path prefix and require
the ``ADMIN_TOKEN`` bearer via :func:`api.dependencies.admin_auth.require_admin`.

Endpoint summary
----------------
    POST   /admin/recipes                        Create a new recipe
    GET    /admin/recipes                        List recipes (filter by status)
    GET    /admin/recipes/{recipe_id}            Read a single recipe
    PUT    /admin/recipes/{recipe_id}            Update recipe fields (no status change)
    POST   /admin/recipes/{recipe_id}/publish    Lifecycle: hidden → published
    POST   /admin/recipes/{recipe_id}/hide       Lifecycle: published → hidden
    DELETE /admin/recipes/{recipe_id}            Lifecycle: any → deleted (soft-delete)
    POST   /admin/recipes/{recipe_id}/preview    fal.ai preview: returns image URL

State machine
-------------
    hidden    → publish → published
    published → hide    → hidden
    *         → delete  → deleted (terminal; no further transitions allowed)

Preview endpoint (fal.ai integration)
--------------------------------------
``POST /admin/recipes/{recipe_id}/preview`` reads the recipe record from
the database, constructs the fal.ai payload (model_id, prompt_template,
style_reference_url, parameters), calls the fal.ai REST API via
:func:`api.generation.fal_preview_caller.call_fal_recipe_preview`, and
returns ``{"image_url": "..."}`` on success.

Error mapping for the preview endpoint:
    * Recipe not found              → HTTP 404  ``{"detail": "recipe_not_found"}``
    * Missing fal.ai API key        → HTTP 503  ``{"detail": {"error": "fal_key_not_configured"}}``
    * fal.ai client error (4xx)     → HTTP 422  ``{"detail": {"error": "fal_client_error", ...}}``
    * fal.ai server error (429/5xx) → HTTP 502  ``{"detail": {"error": "fal_server_error", ...}}``
    * Missing auth                  → HTTP 403  (from require_admin dependency)

General error mapping
---------------------
    * Recipe not found     → HTTP 404  ``{"detail": "recipe_not_found"}``
    * recipe_id conflict   → HTTP 409  ``{"detail": "recipe_id_conflict"}``
    * Invalid transition   → HTTP 422  ``{"detail": <description>}``
    * Missing auth         → HTTP 403  (from require_admin dependency)
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Annotated, Any, Final

from fastapi import APIRouter, Depends, HTTPException, Query, status

from api.db.models.recipe import (
    RECIPE_STATUS_DELETED,
    RECIPE_STATUS_HIDDEN,
    RECIPE_STATUS_PUBLISHED,
    UNIQUE_CONSTRAINT_RECIPE_ID,
    Recipe,
)
from api.db.session import AsyncSession, IntegrityError, get_session, select
from api.dependencies.admin_auth import require_admin
from api.generation.fal_preview_caller import FalPreviewError, call_fal_recipe_preview
from api.schemas.recipes import (
    InvalidTransitionError,
    RecipeCreate,
    RecipeListResponse,
    RecipePreviewResponse,
    RecipeResponse,
    RecipeUpdate,
    validate_transition,
)

_LOGGER: Final[logging.Logger] = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

router: APIRouter = APIRouter(
    prefix="/admin/recipes",
    tags=["admin-recipes"],
    dependencies=[Depends(require_admin)],
)

# ---------------------------------------------------------------------------
# Error detail constants (Seed-pinned)
# ---------------------------------------------------------------------------

DETAIL_RECIPE_NOT_FOUND: str = "recipe_not_found"
DETAIL_RECIPE_ID_CONFLICT: str = "recipe_id_conflict"


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------


async def _get_recipe_or_404(
    recipe_id: str,
    session: AsyncSession,
) -> Recipe:
    """Load a Recipe by human-readable *recipe_id* or raise HTTP 404.

    Parameters
    ----------
    recipe_id:
        The human-readable recipe identifier (not the UUID ``id``).
    session:
        Injected DB session.

    Returns
    -------
    Recipe
        The loaded ORM object.

    Raises
    ------
    HTTPException
        HTTP 404 when no row with the given ``recipe_id`` exists.
    """
    result = await session.execute(select(Recipe).where(Recipe.recipe_id == recipe_id))
    recipe = result.scalar_one_or_none()
    if recipe is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=DETAIL_RECIPE_NOT_FOUND,
        )
    return recipe


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post(
    "",
    response_model=RecipeResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new recipe",
)
async def create_recipe(
    body: RecipeCreate,
    session: AsyncSession = Depends(get_session),
) -> Recipe:
    """Create a new recipe row.

    The ``recipe_id`` must be globally unique. A duplicate raises HTTP 409.
    New recipes default to ``status=hidden`` so they are invisible in the
    public catalog until the operator calls the publish endpoint.
    """
    recipe = Recipe(
        recipe_id=body.recipe_id,
        model_id=body.model_id,
        prompt_template=body.prompt_template,
        title=body.title,
        description=body.description,
        tags=body.tags,
        thumbnail_url=body.thumbnail_url,
        style_reference_key=body.style_reference_key,
        parameters=body.parameters,
        status=body.status.value,
        publish_date=body.publish_date,
        display_order=body.display_order,
        expires_at=body.expires_at,
        format_template=body.format_template,
    )
    session.add(recipe)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        if UNIQUE_CONSTRAINT_RECIPE_ID in str(exc.orig):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=DETAIL_RECIPE_ID_CONFLICT,
            ) from exc
        raise
    await session.refresh(recipe)
    return recipe


@router.get(
    "",
    response_model=RecipeListResponse,
    status_code=status.HTTP_200_OK,
    summary="List recipes",
)
async def list_recipes(
    session: AsyncSession = Depends(get_session),
    status_filter: Annotated[
        str | None,
        Query(
            alias="status", description="Filter by status (published/hidden/deleted)"
        ),
    ] = None,
) -> RecipeListResponse:
    """List all recipes, optionally filtered by ``status``.

    Results are ordered by ``display_order ASC, created_at DESC``.
    When no ``status`` filter is given, all recipes (including deleted)
    are returned — the admin UI needs visibility into the full set.
    """
    stmt = select(Recipe).order_by(Recipe.display_order, Recipe.created_at.desc())
    if status_filter is not None:
        stmt = stmt.where(Recipe.status == status_filter)

    result = await session.execute(stmt)
    recipes = list(result.scalars().all())
    return RecipeListResponse(
        recipes=[RecipeResponse.model_validate(r) for r in recipes],
        total=len(recipes),
    )


@router.get(
    "/{recipe_id}",
    response_model=RecipeResponse,
    status_code=status.HTTP_200_OK,
    summary="Get a single recipe",
)
async def get_recipe(
    recipe_id: str,
    session: AsyncSession = Depends(get_session),
) -> Recipe:
    """Return a single recipe by its human-readable ``recipe_id``."""
    return await _get_recipe_or_404(recipe_id, session)


@router.put(
    "/{recipe_id}",
    response_model=RecipeResponse,
    status_code=status.HTTP_200_OK,
    summary="Update recipe fields (no status change)",
)
async def update_recipe(
    recipe_id: str,
    body: RecipeUpdate,
    session: AsyncSession = Depends(get_session),
) -> Recipe:
    """Update mutable recipe fields.

    Status changes must go through dedicated lifecycle endpoints.
    Only provided (non-None) fields are updated; absent fields are
    left unchanged. Returns the updated recipe.
    """
    recipe = await _get_recipe_or_404(recipe_id, session)

    fields_set = body.model_fields_set

    if body.model_id is not None:
        recipe.model_id = body.model_id
    if body.prompt_template is not None:
        recipe.prompt_template = body.prompt_template
    if body.style_reference_key is not None:
        recipe.style_reference_key = body.style_reference_key
    if body.parameters is not None:
        recipe.parameters = body.parameters
    if body.publish_date is not None:
        recipe.publish_date = body.publish_date
    if body.display_order is not None:
        recipe.display_order = body.display_order
    # title is non-null: only apply when a validated, non-null value is sent
    if body.title is not None:
        recipe.title = body.title
    # tags: list replace; only when the client explicitly sent it
    if "tags" in fields_set and body.tags is not None:
        recipe.tags = body.tags
    # description / thumbnail_url: nullable — an explicitly-sent null CLEARS them
    if "description" in fields_set:
        recipe.description = body.description
    if "thumbnail_url" in fields_set:
        recipe.thumbnail_url = body.thumbnail_url
    # expires_at / format_template (pivot M1): nullable, same explicit-null-clears
    # contract — clearing expires_at makes the recipe evergreen again.
    if "expires_at" in fields_set:
        recipe.expires_at = body.expires_at
    if "format_template" in fields_set:
        recipe.format_template = body.format_template

    # Explicitly bump updated_at so a raw-SQL or ORM path both update it.
    recipe.updated_at = datetime.now(timezone.utc)

    await session.commit()
    await session.refresh(recipe)
    return recipe


@router.post(
    "/{recipe_id}/publish",
    response_model=RecipeResponse,
    status_code=status.HTTP_200_OK,
    summary="Publish a recipe (hidden → published)",
)
async def publish_recipe(
    recipe_id: str,
    session: AsyncSession = Depends(get_session),
) -> Recipe:
    """Transition a recipe from ``hidden`` to ``published``.

    Sets ``publish_date`` to the current UTC timestamp if it is not
    already set, making the recipe visible in the public catalog.

    Raises HTTP 422 if the transition is not allowed (e.g. already
    deleted or already published).
    """
    recipe = await _get_recipe_or_404(recipe_id, session)

    try:
        validate_transition(recipe.status, RECIPE_STATUS_PUBLISHED)
    except InvalidTransitionError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    recipe.status = RECIPE_STATUS_PUBLISHED
    if recipe.publish_date is None:
        recipe.publish_date = datetime.now(timezone.utc)
    recipe.updated_at = datetime.now(timezone.utc)

    await session.commit()
    await session.refresh(recipe)
    return recipe


@router.post(
    "/{recipe_id}/hide",
    response_model=RecipeResponse,
    status_code=status.HTTP_200_OK,
    summary="Hide a recipe (published → hidden)",
)
async def hide_recipe(
    recipe_id: str,
    session: AsyncSession = Depends(get_session),
) -> Recipe:
    """Transition a recipe from ``published`` to ``hidden``.

    The recipe is removed from the public catalog but the row is
    preserved. Raises HTTP 422 if the transition is not allowed.
    """
    recipe = await _get_recipe_or_404(recipe_id, session)

    try:
        validate_transition(recipe.status, RECIPE_STATUS_HIDDEN)
    except InvalidTransitionError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    recipe.status = RECIPE_STATUS_HIDDEN
    recipe.updated_at = datetime.now(timezone.utc)

    await session.commit()
    await session.refresh(recipe)
    return recipe


@router.delete(
    "/{recipe_id}",
    response_model=RecipeResponse,
    status_code=status.HTTP_200_OK,
    summary="Soft-delete a recipe (any → deleted)",
)
async def delete_recipe(
    recipe_id: str,
    session: AsyncSession = Depends(get_session),
) -> Recipe:
    """Soft-delete a recipe by transitioning it to ``deleted`` (terminal).

    The row is never physically removed. Deleted recipes are excluded from
    the public catalog and cannot be transitioned to any other status.
    Raises HTTP 422 if the recipe is already deleted.
    """
    recipe = await _get_recipe_or_404(recipe_id, session)

    try:
        validate_transition(recipe.status, RECIPE_STATUS_DELETED)
    except InvalidTransitionError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    recipe.status = RECIPE_STATUS_DELETED
    recipe.updated_at = datetime.now(timezone.utc)

    await session.commit()
    await session.refresh(recipe)
    return recipe


@router.post(
    "/{recipe_id}/preview",
    response_model=RecipePreviewResponse,
    status_code=status.HTTP_200_OK,
    summary="Preview a recipe via a real fal.ai generation call",
)
async def preview_recipe(
    recipe_id: str,
    session: AsyncSession = Depends(get_session),
) -> RecipePreviewResponse:
    """Generate a preview image for a recipe by calling the fal.ai API.

    Reads the recipe row from the database, constructs the fal.ai payload
    (model, prompt, optional style reference, parameters), calls the
    fal.ai REST API, and returns the first generated image URL.

    The call is executed synchronously inside ``asyncio.to_thread`` so the
    ASGI event loop is not blocked during the HTTP round-trip.

    The fal.ai API key is loaded from the environment via the core-python
    ``image_edit.fal_ai_api_key.load_fal_api_key()`` loader.  If the key
    is missing, a 503 is returned.

    Error mapping
    -------------
    * Recipe not found              → 404 ``recipe_not_found``
    * Missing fal.ai API key        → 503 ``fal_key_not_configured``
    * fal.ai client error (4xx)     → 422 ``fal_client_error``
    * fal.ai server error (429/5xx) → 502 ``fal_server_error``

    Parameters
    ----------
    recipe_id:
        Human-readable recipe identifier (not the UUID primary key).
    session:
        Injected DB async session.

    Returns
    -------
    RecipePreviewResponse
        ``{"image_url": "..."}`` with the first image URL from fal.ai.
    """
    recipe = await _get_recipe_or_404(recipe_id, session)

    # Load the fal.ai API key via the authorised core-python loader.
    # Importing here (inside the handler) keeps the module importable even
    # when core-python is not installed — the import failure surfaces at
    # request time (503) rather than at startup.
    try:
        from image_edit.fal_ai_api_key import load_fal_api_key

        api_key: str = load_fal_api_key()
    except LookupError as exc:
        _LOGGER.warning(
            "fal_key_not_configured recipe_id=%s err=%s",
            recipe_id,
            str(exc),
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"error": "fal_key_not_configured"},
        ) from exc
    except ImportError as exc:
        _LOGGER.error(
            "image_edit_not_installed recipe_id=%s err=%s",
            recipe_id,
            str(exc),
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"error": "fal_key_not_configured"},
        ) from exc

    # Build a style reference URL from the recipe's style_reference_key.
    # If the key looks like an HTTP(S) URL, pass it directly.  Storage-key
    # resolution (e.g. R2 / S3 presigned URL generation) is out of scope
    # for Phase 1 preview; operators should use full HTTP(S) URLs for now.
    style_reference_url: str | None = None
    if recipe.style_reference_key and recipe.style_reference_key.startswith(
        ("http://", "https://")
    ):
        style_reference_url = recipe.style_reference_key

    # Capture a snapshot of parameters so the thread call captures an
    # immutable-ish dict rather than the mutable SQLAlchemy-backed attribute.
    parameters: dict[str, Any] = dict(recipe.parameters) if recipe.parameters else {}

    try:
        image_url: str = await asyncio.to_thread(
            call_fal_recipe_preview,
            model_id=recipe.model_id,
            prompt=recipe.prompt_template,
            style_reference_url=style_reference_url,
            parameters=parameters,
            api_key=api_key,
        )
    except FalPreviewError as exc:
        _LOGGER.warning(
            "fal_preview_failed recipe_id=%s retryable=%s status_code=%s msg=%s",
            recipe_id,
            exc.retryable,
            exc.status_code,
            str(exc),
        )
        if exc.retryable:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail={
                    "error": "fal_server_error",
                    "message": str(exc),
                },
            ) from exc
        else:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={
                    "error": "fal_client_error",
                    "message": str(exc),
                },
            ) from exc

    return RecipePreviewResponse(image_url=image_url)


__all__ = ["router"]
