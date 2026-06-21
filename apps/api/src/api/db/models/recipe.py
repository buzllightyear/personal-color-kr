"""``recipes`` table for the AI image generation system (Content Generation).

Each row represents a curated trend recipe that drives the AI generation
pipeline. Recipes are managed by the operator via the admin API and surfaced
to end-users as a catalog of generative styles.

# Schema

    Column              Type            Nullable  Default
    -----------------------------------------------------------------
    id                  uuid (pk)       NOT NULL  (app-side uuid4)
    recipe_id           text UNIQUE     NOT NULL  -
    model_id            text            NOT NULL  -
    prompt_template     text            NOT NULL  -
    style_reference_key text            NULL      -
    parameters          jsonb           NOT NULL  {}
    status              text            NOT NULL  'hidden'
    publish_date        timestamptz     NULL      -
    display_order       int             NOT NULL  0
    created_at          timestamptz     NOT NULL  now()
    updated_at          timestamptz     NOT NULL  now()  (ORM onupdate)

# Lifecycle states

    hidden    → published  (publish action)
    published → hidden     (hide action)
    *         → deleted    (soft-delete; terminal state)

Deleted recipes are never physically removed; they are excluded from the
public catalog by a status filter and can only be listed by the admin API.

# Boundary contract

Lives inside ``apps/api/src/api/db/models/`` so every ``sqlalchemy*`` import
stays within the single AC11 import boundary.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from api.db.models.base import Base

# ---------------------------------------------------------------------------
# Table and constraint identifiers (module-level constants keep the migration
# and router referring to the same string literals).
# ---------------------------------------------------------------------------

RECIPES_TABLE_NAME: str = "recipes"
UNIQUE_CONSTRAINT_RECIPE_ID: str = "uq_recipes_recipe_id"

# ---------------------------------------------------------------------------
# Lifecycle status constants
# ---------------------------------------------------------------------------

RECIPE_STATUS_PUBLISHED: str = "published"
RECIPE_STATUS_HIDDEN: str = "hidden"
RECIPE_STATUS_DELETED: str = "deleted"

RECIPE_STATUSES: frozenset[str] = frozenset(
    {RECIPE_STATUS_PUBLISHED, RECIPE_STATUS_HIDDEN, RECIPE_STATUS_DELETED}
)

# Valid transitions: current_status → set of allowed next statuses.
# Deleted is a terminal state; no transition out of it is permitted.
RECIPE_TRANSITIONS: dict[str, frozenset[str]] = {
    RECIPE_STATUS_HIDDEN: frozenset({RECIPE_STATUS_PUBLISHED, RECIPE_STATUS_DELETED}),
    RECIPE_STATUS_PUBLISHED: frozenset({RECIPE_STATUS_HIDDEN, RECIPE_STATUS_DELETED}),
    RECIPE_STATUS_DELETED: frozenset(),  # terminal — no outbound transitions
}


def is_valid_transition(current: str, target: str) -> bool:
    """Return True iff transitioning from *current* to *target* is allowed.

    Parameters
    ----------
    current:
        The recipe's current status.
    target:
        The status to transition to.

    Returns
    -------
    bool
        ``True`` when the transition is in :data:`RECIPE_TRANSITIONS`.
    """
    allowed = RECIPE_TRANSITIONS.get(current, frozenset())
    return target in allowed


class Recipe(Base):
    """AI image generation recipe ORM model.

    Each row represents one trend recipe driving the server-side
    fal.ai generation pipeline. The ``recipe_id`` field is the human-
    readable identifier used by the API surface; the ``id`` UUID is the
    internal primary key that downstream tables may foreign-key into.

    Status lifecycle
    ----------------
    A recipe starts life as ``hidden`` (not visible in the public catalog).
    The operator promotes it to ``published`` (visible, sortable by
    ``display_order``) or demotes it back to ``hidden``. Soft-delete
    transitions to ``deleted`` (terminal; never physically removed).
    """

    __tablename__ = RECIPES_TABLE_NAME

    # ----- id: UUID primary key, generated app-side via uuid4 -----
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        nullable=False,
    )

    # ----- recipe_id: human-readable UNIQUE identifier -----
    # The public identifier surfaced in API responses and referenced by
    # downstream tables. Stored as TEXT (no length cap). The UNIQUE
    # constraint is named so the migration and tests can reference it
    # by the stable identifier.
    recipe_id: Mapped[str] = mapped_column(
        String,
        nullable=False,
    )

    # ----- model_id: fal.ai model identifier -----
    model_id: Mapped[str] = mapped_column(
        String,
        nullable=False,
    )

    # ----- prompt_template: prompt with variable slots -----
    # May contain template variables like ``{personal_color_modifier}``
    # that are expanded at generation time. Stored as TEXT (unlimited).
    prompt_template: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    # ----- style_reference_key: optional object-storage key -----
    # Storage key or URL for a style-reference image attached to this
    # recipe. NULL means no style-reference (the generation uses the
    # prompt template alone).
    style_reference_key: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    # ----- parameters: model-specific fal.ai parameter set -----
    # Arbitrary JSON object passed verbatim to the fal.ai model at
    # generation time (e.g. ``{"num_inference_steps": 30, "seed": 42}``).
    # Stored as JSONB for efficient indexing and partial updates.
    # The ORM-level ``default=dict`` fires on INSERT when the column is
    # omitted; the migration ships a ``server_default='{}'::jsonb`` so
    # raw-SQL inserts also get an empty object.
    parameters: Mapped[dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
        server_default="{}",
    )

    # ----- status: lifecycle state (published/hidden/deleted) -----
    # Constrained to the three values in RECIPE_STATUSES; validated at
    # the application layer (Pydantic + state machine), not by a DB
    # CHECK constraint, to keep DDL portable and the migration simple.
    status: Mapped[str] = mapped_column(
        String,
        nullable=False,
        default=RECIPE_STATUS_HIDDEN,
        server_default=RECIPE_STATUS_HIDDEN,
    )

    # ----- publish_date: ISO date for catalog ordering -----
    # NULL until the operator explicitly sets a publish date (e.g. to
    # schedule a future catalog release). The public catalog sorts by
    # (publish_date DESC, display_order ASC).
    publish_date: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # ----- display_order: featured-section sort weight -----
    # Lower values appear first within the same publish_date bucket.
    # Defaults to 0 so newly created recipes land at the top of an
    # unsorted group.
    display_order: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
    )

    # ----- created_at: insertion timestamp -----
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    # ----- updated_at: bump-on-update timestamp -----
    # ``server_default=func.now()`` fires on INSERT; ``onupdate=func.now()``
    # bumps it on every ORM-level UPDATE. Routes that bypass the ORM
    # (raw SQL) must SET updated_at = NOW() explicitly.
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    __table_args__ = (UniqueConstraint("recipe_id", name=UNIQUE_CONSTRAINT_RECIPE_ID),)

    def __repr__(self) -> str:
        return (
            f"Recipe(id={self.id!r}, recipe_id={self.recipe_id!r}, "
            f"model_id={self.model_id!r}, status={self.status!r})"
        )


__all__ = [
    "RECIPES_TABLE_NAME",
    "UNIQUE_CONSTRAINT_RECIPE_ID",
    "RECIPE_STATUS_PUBLISHED",
    "RECIPE_STATUS_HIDDEN",
    "RECIPE_STATUS_DELETED",
    "RECIPE_STATUSES",
    "RECIPE_TRANSITIONS",
    "is_valid_transition",
    "Recipe",
]
