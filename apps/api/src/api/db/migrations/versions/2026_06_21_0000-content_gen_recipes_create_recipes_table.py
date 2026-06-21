"""Content Generation: create recipes table.

Revision ID: content_gen_recipes
Revises: phase_4_5_referrals
Create Date: 2026-06-21 00:00:00.000000

Creates the ``recipes`` table that backs the operator-managed AI image
generation recipe catalog.

Schema (recipes — 11 columns)
-------------------------------
    id                  UUID PRIMARY KEY        (app-side uuid4)
    recipe_id           TEXT NOT NULL           (UNIQUE: uq_recipes_recipe_id)
    model_id            TEXT NOT NULL           (fal.ai model identifier)
    prompt_template     TEXT NOT NULL           (template with variable slots)
    style_reference_key TEXT NULL               (storage key for style reference)
    parameters          JSONB NOT NULL          (DEFAULT '{}')
    status              TEXT NOT NULL           (DEFAULT 'hidden')
    publish_date        TIMESTAMPTZ NULL        (catalog publish date)
    display_order       INT NOT NULL            (DEFAULT 0)
    created_at          TIMESTAMPTZ NOT NULL    (DEFAULT now())
    updated_at          TIMESTAMPTZ NOT NULL    (DEFAULT now())

Lifecycle states: hidden → published ↔ hidden; any → deleted (terminal).
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "content_gen_recipes"
down_revision: Union[str, None] = "phase_4_5_referrals"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create the ``recipes`` table."""
    op.create_table(
        "recipes",
        # ---- id: UUID PRIMARY KEY (app-side uuid4, no server_default).
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
        ),
        # ---- recipe_id: TEXT NOT NULL UNIQUE (human-readable identifier).
        # The UNIQUE constraint is named so application code and tests can
        # reference the constraint identifier without importing the ORM model.
        sa.Column(
            "recipe_id",
            sa.Text(),
            nullable=False,
        ),
        # ---- model_id: TEXT NOT NULL (fal.ai model identifier).
        sa.Column(
            "model_id",
            sa.Text(),
            nullable=False,
        ),
        # ---- prompt_template: TEXT NOT NULL (prompt with variable slots).
        sa.Column(
            "prompt_template",
            sa.Text(),
            nullable=False,
        ),
        # ---- style_reference_key: TEXT NULL (storage key for style ref).
        sa.Column(
            "style_reference_key",
            sa.Text(),
            nullable=True,
        ),
        # ---- parameters: JSONB NOT NULL DEFAULT '{}' (model-specific params).
        sa.Column(
            "parameters",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        # ---- status: TEXT NOT NULL DEFAULT 'hidden' (lifecycle state).
        sa.Column(
            "status",
            sa.Text(),
            nullable=False,
            server_default=sa.text("'hidden'"),
        ),
        # ---- publish_date: TIMESTAMPTZ NULL (catalog publish date).
        sa.Column(
            "publish_date",
            postgresql.TIMESTAMP(timezone=True),
            nullable=True,
        ),
        # ---- display_order: INT NOT NULL DEFAULT 0 (sort weight).
        sa.Column(
            "display_order",
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
        # ---- updated_at: TIMESTAMPTZ NOT NULL DEFAULT now().
        # ORM-level ``onupdate=func.now()`` in the Recipe model bumps this
        # column on every ORM-level UPDATE. Raw-SQL updates must SET
        # updated_at = NOW() explicitly.
        sa.Column(
            "updated_at",
            postgresql.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        # ---- UNIQUE constraint on recipe_id.
        sa.UniqueConstraint("recipe_id", name="uq_recipes_recipe_id"),
    )


def downgrade() -> None:
    """Drop the ``recipes`` table."""
    op.drop_table("recipes")
