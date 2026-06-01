"""Phase 4.5 referral columns migration (referral_code + referrer_user_id).

Revision ID: phase_4_5_referrals
Revises: phase_4_3_users
Create Date: 2026-01-04 00:00:00.000000

The third DDL migration for ``apps/api``. It extends the existing
``users`` table (Phase 4.3) with the two columns that back the referral
gate feature — **no new tables are created** (Seed: "No new DB tables —
only add columns to existing users table").

Schema additions (users)
-------------------------
    referral_code     VARCHAR(8) UNIQUE NOT NULL   (per-user fixed code)
    referrer_user_id  UUID NULL  REFERENCES users(id) ON DELETE SET NULL

``referral_code``
    A per-user, 8-character URL-safe base64 code generated via
    ``secrets.token_urlsafe(6)``. It is the single source of truth for the
    server-assembled ``share_url`` (``REFERRAL_BASE_URL`` + code). The
    column is UNIQUE so collisions are impossible at the DB layer, and NOT
    NULL so every user always has a sharable code. The per-user code is
    generated app-side (model-level ``default`` on
    :class:`api.db.models.user.User`) on INSERT and never rotates — the
    auth upsert's ON CONFLICT path does NOT touch it, so the code stays
    fixed per user across re-auth.

``referrer_user_id``
    A nullable self-referential FK indicating which user referred this
    one (``NULL`` for organic sign-ups). ``ON DELETE SET NULL`` keeps the
    referee row intact if the referrer is later deleted (mirrors the
    Phase 4.3 ``events.user_id`` convention and the future GDPR delete
    flow). Self-referral (``referrer_user_id = id``) is blocked at the
    application layer, not by a CHECK constraint, so the guard stays in
    the auth handler where the richer attribution-status reporting lives.

Three-step pattern for ``referral_code`` (Seed-pinned)
------------------------------------------------------
Adding a UNIQUE NOT NULL column to a table that may already hold rows
cannot be done in a single ``ADD COLUMN ... NOT NULL`` statement without a
DEFAULT (and a per-user random code has no static default). The Seed
therefore pins the canonical three-step backfill pattern:

    1. ``ADD COLUMN referral_code VARCHAR(8) NULL``    (nullable first)
    2. backfill every existing row with a freshly generated, unique code
    3. ``ALTER COLUMN ... SET NOT NULL`` + ``ADD UNIQUE`` constraint

On a fresh database (no users yet) the backfill loop is a no-op, but the
pattern is preserved so the migration is correct against a populated
production table.

Why generate codes in the migration (not via the ORM)?
------------------------------------------------------
The migration runs through a raw ``op.get_bind()`` connection — it must
not import the FastAPI app or the auth router (which would pull the whole
runtime into the alembic process). ``secrets.token_urlsafe`` is a stdlib
call with no I/O, so the backfill stays self-contained inside this file.
"""

from __future__ import annotations

import secrets
from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "phase_4_5_referrals"
down_revision: Union[str, None] = "phase_4_3_users"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# ---------------------------------------------------------------------------
# Seed-pinned identifiers + sizing. Kept as module constants so the upgrade,
# downgrade, and the companion tests reference the same literals.
# ---------------------------------------------------------------------------
_USERS_TABLE = "users"
_REFERRAL_CODE_COLUMN = "referral_code"
_REFERRER_USER_ID_COLUMN = "referrer_user_id"
_UNIQUE_CONSTRAINT_REFERRAL_CODE = "uq_users_referral_code"
_FK_REFERRER_USER_ID = "fk_users_referrer_user_id"

# ``secrets.token_urlsafe(6)`` encodes 6 random bytes as URL-safe base64,
# which always yields exactly 8 characters — the VARCHAR length below.
_REFERRAL_CODE_NBYTES = 6
_REFERRAL_CODE_LENGTH = 8


def _generate_unique_referral_code(existing: set[str]) -> str:
    """Return a fresh 8-char URL-safe code not already in ``existing``.

    ``secrets.token_urlsafe(6)`` is cryptographically strong and yields an
    8-character string; the ``existing`` set guards against the
    astronomically unlikely intra-backfill collision so the subsequent
    UNIQUE constraint never fails to apply.
    """
    while True:
        code = secrets.token_urlsafe(_REFERRAL_CODE_NBYTES)
        if code not in existing:
            existing.add(code)
            return code


def upgrade() -> None:
    """Add ``referral_code`` (3-step) + ``referrer_user_id`` FK to users."""
    # ---- Step 1: ADD COLUMN referral_code VARCHAR(8) NULL (nullable first).
    op.add_column(
        _USERS_TABLE,
        sa.Column(
            _REFERRAL_CODE_COLUMN,
            sa.String(length=_REFERRAL_CODE_LENGTH),
            nullable=True,
        ),
    )

    # ---- referrer_user_id: UUID NULL self-FK ON DELETE SET NULL.
    # Added alongside referral_code in the same migration (Seed: a single
    # phase_4_5_referrals revision owns both columns). Nullable so organic
    # sign-ups carry no referrer; ON DELETE SET NULL preserves the referee
    # row if the referrer is deleted later. The constraint name matches
    # ``FK_USERS_REFERRER_USER_ID`` in api.db.models.user so the ORM and
    # migration agree on the identifier.
    op.add_column(
        _USERS_TABLE,
        sa.Column(
            _REFERRER_USER_ID_COLUMN,
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
    )
    op.create_foreign_key(
        constraint_name=_FK_REFERRER_USER_ID,
        source_table=_USERS_TABLE,
        referent_table=_USERS_TABLE,
        local_cols=[_REFERRER_USER_ID_COLUMN],
        remote_cols=["id"],
        ondelete="SET NULL",
    )

    # ---- Step 2: backfill every existing row with a unique code.
    # On a fresh DB this selects zero rows and the loop is a no-op; on a
    # populated production table it assigns each user a per-user fixed code
    # before the NOT NULL + UNIQUE constraints are applied.
    bind = op.get_bind()
    existing_ids = bind.execute(
        sa.text(f"SELECT id FROM {_USERS_TABLE} WHERE {_REFERRAL_CODE_COLUMN} IS NULL")
    ).fetchall()
    assigned: set[str] = set()
    for (user_id,) in existing_ids:
        code = _generate_unique_referral_code(assigned)
        bind.execute(
            sa.text(
                f"UPDATE {_USERS_TABLE} "
                f"SET {_REFERRAL_CODE_COLUMN} = :code "
                f"WHERE id = :user_id"
            ),
            {"code": code, "user_id": user_id},
        )

    # ---- Step 3: ALTER COLUMN ... SET NOT NULL + add the UNIQUE constraint.
    op.alter_column(
        _USERS_TABLE,
        _REFERRAL_CODE_COLUMN,
        existing_type=sa.String(length=_REFERRAL_CODE_LENGTH),
        nullable=False,
    )
    op.create_unique_constraint(
        constraint_name=_UNIQUE_CONSTRAINT_REFERRAL_CODE,
        table_name=_USERS_TABLE,
        columns=[_REFERRAL_CODE_COLUMN],
    )


def downgrade() -> None:
    """Drop the referral columns + their constraints in mirror order.

    ``IF EXISTS`` is intentionally omitted (matching the Phase 4.3 mirror
    convention): a downgrade that targets a phase before these columns
    existed should fail loudly rather than silently no-op.
    """
    op.drop_constraint(
        constraint_name=_UNIQUE_CONSTRAINT_REFERRAL_CODE,
        table_name=_USERS_TABLE,
        type_="unique",
    )
    op.drop_constraint(
        constraint_name=_FK_REFERRER_USER_ID,
        table_name=_USERS_TABLE,
        type_="foreignkey",
    )
    op.drop_column(_USERS_TABLE, _REFERRER_USER_ID_COLUMN)
    op.drop_column(_USERS_TABLE, _REFERRAL_CODE_COLUMN)
