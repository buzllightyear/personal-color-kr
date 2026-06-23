"""Pydantic v2 schemas for the admin recipe API (Content Generation Phase).

Wire format
-----------
* Requests carry snake_case JSON (all fields are optional on update).
* Responses are snake_case (the admin UI is operator-only; no
  camelCase projection needed here unlike the mobile-facing endpoints).

Lifecycle state machine (Seed-pinned)
--------------------------------------
    hidden    → publish action  → published
    published → hide action     → hidden
    *         → delete action   → deleted (terminal)

The :class:`RecipeStatusEnum` and :func:`validate_transition` enforce
these transitions; the router delegates to both.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import Enum
from typing import Any
from urllib.parse import urlparse

from pydantic import BaseModel, Field, field_validator

from api.db.models.recipe import (
    RECIPE_STATUS_DELETED,
    RECIPE_STATUS_HIDDEN,
    RECIPE_STATUS_PUBLISHED,
    is_valid_transition,
)


def _validate_https_url(value: str | None) -> str | None:
    """Reject anything that isn't a public ``https://`` URL.

    None passes (field is nullable). Empty/blank strings are rejected — the
    web form converts blanks to ``null`` before sending, so a blank reaching
    the API is a bug, not "cleared". Parses scheme + host so a bare
    ``"https://"`` (no host) and relative paths / storage keys are rejected,
    not just non-https schemes.
    """
    if value is None:
        return None
    parsed = urlparse(value)
    if parsed.scheme != "https" or not parsed.netloc:
        raise ValueError("thumbnail_url must be a public https:// URL with a host")
    return value


class RecipeStatusEnum(str, Enum):
    """Valid recipe lifecycle statuses (Seed-pinned)."""

    published = RECIPE_STATUS_PUBLISHED
    hidden = RECIPE_STATUS_HIDDEN
    deleted = RECIPE_STATUS_DELETED


class RecipeCreate(BaseModel):
    """Request body for ``POST /admin/recipes``.

    ``status`` defaults to ``hidden`` so a newly created recipe is not
    immediately visible in the public catalog.
    """

    recipe_id: str = Field(..., min_length=1, description="Human-readable unique ID")
    model_id: str = Field(..., min_length=1, description="fal.ai model identifier")
    prompt_template: str = Field(..., min_length=1, description="Prompt template")
    title: str = Field(..., min_length=1, description="Catalog display title")
    description: str | None = Field(None, description="Optional catalog subtitle")
    tags: list[str] = Field(
        default_factory=list, description="Classification tags / chips"
    )
    thumbnail_url: str | None = Field(
        None, description="Public HTTPS URL of the example thumbnail"
    )
    style_reference_key: str | None = Field(
        None, description="Object-storage key for the style reference image"
    )
    parameters: dict[str, Any] = Field(
        default_factory=dict, description="Model-specific parameter set"
    )
    status: RecipeStatusEnum = Field(
        RecipeStatusEnum.hidden, description="Initial lifecycle status"
    )
    publish_date: datetime | None = Field(None, description="Catalog publish date")
    display_order: int = Field(0, description="Featured-section sort weight")

    _validate_thumbnail_url = field_validator("thumbnail_url")(_validate_https_url)

    @field_validator("status", mode="before")
    @classmethod
    def _validate_status(cls, v: object) -> object:
        """Reject 'deleted' as an initial status on creation."""
        if v == RECIPE_STATUS_DELETED:
            raise ValueError("Cannot create a recipe with status 'deleted'.")
        return v


class RecipeUpdate(BaseModel):
    """Request body for ``PUT /admin/recipes/{recipe_id}``.

    All fields are optional — only provided fields are updated.
    The ``status`` field is intentionally excluded from the update
    schema; status transitions must go through dedicated lifecycle
    endpoints (publish/hide/delete) so the state machine is always
    enforced.
    """

    model_id: str | None = Field(None, min_length=1)
    prompt_template: str | None = Field(None, min_length=1)
    title: str | None = Field(None, min_length=1)
    description: str | None = None
    tags: list[str] | None = None
    thumbnail_url: str | None = None
    style_reference_key: str | None = None
    parameters: dict[str, Any] | None = None
    publish_date: datetime | None = None
    display_order: int | None = None

    _validate_thumbnail_url = field_validator("thumbnail_url")(_validate_https_url)


class RecipeResponse(BaseModel):
    """Response schema for a single recipe (create, read, update, lifecycle)."""

    id: uuid.UUID
    recipe_id: str
    model_id: str
    prompt_template: str
    title: str
    description: str | None
    tags: list[str]
    thumbnail_url: str | None
    style_reference_key: str | None
    parameters: dict[str, Any]
    status: RecipeStatusEnum
    publish_date: datetime | None
    display_order: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class RecipeListResponse(BaseModel):
    """Response schema for ``GET /admin/recipes``."""

    recipes: list[RecipeResponse]
    total: int


class CatalogRecipeResponse(BaseModel):
    """Public catalog entry for a single recipe.

    Exposes only the fields needed for catalog display and recipe
    selection. Internal generation details (model_id, prompt_template,
    parameters) are intentionally omitted from the public surface.
    """

    recipe_id: str
    title: str
    description: str | None
    tags: list[str]
    thumbnail_url: str | None
    style_reference_key: str | None
    publish_date: datetime | None
    display_order: int
    created_at: datetime

    model_config = {"from_attributes": True}


class CatalogRecipeListResponse(BaseModel):
    """Response schema for ``GET /v1/recipes`` (public catalog)."""

    recipes: list[CatalogRecipeResponse]
    total: int


class RecipePreviewResponse(BaseModel):
    """Response schema for ``POST /admin/recipes/{recipe_id}/preview``.

    The endpoint calls the fal.ai model configured in the recipe and
    returns the first generated image URL.  Only the URL is returned;
    original image bytes are never sent to the client (server-side-only
    watermarking lives in the generation pipeline, not the preview path).
    """

    image_url: str = Field(
        ...,
        description="URL of the first image generated by the fal.ai model",
    )


class InvalidTransitionError(ValueError):
    """Raised when a requested lifecycle transition is not allowed.

    The router converts this to HTTP 422.
    """

    def __init__(self, current: str, target: str) -> None:
        super().__init__(
            f"Cannot transition recipe from {current!r} to {target!r}. "
            "Check RECIPE_TRANSITIONS for allowed transitions."
        )
        self.current = current
        self.target = target


def validate_transition(current_status: str, target_status: str) -> None:
    """Assert that the transition from *current* to *target* is allowed.

    Parameters
    ----------
    current_status:
        The recipe's current status string.
    target_status:
        The desired next status string.

    Raises
    ------
    InvalidTransitionError
        When the transition is not in :data:`RECIPE_TRANSITIONS`.
    """
    if not is_valid_transition(current_status, target_status):
        raise InvalidTransitionError(current_status, target_status)


__all__ = [
    "RecipeStatusEnum",
    "RecipeCreate",
    "RecipeUpdate",
    "RecipeResponse",
    "RecipeListResponse",
    "CatalogRecipeResponse",
    "CatalogRecipeListResponse",
    "RecipePreviewResponse",
    "InvalidTransitionError",
    "validate_transition",
]
