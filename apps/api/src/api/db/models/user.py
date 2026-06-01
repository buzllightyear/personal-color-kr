"""``users`` table backing self-managed Apple Sign In auth (Phase 4.3).

The :class:`User` declarative model owns the ``users`` table defined by the
Phase 4.3 Seed (seven columns) and extended by the Phase 4.5 referral-
attribution Seed (``referrer_user_id``). Each row represents a single Apple
Sign In identity, keyed by Apple's stable opaque ``sub`` claim, with a
backend-side UUID v4 primary key that downstream tables (``events.user_id``
and any Phase 4.4+ user-owned resources) can foreign-key into.

# Schema (Phase 4.3 Sub-AC 1 verbatim + Phase 4.5 referral columns)

    Column            Type           Nullable  Default
    -----------------------------------------------------------------
    id                uuid (pk)      NOT NULL  (app-side uuid4)
    apple_sub         text           NOT NULL  -                (UNIQUE)
    email             text           NULL      -
    email_verified    boolean        NOT NULL  FALSE
    display_name      text           NULL      -
    created_at        timestamptz    NOT NULL  now()
    updated_at        timestamptz    NOT NULL  now()            (ORM onupdate=now())
    referrer_user_id  uuid           NULL      -                (FK users.id, SET NULL)

# Constraints

    PK    id
    UQ    uq_users_apple_sub        (apple_sub)

The unique constraint on ``apple_sub`` is the load-bearing invariant that
makes the Phase 4.3 sign-in upsert atomic via ``INSERT ... ON CONFLICT
(apple_sub) DO UPDATE`` — re-authenticating with the same Apple identity
collides on this index and triggers the UPDATE branch.

# Why ``email`` is NOT unique

Apple Sign In supports the private-relay email feature: the same user
can be issued different relay addresses across re-installs, and two
distinct Apple identities can theoretically share an email if a user
deletes and recreates their iCloud account. Indexing ``email`` UNIQUE
would corrupt the upsert: a re-auth that drops the relay address and
re-issues a new one would hit a phantom collision. ``apple_sub`` is the
only stable opaque identifier per Apple semantics; that is the column we
key on.

# UUID generation

``id`` is generated **app-side** via :func:`uuid.uuid4` (matching the
Event model in :mod:`api.db.models.event`). No ``server_default`` is set
so the schema stays extension-free (no ``uuid-ossp``, no ``pgcrypto``).

# updated_at semantics

The Phase 4.3 Seed pins ``updated_at`` to ORM-level ``onupdate=func.now()``
— *not* a database trigger. The intent is to keep the schema portable and
to avoid trigger-vs-application-default surprises during alembic
upgrades. Every UPDATE that flows through SQLAlchemy bumps the column;
direct ``UPDATE users SET ...`` SQL (which the Phase 4.3 codebase does
NOT use) would NOT bump it. The atomic ``INSERT ... ON CONFLICT DO
UPDATE`` in :mod:`api.routers.auth` will set ``updated_at = now()``
explicitly in the SET clause so the audit-trail invariant survives the
ORM-vs-SQL boundary.

# display_name overwrite policy

The Apple Sign In ``full_name`` claim is only present on the *first*
authorization for a given device/app pair — subsequent re-auths return
``full_name=None``. The sign-in upsert MUST therefore use
``display_name = COALESCE(EXCLUDED.display_name, users.display_name)`` so
a re-auth that arrives without ``full_name`` does not blank the existing
value. The constraint is enforced by the router/repository layer, not by
the column declaration (this model only declares ``nullable=True`` on
``display_name``).

# Boundary contract

Living inside ``apps/api/src/api/db/models/`` keeps every
``sqlalchemy*`` import line under the Phase 4.1 AC11 single-import
boundary. Routers, schemas, and dependencies must consume :class:`User`
through the Phase 4.3 auth router (which performs the atomic upsert
directly) — never import this class into ``apps/api/src/api/routers/``
modules other than ``auth.py``.
"""

from __future__ import annotations

import secrets
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from api.db.models.base import Base

# Constants pulled out of the class body so the Phase 4.3 migration file
# (and the auth router that constructs INSERT ... ON CONFLICT statements)
# can reference the same string literals without importing the ORM
# class. Single source of truth for table name + constraint identifier.
USERS_TABLE_NAME: str = "users"
UNIQUE_CONSTRAINT_APPLE_SUB: str = "uq_users_apple_sub"
# Phase 4.5 — referral attribution. The self-referential FK constraint that
# links a referee back to the user who referred them. Named so the Phase 4.5
# migration and any future repository surface reference the same identifier
# without importing the ORM class.
FK_USERS_REFERRER_USER_ID: str = "fk_users_referrer_user_id"
# Phase 4.5 — per-user fixed referral code. The named UNIQUE constraint mirrors
# the ``phase_4_5_referrals`` migration so the ORM and DDL agree on the
# identifier (the auth upsert's collision-retry can reference it by name).
UNIQUE_CONSTRAINT_REFERRAL_CODE: str = "uq_users_referral_code"
# ``secrets.token_urlsafe(6)`` always renders as 8 URL-safe base64 characters
# (6 random bytes → ceil(6 * 4 / 3) = 8 chars). The column is sized to match.
REFERRAL_CODE_NBYTES: int = 6
REFERRAL_CODE_LENGTH: int = 8


def generate_referral_code() -> str:
    """Return a fresh 8-char URL-safe referral code (``token_urlsafe(6)``).

    Used as the model-level ``default`` for :attr:`User.referral_code` so any
    INSERT that omits the column — including the auth router's
    ``INSERT ... ON CONFLICT`` upsert — gets a per-user code generated
    app-side at write time. The code never rotates: the upsert's ON CONFLICT
    ``DO UPDATE`` set-clause leaves ``referral_code`` untouched, so a re-auth
    that collides on ``apple_sub`` preserves the user's original code.

    Uniqueness is enforced by the DB ``uq_users_referral_code`` constraint;
    the (astronomically unlikely) collision is handled by the auth router's
    bounded INSERT retry, not here.
    """
    return secrets.token_urlsafe(REFERRAL_CODE_NBYTES)


class User(Base):
    """Self-managed Apple Sign In user row (Phase 4.3 first identity table).

    # Column-by-column contract

    Every column below maps 1:1 to a row in the Phase 4.3 Sub-AC 1; the
    companion unit test introspects the SQLAlchemy ``__table__`` to
    verify types, nullability, defaults, and the ``apple_sub`` unique
    constraint without touching the database. Deviating types or default
    spellings breaks that test.

    # Identity invariants

        * ``id``         — backend-side primary key; the only identifier
                           that downstream tables foreign-key into.
        * ``apple_sub``  — Apple's stable opaque ``sub`` claim; the only
                           column the sign-in upsert keys on.

    Backend-issued JWTs carry ``sub = users.id`` (not ``apple_sub``) so
    the upstream Apple identifier never leaves the auth layer.
    """

    __tablename__ = USERS_TABLE_NAME

    # ----- id: uuid primary key, generated app-side via uuid4 -----
    # ``as_uuid=True`` makes the asyncpg driver hand back ``uuid.UUID``
    # objects so callers do not need to coerce strings. No
    # ``server_default`` on purpose — the Seed pins UUID generation to
    # the application (uuid4) so the schema stays extension-free, matching
    # the precedent from :class:`api.db.models.event.Event`.
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        nullable=False,
    )

    # ----- apple_sub: Apple's stable opaque sub claim, UNIQUE -----
    # Stored as ``text`` (PostgreSQL ``TEXT`` has no length cap and the
    # planner treats it identically to ``VARCHAR`` without a length
    # constraint). The UNIQUE constraint is declared via
    # ``__table_args__`` below so the named constraint identifier
    # (``uq_users_apple_sub``) is stable across alembic regeneration —
    # the sign-in upsert references it by name in the
    # ``INSERT ... ON CONFLICT ON CONSTRAINT`` clause.
    apple_sub: Mapped[str] = mapped_column(
        String,
        nullable=False,
    )

    # ----- email: user's email claim, nullable, NOT unique -----
    # Apple Sign In allows private-relay emails that can differ across
    # re-installs; indexing this UNIQUE would corrupt the upsert (see
    # the module docstring for the full rationale). Nullable because
    # the Apple JWT ``email`` claim is optional once the user has opted
    # out of email sharing on a subsequent auth.
    email: Mapped[str | None] = mapped_column(
        String,
        nullable=True,
    )

    # ----- email_verified: Apple-asserted verification flag -----
    # ``server_default=text("false")`` is not used here because
    # SQLAlchemy emits ``Boolean.default=False`` as the literal ``false``
    # in the CREATE TABLE DDL produced by alembic autogenerate, and the
    # Phase 4.3 migration spells the default verbatim. The Python-side
    # ``default=False`` fires when an ORM-level INSERT omits the column.
    email_verified: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default=func.false(),
    )

    # ----- display_name: nullable label from Apple's first-auth payload -----
    # Apple only ships ``full_name`` on the first authorization for a
    # device/app pair; subsequent re-auths return None. The sign-in
    # upsert MUST use ``COALESCE`` to preserve the existing value when
    # the incoming payload has no ``full_name``. Enforced at the router
    # layer, not by the column declaration.
    display_name: Mapped[str | None] = mapped_column(
        String,
        nullable=True,
    )

    # ----- created_at: insertion timestamp, server-side default now() -----
    # ``func.now()`` resolves to PostgreSQL ``NOW()`` (a.k.a.
    # ``CURRENT_TIMESTAMP``). Setting the default at the database layer
    # guarantees the column is populated even if a future code path
    # (e.g., raw SQL backfill) inserts without specifying it.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    # ----- updated_at: bump-on-update timestamp, ORM-level onupdate -----
    # ``server_default=func.now()`` fires on INSERT; ``onupdate=func.now()``
    # is the ORM-level expression evaluated on every UPDATE that flows
    # through SQLAlchemy (``session.execute(update(User))...``,
    # ``user.email = "..."``, etc.). No database trigger is installed —
    # the Phase 4.3 Seed pins the bump to the ORM so the schema stays
    # portable and trigger-free.
    #
    # The atomic ``INSERT ... ON CONFLICT DO UPDATE`` in the auth router
    # will SET ``updated_at = NOW()`` explicitly in the conflict-target
    # SET clause so the bump survives the raw-SQL boundary that
    # ``onupdate=`` does not cover.
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    # ----- referral_code: per-user fixed 8-char URL-safe code (Phase 4.5) -----
    # The single source of truth for the server-assembled ``share_url``
    # (``REFERRAL_BASE_URL`` + this code). Generated app-side at INSERT via the
    # ``default=generate_referral_code`` callable (``secrets.token_urlsafe(6)``)
    # so every user — including those created through the auth router's
    # ``INSERT ... ON CONFLICT`` upsert, which omits the column — receives a
    # code without the handler having to spell it out. No ``server_default``:
    # generation is pinned to the application layer (matching the ``id`` /
    # ``apple_sub`` UUID precedent), keeping the schema extension-free.
    #
    # NOT NULL + UNIQUE (via the named ``uq_users_referral_code`` constraint in
    # ``__table_args__``): every user always has a sharable code and codes
    # never collide. The code is *fixed per user* — the upsert's ON CONFLICT
    # ``DO UPDATE`` clause leaves it untouched, so re-auth preserves the
    # original value. ``String(8)`` renders as ``VARCHAR(8)`` to match the
    # Seed-pinned width of a ``token_urlsafe(6)`` output.
    referral_code: Mapped[str] = mapped_column(
        String(REFERRAL_CODE_LENGTH),
        nullable=False,
        default=generate_referral_code,
    )

    # ----- referrer_user_id: self-referential nullable FK (Phase 4.5) -----
    # The user who referred this user, or NULL for organic / un-attributed
    # signups. Phase 4.5 attribution at Apple Sign In writes this column
    # exactly once (idempotent — an already-attributed referee is silently
    # skipped) when a valid, non-self referral code is presented.
    #
    # ``ON DELETE SET NULL`` mirrors the ``events.user_id`` convention: when
    # the referrer's row is deleted (GDPR right-to-delete in Phase 7+), the
    # referee row survives with ``referrer_user_id`` anonymized to NULL
    # rather than cascading the delete onto referred users.
    #
    # Nullable because the overwhelming majority of signups are organic; the
    # column is only populated when a deep-link-stashed referral code rides
    # along with the sign-in request and passes the application-level
    # self-referral + validity + idempotency checks.
    #
    # The FK is declared inline on the column (matching the
    # ``events.user_id`` pattern in :mod:`api.db.models.event`) rather than
    # in ``__table_args__`` so the single named UNIQUE constraint there stays
    # the only entry — the sign-in upsert's ON CONFLICT target is unchanged.
    referrer_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "users.id",
            ondelete="SET NULL",
            name=FK_USERS_REFERRER_USER_ID,
        ),
        nullable=True,
    )

    __table_args__ = (
        # Named UNIQUE constraint so the sign-in upsert can reference it
        # by name in ``INSERT ... ON CONFLICT ON CONSTRAINT
        # uq_users_apple_sub DO UPDATE`` — stable across autogenerate
        # runs and human-readable in psql ``\d users`` output.
        UniqueConstraint("apple_sub", name=UNIQUE_CONSTRAINT_APPLE_SUB),
        # Named UNIQUE constraint on the per-user referral code. Distinct
        # from the apple_sub constraint (which is the upsert's ON CONFLICT
        # target); this one guarantees referral codes never collide and lets
        # the auth router's bounded INSERT retry reference it by name.
        UniqueConstraint("referral_code", name=UNIQUE_CONSTRAINT_REFERRAL_CODE),
    )

    def __repr__(self) -> str:
        """Render a User without leaking PII (email, display_name).

        ``email`` and ``display_name`` are user-supplied PII that should
        never appear in logs verbatim. The repr surfaces only the
        primary key, ``apple_sub`` (which is an Apple-opaque identifier,
        not user-readable), and the ``email_verified`` boolean so
        debugging output stays useful without becoming a PII vector.
        """
        return (
            f"User(id={self.id!r}, apple_sub={self.apple_sub!r}, "
            f"email_verified={self.email_verified!r}, "
            f"created_at={self.created_at!r}, "
            f"updated_at={self.updated_at!r})"
        )
