"""Add display-metadata columns to the recipes table.

Adds ``title``, ``description``, ``tags``, ``thumbnail_url`` so the public
catalog can render recipe cards (Meitu-style: title + example thumbnail +
optional description + classification tags).

Revision ID: content_gen_recipe_meta
Revises: content_gen_generations
Create Date: 2026-06-23 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "content_gen_recipe_meta"
down_revision = "content_gen_generations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add the four display-metadata columns to ``recipes``."""
    # Add ``title`` NOT NULL. ``server_default=''`` lets the column be added
    # to existing rows, but an empty title would surface as a blank catalog
    # card (R1 HIGH). Backfill existing rows with ``recipe_id`` as a
    # human-meaningful placeholder, THEN drop the server_default so future
    # inserts must supply a title (the API enforces ``min_length=1``).
    op.add_column(
        "recipes",
        sa.Column(
            "title",
            sa.Text(),
            nullable=False,
            server_default=sa.text("''"),
        ),
    )
    # Backfill any pre-existing rows so no published recipe renders with a
    # blank title. ``recipe_id`` is the operator-facing slug — a reasonable
    # stopgap the operator can later overwrite via the admin form.
    op.execute("UPDATE recipes SET title = recipe_id WHERE title = ''")
    # Remove the column default so the column is genuinely operator-required
    # going forward (matches the API ``min_length=1`` contract).
    op.alter_column("recipes", "title", server_default=None)
    op.add_column(
        "recipes",
        sa.Column("description", sa.Text(), nullable=True),
    )
    op.add_column(
        "recipes",
        sa.Column(
            "tags",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    op.add_column(
        "recipes",
        sa.Column("thumbnail_url", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    """Drop the four display-metadata columns."""
    op.drop_column("recipes", "thumbnail_url")
    op.drop_column("recipes", "tags")
    op.drop_column("recipes", "description")
    op.drop_column("recipes", "title")
