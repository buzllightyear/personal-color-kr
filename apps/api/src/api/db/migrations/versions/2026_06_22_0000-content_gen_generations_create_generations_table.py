"""Content Generation (AC4): create generations table.

Revision ID: content_gen_generations
Revises: content_gen_recipes
Create Date: 2026-06-22 00:00:00.000000

Creates the ``generations`` table backing a user's delivered AI-image gallery.
Each row stores the object-storage key of a watermarked result (not the bytes),
the producing recipe id, the auto-retry count, and a fixed retention expiry.

Schema (generations — 7 columns)
--------------------------------
    id                UUID PRIMARY KEY        (app-side uuid4)
    user_id           UUID NOT NULL           (FK users.id ON DELETE CASCADE)
    recipe_id         TEXT NOT NULL           (human-readable recipe id, not a FK)
    result_image_key  TEXT NOT NULL           (object-storage key of the PNG)
    retry_count       INT NOT NULL            (DEFAULT 0)
    created_at        TIMESTAMPTZ NOT NULL    (DEFAULT now())
    expires_at        TIMESTAMPTZ NOT NULL    (created_at + IMAGE_TTL_DAYS)

Indexes
-------
    ix_generations_user_id_created_at   (user_id, created_at)  -- gallery query
    ix_generations_expires_at           (expires_at)           -- TTL sweep

``recipe_id`` is intentionally a plain TEXT column (not a FK to recipes.id) so
images survive recipe removal. ``user_id`` cascades on user delete.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "content_gen_generations"
down_revision: Union[str, None] = "content_gen_recipes"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create the ``generations`` table + its two indexes."""
    op.create_table(
        "generations",
        # ---- id: UUID PRIMARY KEY (app-side uuid4, no server_default).
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
        ),
        # ---- user_id: UUID NOT NULL, FK users.id ON DELETE CASCADE.
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        # ---- recipe_id: TEXT NOT NULL (human-readable id, not a FK).
        sa.Column(
            "recipe_id",
            sa.Text(),
            nullable=False,
        ),
        # ---- result_image_key: TEXT NOT NULL (object-storage key).
        sa.Column(
            "result_image_key",
            sa.Text(),
            nullable=False,
        ),
        # ---- retry_count: INT NOT NULL DEFAULT 0.
        sa.Column(
            "retry_count",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        # ---- created_at: TIMESTAMPTZ NOT NULL DEFAULT now().
        sa.Column(
            "created_at",
            postgresql.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        # ---- expires_at: TIMESTAMPTZ NOT NULL (set by the app at insert).
        sa.Column(
            "expires_at",
            postgresql.TIMESTAMP(timezone=True),
            nullable=False,
        ),
        # ---- FK: user_id → users.id, cascade on user delete.
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_generations_user_id",
            ondelete="CASCADE",
        ),
    )
    # Composite index for the gallery query (a user's rows, newest first).
    op.create_index(
        "ix_generations_user_id_created_at",
        "generations",
        ["user_id", "created_at"],
    )
    # Index for the TTL sweep (scan rows past their expiry).
    op.create_index(
        "ix_generations_expires_at",
        "generations",
        ["expires_at"],
    )


def downgrade() -> None:
    """Drop the ``generations`` table (indexes drop with it)."""
    op.drop_index("ix_generations_expires_at", table_name="generations")
    op.drop_index("ix_generations_user_id_created_at", table_name="generations")
    op.drop_table("generations")
