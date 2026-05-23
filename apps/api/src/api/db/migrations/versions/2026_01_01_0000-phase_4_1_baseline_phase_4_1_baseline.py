"""Phase 4.1 baseline migration (empty, no-op).

Revision ID: phase_4_1_baseline
Revises: None (this is the chain root)
Create Date: 2026-01-01 00:00:00.000000

The single migration shipped in Phase 4.1. Its sole purpose is to establish
the alembic migration chain — ``down_revision = None`` makes this revision
the root, so Phase 4.2+ migrations can extend the chain without re-doing the
alembic scaffolding.

Both ``upgrade()`` and ``downgrade()`` execute a no-op ``SELECT 1`` against
the active connection. This deliberately exercises the alembic transaction
wrapper end-to-end during the docker-compose smoke (Phase 4.1 AC18) while
creating zero application tables (Phase 4.1 invariant — schema work is
deferred to Phase 4.2 users + events).

A fixed string ``revision`` identifier (not a randomly-generated alembic
hash) keeps the migration reviewable and the filename stable across
regenerations — see Phase 4.1 constraint "revision_id fixed string".
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "phase_4_1_baseline"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op upgrade — exercises the alembic transaction without DDL."""
    op.execute("SELECT 1")


def downgrade() -> None:
    """No-op downgrade — matches the no-op upgrade by executing SELECT 1."""
    op.execute("SELECT 1")
