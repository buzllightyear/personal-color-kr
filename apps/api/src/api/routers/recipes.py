"""Public recipe catalog API (Content Generation Phase).

``GET /v1/recipes`` is the authenticated user-facing endpoint for browsing
the curated recipe catalog. It returns only **published** recipes, sorted
by::

    publish_date DESC, display_order ASC

This is the user-facing counterpart to the admin recipe management API
(``/v1/admin/recipes``). Internal generation details (``model_id``,
``prompt_template``, ``parameters``) are intentionally omitted from the
public surface — only the fields needed for catalog display and recipe
selection are exposed.

Auth contract (Seed-pinned, inherited from ``require_current_user``):

    * No / malformed bearer token → HTTP 401  ``invalid_authorization``
    * Valid token, missing ``users.id`` row → HTTP 403  ``user_not_found``
    * Valid token, live user → HTTP 200  catalog list (empty list OK)

Sort order
----------
The Seed specifies ``publish_date DESC, display_order ASC``:

    * More recently published recipes appear first.
    * Within the same publish_date bucket, lower ``display_order``
      values (i.e. operator-curated featured items) appear first.

NULL ``publish_date`` values are excluded at the filter layer (only
``published`` recipes are returned, and the publish action always sets
``publish_date`` when it is absent).

No ``sqlalchemy*`` import here: all DB access flows via
:func:`api.db.session.get_session` and the ``select`` / column
expression helpers re-exported from :mod:`api.db.session` — maintaining
the Phase 4.1 ``sqlalchemy`` single-import-boundary invariant.
"""

from __future__ import annotations

import logging
from typing import Final

from fastapi import APIRouter, Depends, status

from api.db.models.recipe import RECIPE_STATUS_PUBLISHED, Recipe
from api.db.models.user import User
from api.db.session import AsyncSession, get_session, select
from api.dependencies.auth import require_current_user
from api.schemas.recipes import CatalogRecipeListResponse, CatalogRecipeResponse

_LOGGER: Final[logging.Logger] = logging.getLogger(__name__)

#: Router hosting ``GET /v1/recipes``. The ``/v1`` prefix is applied by
#: ``api.main.create_app``.
router: APIRouter = APIRouter(tags=["recipes"])


@router.get(
    "/recipes",
    response_model=CatalogRecipeListResponse,
    status_code=status.HTTP_200_OK,
    summary="Browse the published recipe catalog",
    description=(
        "Returns all published recipes sorted by publish_date DESC, "
        "display_order ASC. Requires a valid backend JWT. "
        "Internal generation details (model, prompt, parameters) are not "
        "exposed in this public surface."
    ),
)
async def list_catalog_recipes(
    current_user: User = Depends(require_current_user),
    session: AsyncSession = Depends(get_session),
) -> CatalogRecipeListResponse:
    """Return the published recipe catalog for the authenticated user.

    Parameters
    ----------
    current_user:
        Authenticated :class:`~api.db.models.user.User` resolved by
        ``require_current_user``. Required — the endpoint is auth-gated;
        missing or invalid credentials raise HTTP 401/403 before this
        body runs.
    session:
        Per-request :class:`~api.db.session.AsyncSession`.

    Returns
    -------
    CatalogRecipeListResponse
        Published recipes sorted by ``publish_date DESC, display_order ASC``.
        An empty list is returned when no recipes are published yet —
        this is a normal state during catalog bootstrap.
    """
    stmt = (
        select(Recipe)
        .where(Recipe.status == RECIPE_STATUS_PUBLISHED)
        .order_by(Recipe.publish_date.desc(), Recipe.display_order.asc())
    )
    result = await session.execute(stmt)
    recipes = list(result.scalars().all())

    _LOGGER.info(
        "catalog_recipes_listed user_id=%s count=%d",
        str(current_user.id),
        len(recipes),
    )

    return CatalogRecipeListResponse(
        recipes=[CatalogRecipeResponse.model_validate(r) for r in recipes],
        total=len(recipes),
    )


__all__ = ["router"]
