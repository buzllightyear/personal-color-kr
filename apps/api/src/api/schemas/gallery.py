"""Pydantic v2 schemas for the user image gallery (Content Generation AC4).

The gallery lists a user's non-expired generations. Only the fields the mobile
client needs to render the gallery + fetch each image are exposed:

    generation_id   the id used to stream the image via
                    ``GET /v1/gallery/{generation_id}/image``
    recipe_id       which recipe produced the image (for an optional label)
    created_at      when it was generated (newest first in the list)
    expires_at      when it will be swept (so the client can show a hint)

The object-storage key is intentionally NOT exposed — images are streamed
through the authenticated API, never via a public/presigned URL.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel


class GalleryItemResponse(BaseModel):
    """A single non-expired generation in a user's gallery."""

    generation_id: uuid.UUID
    recipe_id: str
    created_at: datetime
    expires_at: datetime


class GalleryListResponse(BaseModel):
    """Response schema for ``GET /v1/gallery`` (newest first)."""

    items: list[GalleryItemResponse]
    total: int


__all__ = ["GalleryItemResponse", "GalleryListResponse"]
