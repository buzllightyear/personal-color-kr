"""Phase 4.2 events table migration (first persistence table).

Revision ID: phase_4_2_events
Revises: phase_4_1_baseline
Create Date: 2026-01-02 00:00:00.000000

The first DDL migration for ``apps/api``. Creates the append-only ``events``
table that backs all server-side analytics ingestion. The schema is
intentionally PostHog-shaped (so Phase 4.4 can ship a thin sync layer
without renaming columns) but keeps every column self-contained: there is
no users FK (deferred to Phase 4.3), no request_id / source top-level
column (those go inside ``properties``), and no auth coupling.

Schema (exactly 6 columns — Seed-pinned)
----------------------------------------
    id                  UUID PRIMARY KEY        (app-side uuid4; no DB ext)
    anonymous_id        TEXT NOT NULL           (PostHog distinct_id; indexed)
    event_name          TEXT NOT NULL           (PostHog event; compound idx)
    properties          JSONB NOT NULL '{}'     (PostHog properties bag)
    occurred_at         TIMESTAMPTZ NOT NULL    (PostHog timestamp; client clock)
    server_received_at  TIMESTAMPTZ NOT NULL    (server clock; DEFAULT now())

Indexes
-------
    ix_events_anonymous_id              -- per-user / per-device lookups
    ix_events_event_name_occurred_at    -- funnel + cohort queries

Append-only is enforced by convention (the application never issues
UPDATE/DELETE on ``events``); no DB-level trigger is added here because the
Seed scope keeps Phase 4.2 strictly to model + migration + tests.

Why no DB-side uuid generation?
-------------------------------
Postgres 16 ships ``gen_random_uuid()`` through the ``pgcrypto`` extension,
not in core. Requiring the extension would bind every fresh DB to a
``CREATE EXTENSION`` step that managed-Postgres providers gate behind
superuser. The Seed constraint "UUID generation is app-side uuid4 (no DB
extension dependency)" sidesteps that entirely — the Python layer fills
``id`` with ``uuid.uuid4()`` on insert. The migration therefore declares
the column as ``UUID PRIMARY KEY`` with no ``DEFAULT``.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "phase_4_2_events"
down_revision: Union[str, None] = "phase_4_1_baseline"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create the ``events`` table and its two indexes.

    DDL is emitted via :func:`alembic.op.create_table` (not raw
    ``op.execute("CREATE TABLE ...")``) so the SQLAlchemy dialect generates
    the correct ``TIMESTAMP WITH TIME ZONE`` / ``JSONB`` SQL for Postgres
    while keeping the migration introspectable by ``alembic upgrade --sql``
    and the alembic autogenerate diff machinery.
    """
    op.create_table(
        "events",
        # ---- id: UUID PRIMARY KEY (app-side uuid4, no server_default).
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
        ),
        # ---- anonymous_id: TEXT NOT NULL (client-generated distinct id).
        sa.Column(
            "anonymous_id",
            sa.Text(),
            nullable=False,
        ),
        # ---- event_name: TEXT NOT NULL (PostHog `event` equivalent).
        sa.Column(
            "event_name",
            sa.Text(),
            nullable=False,
        ),
        # ---- properties: JSONB NOT NULL DEFAULT '{}'::jsonb.
        # ``server_default=text("'{}'::jsonb")`` writes the literal empty
        # object at the DB level so callers that omit ``properties`` get a
        # consistent default without the application having to fill it.
        sa.Column(
            "properties",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        # ---- occurred_at: TIMESTAMPTZ NOT NULL (client-clock event time).
        # No server_default — clients are required to provide this; the
        # server-side timestamp lives in ``server_received_at`` so the two
        # clocks can be diffed for drift analysis.
        sa.Column(
            "occurred_at",
            postgresql.TIMESTAMP(timezone=True),
            nullable=False,
        ),
        # ---- server_received_at: TIMESTAMPTZ NOT NULL DEFAULT now().
        # The DB default is what makes the column protective against client
        # clock skew: even a bogus ``occurred_at`` cannot poison the
        # server-side ingest timestamp.
        sa.Column(
            "server_received_at",
            postgresql.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )

    # ---- Index: per-user/per-device lookups via anonymous_id.
    op.create_index(
        "ix_events_anonymous_id",
        "events",
        ["anonymous_id"],
        unique=False,
    )

    # ---- Index: funnel + cohort queries by (event_name, occurred_at).
    # Compound order is event_name first, occurred_at second so
    # ``WHERE event_name = ? AND occurred_at BETWEEN ? AND ?`` uses the
    # index for both the equality and the range scan.
    op.create_index(
        "ix_events_event_name_occurred_at",
        "events",
        ["event_name", "occurred_at"],
        unique=False,
    )


def downgrade() -> None:
    """Drop the ``events`` table and its indexes.

    Postgres ``DROP TABLE`` cascades to the table's own indexes, but we
    drop the indexes explicitly first so the rollback is symmetric with the
    upgrade and the SQL stream emitted by ``alembic downgrade --sql`` reads
    in mirror order. ``IF EXISTS`` is intentionally omitted: a downgrade
    that targets a phase before the table was created should fail loudly
    rather than silently no-op.
    """
    op.drop_index("ix_events_event_name_occurred_at", table_name="events")
    op.drop_index("ix_events_anonymous_id", table_name="events")
    op.drop_table("events")
