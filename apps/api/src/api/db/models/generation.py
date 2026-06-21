"""``generations`` table — a user's delivered AI image history (AC4).

Each row records one **successful** ``POST /v1/generate`` result: the storage
key of the watermarked image (the bytes live in object storage, not the DB),
which recipe produced it, the auto-retry count, and a fixed retention window.
The gallery (``GET /v1/gallery``) lists a user's non-expired generations; the
sweep deletes rows past ``expires_at`` along with their storage objects.

# Schema

    Column            Type            Nullable  Default
    -----------------------------------------------------------------
    id                uuid (pk)       NOT NULL  (app-side uuid4)
    user_id           uuid            NOT NULL  -   (FK users.id CASCADE)
    recipe_id         text            NOT NULL  -
    result_image_key  text            NOT NULL  -
    retry_count       int             NOT NULL  0
    created_at        timestamptz     NOT NULL  now()
    expires_at        timestamptz     NOT NULL  -

# Design decisions

* **Watermarked result only.** The original selfie is never persisted (the
  generation pipeline's zero-PII-persistence invariant). Only the
  server-watermarked output key is stored, so the original never egresses.
* **``recipe_id`` is a plain TEXT, not a FK.** A recipe can be soft-deleted /
  removed from the catalog while a user's already-generated images must survive
  intact (Seed: "recipe removal keeps existing images"). Storing the
  human-readable recipe id (not a FK to ``recipes.id``) decouples image
  retention from recipe lifecycle.
* **``user_id`` FK ``ON DELETE CASCADE``.** A user's gallery is meaningless
  once the user is deleted, so the rows cascade away (the storage objects are
  reclaimed by the TTL sweep / a delete hook).
* **``expires_at`` is stored, not derived.** Persisting the absolute expiry
  (``created_at + IMAGE_TTL_DAYS``) means a later change to the TTL knob does
  not retroactively resurrect or expire existing rows, and the gallery filter +
  sweep are simple ``expires_at`` comparisons.

# Boundary contract

Lives inside ``apps/api/src/api/db/models/`` so every ``sqlalchemy*`` import
stays within the single AC11 import boundary.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from api.db.models.base import Base

# ---------------------------------------------------------------------------
# Table + index/constraint identifiers (shared with the migration).
# ---------------------------------------------------------------------------

GENERATIONS_TABLE_NAME: str = "generations"
FK_GENERATIONS_USER_ID: str = "fk_generations_user_id"
#: Composite index backing the gallery query (a user's rows, newest first).
INDEX_GENERATIONS_USER_CREATED: str = "ix_generations_user_id_created_at"
#: Index backing the TTL sweep (scan rows past their expiry).
INDEX_GENERATIONS_EXPIRES_AT: str = "ix_generations_expires_at"


class Generation(Base):
    """A single delivered, watermarked AI image in a user's gallery."""

    __tablename__ = GENERATIONS_TABLE_NAME

    # ----- id: UUID primary key, generated app-side via uuid4 -----
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        nullable=False,
    )

    # ----- user_id: owner FK (users.id), CASCADE on user delete -----
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE", name=FK_GENERATIONS_USER_ID),
        nullable=False,
    )

    # ----- recipe_id: human-readable recipe id (TEXT, not a FK) -----
    # Decoupled from the recipes table so image retention survives recipe
    # removal / soft-delete.
    recipe_id: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    # ----- result_image_key: object-storage key for the watermarked PNG -----
    result_image_key: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    # ----- retry_count: auto-retries before the accepted candidate (≥ 0) -----
    retry_count: Mapped[int] = mapped_column(
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

    # ----- expires_at: absolute retention expiry (created_at + TTL) -----
    # Stored, not derived: the gallery filters and the sweep both compare
    # against this fixed instant, so changing the TTL knob never retroactively
    # alters existing rows.
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )

    __table_args__ = (
        Index(INDEX_GENERATIONS_USER_CREATED, "user_id", "created_at"),
        Index(INDEX_GENERATIONS_EXPIRES_AT, "expires_at"),
    )

    def __repr__(self) -> str:
        return (
            f"Generation(id={self.id!r}, user_id={self.user_id!r}, "
            f"recipe_id={self.recipe_id!r}, expires_at={self.expires_at!r})"
        )


__all__ = [
    "GENERATIONS_TABLE_NAME",
    "FK_GENERATIONS_USER_ID",
    "INDEX_GENERATIONS_USER_CREATED",
    "INDEX_GENERATIONS_EXPIRES_AT",
    "Generation",
]
