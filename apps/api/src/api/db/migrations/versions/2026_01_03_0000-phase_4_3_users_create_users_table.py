"""Phase 4.3 users table + events.user_id FK migration.

Revision ID: phase_4_3_users
Revises: phase_4_2_events
Create Date: 2026-01-03 00:00:00.000000

The second DDL migration for ``apps/api``. Creates the ``users`` table that
backs self-managed Apple Sign In authentication and adds the
``events.user_id`` foreign key column (nullable, ``ON DELETE SET NULL``) so
authenticated event ingest in Phase 4.4+ can link rows back to a user
without breaking the pre-auth anonymous-event flow already in production.

Schema (users — exactly 7 columns, Seed-pinned)
------------------------------------------------
    id              UUID PRIMARY KEY        (app-side uuid4; no DB ext)
    apple_sub       TEXT NOT NULL           (UNIQUE: uq_users_apple_sub)
    email           TEXT NULL               (not unique — relay-email semantics)
    email_verified  BOOLEAN NOT NULL FALSE  (Apple's email_verified claim)
    display_name    TEXT NULL               (Apple's full_name, first-auth only)
    created_at      TIMESTAMPTZ NOT NULL    (DEFAULT now())
    updated_at      TIMESTAMPTZ NOT NULL    (DEFAULT now(); ORM onupdate)

events.user_id ALTER
--------------------
    user_id  UUID NULL  REFERENCES users(id) ON DELETE SET NULL

The FK is nullable so pre-Phase-4.3 anonymous events keep ingesting
unchanged, and ``ON DELETE SET NULL`` preserves analytics history on a
future GDPR right-to-delete flow (Phase 7) by anonymizing rather than
cascading the delete.

Why no DB-side uuid generation?
-------------------------------
Same rationale as Phase 4.2 events: Postgres 16 ships ``gen_random_uuid()``
through the ``pgcrypto`` extension, not in core. The Seed pins UUID
generation to the application (uuid4) so the schema stays extension-free.

Why no DB-level trigger on updated_at?
--------------------------------------
The Seed pins ``updated_at`` to ORM-level ``onupdate=func.now()`` so the
schema stays portable. The atomic ``INSERT ... ON CONFLICT DO UPDATE`` in
:mod:`api.routers.auth` will SET ``updated_at = NOW()`` explicitly in the
SET clause so the bump survives the raw-SQL boundary.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "phase_4_3_users"
down_revision: Union[str, None] = "phase_4_2_events"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create the ``users`` table + add ``events.user_id`` FK.

    DDL is emitted via :func:`alembic.op.create_table` and
    :func:`alembic.op.add_column` so the SQLAlchemy dialect generates the
    correct ``TIMESTAMP WITH TIME ZONE`` / ``UUID`` SQL for Postgres while
    keeping the migration introspectable by ``alembic upgrade --sql`` and
    the autogenerate diff machinery.
    """
    op.create_table(
        "users",
        # ---- id: UUID PRIMARY KEY (app-side uuid4, no server_default).
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
        ),
        # ---- apple_sub: TEXT NOT NULL (Apple's stable opaque sub claim).
        # The UNIQUE constraint below is named so the ON CONFLICT clause in
        # the sign-in upsert can reference it by name (stable across
        # autogenerate runs).
        sa.Column(
            "apple_sub",
            sa.Text(),
            nullable=False,
        ),
        # ---- email: TEXT NULL (NOT unique — see model docstring for why).
        sa.Column(
            "email",
            sa.Text(),
            nullable=True,
        ),
        # ---- email_verified: BOOLEAN NOT NULL DEFAULT FALSE.
        # ``server_default=text("false")`` so the column has a database-side
        # default matching the ORM ``default=False``. Both spellings are
        # required so a raw-SQL INSERT omitting the column still gets the
        # ``false`` value (the integration tests rely on this for fixture
        # creation paths).
        sa.Column(
            "email_verified",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        # ---- display_name: TEXT NULL (Apple full_name, first-auth only).
        sa.Column(
            "display_name",
            sa.Text(),
            nullable=True,
        ),
        # ---- created_at: TIMESTAMPTZ NOT NULL DEFAULT now().
        sa.Column(
            "created_at",
            postgresql.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        # ---- updated_at: TIMESTAMPTZ NOT NULL DEFAULT now() (ORM onupdate).
        # The DB default fires on INSERT; the ORM-level onupdate=func.now()
        # in api.db.models.user.User bumps it on every UPDATE that flows
        # through SQLAlchemy. The atomic ON CONFLICT DO UPDATE in the auth
        # router sets it explicitly to NOW() in the SET clause as a
        # defense-in-depth.
        sa.Column(
            "updated_at",
            postgresql.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        # ---- UNIQUE constraint on apple_sub.
        # The named constraint is the load-bearing invariant for the
        # sign-in upsert: INSERT ... ON CONFLICT ON CONSTRAINT
        # uq_users_apple_sub DO UPDATE.
        sa.UniqueConstraint("apple_sub", name="uq_users_apple_sub"),
    )

    # ---- events.user_id FK: UUID NULL REFERENCES users(id) ON DELETE SET NULL.
    # Nullable so pre-Phase-4.3 anonymous events still ingest. ON DELETE
    # SET NULL preserves analytics history on a future GDPR delete flow
    # (Phase 7) — events anonymize rather than vanish.
    op.add_column(
        "events",
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
    )
    op.create_foreign_key(
        constraint_name="fk_events_user_id",
        source_table="events",
        referent_table="users",
        local_cols=["user_id"],
        remote_cols=["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    """Drop ``events.user_id`` FK + ``users`` table in mirror order.

    Postgres ``DROP TABLE`` cascades to the table's own indexes/constraints,
    but we drop the FK explicitly first so the rollback is symmetric with
    the upgrade and the SQL stream emitted by ``alembic downgrade --sql``
    reads in mirror order. ``IF EXISTS`` is intentionally omitted: a
    downgrade that targets a phase before the table was created should
    fail loudly rather than silently no-op.
    """
    op.drop_constraint(
        constraint_name="fk_events_user_id",
        table_name="events",
        type_="foreignkey",
    )
    op.drop_column("events", "user_id")
    op.drop_table("users")
