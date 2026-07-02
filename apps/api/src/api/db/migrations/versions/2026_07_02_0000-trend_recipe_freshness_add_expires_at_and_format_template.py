"""Add trend-freshness + format-template columns to the recipes table.

Pivot milestone 1 (STRATEGY §7-D gaps #1/#2): a trend is defined by
timeliness, so recipes gain ``expires_at`` (nullable timestamptz — NULL =
evergreen, keeping every pre-pivot row working unchanged; the public
catalog filters ``expires_at IS NULL OR expires_at > now()``); and
``format_template`` (nullable JSONB — the deterministic compositing
layer's authoring slot, internal-only like ``prompt_template``).

Both columns are nullable with no backfill, so this migration is pure
``ADD COLUMN`` and its downgrade is pure ``DROP COLUMN``.

Revision ID: trend_recipe_freshness
Revises: content_gen_recipe_meta
Create Date: 2026-07-02 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "trend_recipe_freshness"
down_revision = "content_gen_recipe_meta"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add ``expires_at`` + ``format_template`` to ``recipes``."""
    op.add_column(
        "recipes",
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "recipes",
        sa.Column(
            "format_template",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )


def downgrade() -> None:
    """Drop the two pivot columns."""
    op.drop_column("recipes", "format_template")
    op.drop_column("recipes", "expires_at")
