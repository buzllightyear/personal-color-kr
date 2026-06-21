"""User image gallery API (Content Generation AC4).

Two authenticated endpoints over the ``generations`` table:

    GET /v1/gallery
        List the caller's **non-expired** generations, newest first. Each item
        carries the ``generation_id`` the client uses to fetch the image.

    GET /v1/gallery/{generation_id}/image
        Stream the watermarked PNG for one of the caller's non-expired
        generations. The image is read from object storage with the server's
        own credentials and streamed back — there is no public / presigned URL,
        so the original never egresses and access is always auth-checked.

TTL is enforced at read time: both endpoints filter ``expires_at > now`` so an
expired generation is invisible even before the out-of-band sweep deletes it.

Recipe lifecycle independence: a generation row stores the recipe id as plain
text (not a FK), so images remain listable/streamable even after the recipe is
hidden or removed from the catalog.

No ``sqlalchemy*`` import here: all query construction flows through the
``select`` helper re-exported from :mod:`api.db.session`, preserving the AC11
single-import-boundary invariant.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Final

from fastapi import APIRouter, Depends, HTTPException, Response, status

from api.db.models.generation import Generation
from api.db.models.user import User
from api.db.session import AsyncSession, Select, get_session, select
from api.dependencies.auth import require_current_user
from api.dependencies.storage import get_object_storage
from api.schemas.gallery import GalleryItemResponse, GalleryListResponse
from api.storage.object_storage import ObjectNotFoundError, ObjectStorage

_LOGGER: Final[logging.Logger] = logging.getLogger(__name__)

#: HTTP 404 detail for a generation that does not belong to the caller, does
#: not exist, or has expired. A single opaque detail avoids leaking whether the
#: id exists for another user.
DETAIL_GENERATION_NOT_FOUND: Final[str] = "generation_not_found"

#: HTTP 404 detail when the row exists but its bytes are absent in storage
#: (e.g. swept out-of-band between the row read and the object read).
DETAIL_IMAGE_NOT_FOUND: Final[str] = "image_not_found"

router: APIRouter = APIRouter(tags=["gallery"])


def select_active_generations(
    user_id: uuid.UUID, now: datetime
) -> Select[tuple[Generation]]:
    """Build the SELECT for a user's non-expired generations (newest first)."""
    return (
        select(Generation)
        .where(Generation.user_id == user_id)
        .where(Generation.expires_at > now)
        .order_by(Generation.created_at.desc())
    )


def select_active_generation(
    generation_id: uuid.UUID, user_id: uuid.UUID, now: datetime
) -> Select[tuple[Generation]]:
    """Build the SELECT for one non-expired generation owned by the user."""
    return (
        select(Generation)
        .where(Generation.id == generation_id)
        .where(Generation.user_id == user_id)
        .where(Generation.expires_at > now)
    )


@router.get(
    "/gallery",
    response_model=GalleryListResponse,
    status_code=status.HTTP_200_OK,
    summary="List the caller's non-expired generated images (newest first)",
)
async def list_gallery(
    current_user: User = Depends(require_current_user),
    session: AsyncSession = Depends(get_session),
) -> GalleryListResponse:
    """Return the authenticated user's non-expired generations, newest first."""
    now = datetime.now(timezone.utc)
    stmt = select_active_generations(current_user.id, now)
    result = await session.execute(stmt)
    rows = list(result.scalars().all())

    items = [
        GalleryItemResponse(
            generation_id=row.id,
            recipe_id=row.recipe_id,
            created_at=row.created_at,
            expires_at=row.expires_at,
        )
        for row in rows
    ]
    _LOGGER.info("gallery_listed user_id=%s count=%d", str(current_user.id), len(items))
    return GalleryListResponse(items=items, total=len(items))


@router.get(
    "/gallery/{generation_id}/image",
    status_code=status.HTTP_200_OK,
    summary="Stream the watermarked PNG for one of the caller's generations",
    responses={
        200: {"content": {"image/png": {}}},
        404: {"description": "Generation not found / not owned / expired"},
    },
)
async def get_gallery_image(
    generation_id: uuid.UUID,
    current_user: User = Depends(require_current_user),
    session: AsyncSession = Depends(get_session),
    storage: ObjectStorage = Depends(get_object_storage),
) -> Response:
    """Stream the watermarked image bytes for an owned, non-expired generation."""
    now = datetime.now(timezone.utc)
    stmt = select_active_generation(generation_id, current_user.id, now)
    result = await session.execute(stmt)
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=DETAIL_GENERATION_NOT_FOUND,
        )

    try:
        image_bytes = storage.get(row.result_image_key)
    except ObjectNotFoundError:
        # The row exists but the object is gone (swept between reads). Surface a
        # 404 rather than a 500 — from the client's view the image is simply
        # unavailable.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=DETAIL_IMAGE_NOT_FOUND,
        ) from None

    return Response(content=image_bytes, media_type="image/png")


__all__ = [
    "router",
    "DETAIL_GENERATION_NOT_FOUND",
    "DETAIL_IMAGE_NOT_FOUND",
    "select_active_generations",
    "select_active_generation",
]
