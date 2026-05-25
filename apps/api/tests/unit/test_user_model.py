"""Unit tests for :class:`api.db.models.user.User` (Phase 4.3 Sub-AC 1).

Acceptance criterion covered
----------------------------
**Sub-AC 1** — Define User SQLAlchemy ORM model in ``apps/api`` with the
seven columns spelled out in the Phase 4.3 Seed. The unit test:

    1. Instantiates the model without touching the database.
    2. Asserts column types match the Seed contract (UUID PK, TEXT,
       BOOLEAN, TIMESTAMPTZ).
    3. Asserts nullability per column.
    4. Asserts the ``email_verified`` boolean default is ``False`` and
       the timestamp columns ship a ``server_default=now()``.
    5. Asserts the UNIQUE constraint exists on ``apple_sub`` with the
       stable, named identifier the Phase 4.3 sign-in upsert depends on.
    6. Asserts ``updated_at`` carries an ORM-level ``onupdate=now()``.

Scope discipline
----------------
* No database I/O. ``__tablename__``, ``__table__.columns``, and
  ``__table_args__`` are introspectable at class-definition time —
  SQLAlchemy populates them when the module is imported. The
  companion integration test (Phase 4.3 Sub-AC 8) will perform the
  real round-trip against Postgres 16; here we only pin the static
  ORM contract.
* No mocks. :class:`User` is a plain :class:`DeclarativeBase` subclass.
* No assertions about migration DDL — that is owned by the Phase 4.3
  alembic migration test, not this file.

Why introspect ``Table`` directly instead of constructing a real session?
------------------------------------------------------------------------
The Seed pins the column shape (types, nullability, defaults, the
``apple_sub`` UNIQUE constraint, and the ``onupdate`` on ``updated_at``)
as the ORM contract. Those properties live on the
:class:`~sqlalchemy.Table` metadata, which is built at import time and
does not need a database connection. Hitting Postgres for these checks
would be slower, would self-skip when the docker-compose Postgres is not
running, and would couple two acceptance criteria (model definition +
migration applied) that should fail independently.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import Boolean, DateTime, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql.elements import ColumnElement
from sqlalchemy.sql.functions import Function

from api.db.models.user import (
    UNIQUE_CONSTRAINT_APPLE_SUB,
    USERS_TABLE_NAME,
    User,
)


# ---------------------------------------------------------------------------
# Identity + tablename — every other assertion below depends on these.
# ---------------------------------------------------------------------------
@pytest.mark.unit
def test_user_tablename_is_users_string_literal() -> None:
    """The model maps to the string literal ``"users"`` (matches the Seed)."""
    assert User.__tablename__ == "users"
    # The exported constant matches so the migration file can reference
    # the same identifier without importing the ORM class.
    assert USERS_TABLE_NAME == "users"


# ---------------------------------------------------------------------------
# Column 1 — id: UUID PK, app-side uuid4 default, NOT NULL, no server_default
# ---------------------------------------------------------------------------
@pytest.mark.unit
def test_user_id_column_is_uuid_primary_key_with_uuid4_default() -> None:
    """``id`` is ``UUID(as_uuid=True)``, primary key, ``default=uuid.uuid4``."""
    column = User.__table__.c.id

    assert isinstance(
        column.type, UUID
    ), f"User.id must be PostgreSQL UUID; got {type(column.type)!r}."
    # ``as_uuid=True`` is what makes the driver return ``uuid.UUID`` rather
    # than strings — the integration round-trip test pins the same flag.
    assert column.type.as_uuid is True, "User.id must use as_uuid=True."

    assert column.primary_key is True, "User.id must be the primary key."
    assert column.nullable is False, "Primary key cannot be nullable."

    # ``default`` is the Python-side ``uuid.uuid4`` callable (matches the
    # Event model precedent). No ``server_default`` so the schema stays
    # extension-free.
    assert column.default is not None, "User.id must declare default=uuid.uuid4."
    # SQLAlchemy stores the callable on ``ColumnDefault.arg``. Even though
    # the runtime invocation path wraps zero-arg callables to be
    # ``ctx``-aware, ``.arg`` itself surfaces the original function so we
    # can pin its identity by qualified module + name. Identity (``is``)
    # comparison is unreliable across some import paths so the
    # ``__module__`` / ``__name__`` pair is the robust contract.
    default_callable = column.default.arg
    assert callable(
        default_callable
    ), f"User.id default must be a callable; got {default_callable!r}."
    assert default_callable.__module__ == "uuid", (
        f"User.id default must come from the stdlib ``uuid`` module; got "
        f"{default_callable.__module__!r}."
    )
    assert default_callable.__name__ == "uuid4", (
        f"User.id default must be the ``uuid4`` function; got "
        f"{default_callable.__name__!r}."
    )
    # ``is_callable=True`` confirms SQLAlchemy treats this default as a
    # Python-side callable (not a SQL expression or scalar literal) —
    # which is what the alembic autogenerator does NOT emit into the DDL
    # so the schema stays extension-free.
    assert (
        column.default.is_callable is True
    ), "User.id default must be a Python-side callable, not a scalar/SQL."
    assert column.server_default is None, (
        "User.id must NOT carry a server_default; the Phase 4.3 Seed pins "
        "UUID generation to the application layer."
    )


# ---------------------------------------------------------------------------
# Column 2 — apple_sub: TEXT NOT NULL, UNIQUE via named constraint
# ---------------------------------------------------------------------------
@pytest.mark.unit
def test_user_apple_sub_column_is_text_not_null() -> None:
    """``apple_sub`` is ``String`` (TEXT) and ``NOT NULL``."""
    column = User.__table__.c.apple_sub

    assert isinstance(
        column.type, String
    ), f"User.apple_sub must be String/TEXT; got {type(column.type)!r}."
    assert column.nullable is False, "User.apple_sub must be NOT NULL."
    assert column.default is None, "User.apple_sub has no Python-side default."
    assert column.server_default is None, "User.apple_sub has no server default."


@pytest.mark.unit
def test_user_apple_sub_has_named_unique_constraint() -> None:
    """The named UNIQUE constraint exists exactly once on ``apple_sub``."""
    unique_constraints = [
        constraint
        for constraint in User.__table__.constraints
        if isinstance(constraint, UniqueConstraint)
    ]
    assert len(unique_constraints) == 1, (
        f"User table must declare exactly one UNIQUE constraint "
        f"(on apple_sub); got {len(unique_constraints)}: "
        f"{[c.name for c in unique_constraints]!r}."
    )

    constraint = unique_constraints[0]
    assert constraint.name == UNIQUE_CONSTRAINT_APPLE_SUB == "uq_users_apple_sub", (
        f"UNIQUE constraint name drift: expected 'uq_users_apple_sub', "
        f"got {constraint.name!r}."
    )

    # The constraint must cover exactly the ``apple_sub`` column —
    # adding columns would change the upsert conflict target and break
    # the ON CONFLICT clause in the sign-in router.
    column_names = [column.name for column in constraint.columns]
    assert column_names == [
        "apple_sub"
    ], f"UNIQUE constraint must cover only apple_sub; got {column_names!r}."


# ---------------------------------------------------------------------------
# Column 3 — email: TEXT NULL, no default, NOT unique
# ---------------------------------------------------------------------------
@pytest.mark.unit
def test_user_email_column_is_nullable_text_with_no_default() -> None:
    """``email`` is nullable ``String`` (TEXT) with no Python/server default."""
    column = User.__table__.c.email

    assert isinstance(
        column.type, String
    ), f"User.email must be String/TEXT; got {type(column.type)!r}."
    assert column.nullable is True, (
        "User.email must be nullable — Apple Sign In may omit the email "
        "claim on re-auth."
    )
    assert column.default is None, "User.email has no Python-side default."
    assert column.server_default is None, "User.email has no server default."
    # email is intentionally NOT in the UNIQUE constraint set — re-relayed
    # private addresses would otherwise corrupt the upsert.
    assert column.unique is None or column.unique is False, (
        "User.email MUST NOT be UNIQUE — Apple private-relay addresses can "
        "differ across re-installs."
    )


# ---------------------------------------------------------------------------
# Column 4 — email_verified: BOOLEAN NOT NULL DEFAULT FALSE
# ---------------------------------------------------------------------------
@pytest.mark.unit
def test_user_email_verified_column_is_boolean_not_null_default_false() -> None:
    """``email_verified`` is BOOLEAN NOT NULL with default FALSE."""
    column = User.__table__.c.email_verified

    assert isinstance(
        column.type, Boolean
    ), f"User.email_verified must be Boolean; got {type(column.type)!r}."
    assert column.nullable is False, "User.email_verified must be NOT NULL."

    # Python-side default — fires when ORM INSERT omits the column.
    assert (
        column.default is not None
    ), "User.email_verified must declare a Python-side default=False."
    assert column.default.arg is False, (
        f"User.email_verified Python-side default must be ``False``; "
        f"got {column.default.arg!r}."
    )

    # Server-side default — fires for any INSERT that does not pass the
    # column (e.g., a raw SQL backfill that bypasses the ORM).
    assert (
        column.server_default is not None
    ), "User.email_verified must declare a server_default=false()."


# ---------------------------------------------------------------------------
# Column 5 — display_name: TEXT NULL, no default
# ---------------------------------------------------------------------------
@pytest.mark.unit
def test_user_display_name_column_is_nullable_text_with_no_default() -> None:
    """``display_name`` is nullable ``String`` (TEXT) with no default."""
    column = User.__table__.c.display_name

    assert isinstance(
        column.type, String
    ), f"User.display_name must be String/TEXT; got {type(column.type)!r}."
    assert column.nullable is True, (
        "User.display_name must be nullable — Apple Sign In only sends "
        "full_name on the first authorization."
    )
    assert column.default is None, "User.display_name has no Python-side default."
    assert column.server_default is None, (
        "User.display_name has no server default; the upsert's COALESCE "
        "rule preserves the existing value on re-auth."
    )


# ---------------------------------------------------------------------------
# Column 6 — created_at: TIMESTAMPTZ NOT NULL server_default now()
# ---------------------------------------------------------------------------
@pytest.mark.unit
def test_user_created_at_column_is_timestamptz_not_null_server_default_now() -> None:
    """``created_at`` is TIMESTAMPTZ NOT NULL with ``server_default=now()``."""
    column = User.__table__.c.created_at

    assert isinstance(
        column.type, DateTime
    ), f"User.created_at must be DateTime; got {type(column.type)!r}."
    assert (
        column.type.timezone is True
    ), "User.created_at must be timezone-aware (TIMESTAMPTZ)."
    assert column.nullable is False, "User.created_at must be NOT NULL."
    assert (
        column.server_default is not None
    ), "User.created_at must declare a server_default (now())."
    # ``server_default`` wraps the expression in a ``DefaultClause``. The
    # underlying expression must be a SQL function (``now()``) — the
    # check below pins the spelling to ``func.now()`` rather than a raw
    # text literal.
    server_default_expr = column.server_default.arg
    assert isinstance(server_default_expr, (Function, ColumnElement)), (
        f"User.created_at server_default must be a SQL function expression; "
        f"got {type(server_default_expr)!r}."
    )
    # SQLAlchemy stringifies ``func.now()`` to ``"now()"`` (case-insensitive).
    rendered = str(server_default_expr).lower()
    assert rendered == "now()", (
        f"User.created_at server_default must render as 'now()'; got " f"{rendered!r}."
    )

    # ``onupdate`` is intentionally NOT set on created_at — that is what
    # distinguishes it from ``updated_at`` below.
    assert (
        column.onupdate is None
    ), "User.created_at must NOT declare onupdate — only updated_at bumps."


# ---------------------------------------------------------------------------
# Column 7 — updated_at: TIMESTAMPTZ NOT NULL server_default now() + onupdate
# ---------------------------------------------------------------------------
@pytest.mark.unit
def test_user_updated_at_column_is_timestamptz_not_null_with_onupdate_now() -> None:
    """``updated_at`` declares ``server_default=now()`` AND ``onupdate=now()``."""
    column = User.__table__.c.updated_at

    assert isinstance(
        column.type, DateTime
    ), f"User.updated_at must be DateTime; got {type(column.type)!r}."
    assert (
        column.type.timezone is True
    ), "User.updated_at must be timezone-aware (TIMESTAMPTZ)."
    assert column.nullable is False, "User.updated_at must be NOT NULL."

    # server_default — fires on INSERT.
    assert (
        column.server_default is not None
    ), "User.updated_at must declare a server_default (now())."
    server_default_expr = column.server_default.arg
    rendered_server_default = str(server_default_expr).lower()
    assert rendered_server_default == "now()", (
        f"User.updated_at server_default must render as 'now()'; got "
        f"{rendered_server_default!r}."
    )

    # onupdate — fires on UPDATE through the ORM. THIS is the Phase 4.3
    # invariant the Seed pins explicitly: re-auth must bump updated_at
    # via SQLAlchemy onupdate, not via a database trigger.
    assert column.onupdate is not None, (
        "User.updated_at MUST declare onupdate=func.now() — Phase 4.3 "
        "Sub-AC 1 pins the bump to ORM level, not a DB trigger."
    )
    onupdate_expr = column.onupdate.arg
    rendered_onupdate = str(onupdate_expr).lower()
    assert rendered_onupdate == "now()", (
        f"User.updated_at onupdate must render as 'now()'; got "
        f"{rendered_onupdate!r}."
    )


# ---------------------------------------------------------------------------
# Instantiation smoke test — Sub-AC 1 explicitly requires the unit test
# to **instantiate** the model (not just introspect Table metadata).
# ---------------------------------------------------------------------------
@pytest.mark.unit
def test_user_can_be_instantiated_in_memory_without_database() -> None:
    """A transient :class:`User` constructs without a session/engine.

    :class:`User` is a plain :class:`DeclarativeBase` subclass. Instances
    can be built and attribute-assigned without any SQLAlchemy session,
    which is what callers need before they ``session.add(user)``.
    """
    fixed_id = uuid.UUID("00000000-0000-0000-0000-000000000001")
    now = datetime(2026, 5, 25, 12, 0, 0, tzinfo=timezone.utc)

    user = User(
        id=fixed_id,
        apple_sub="apple-sub-fixture-001",
        email="user@example.com",
        email_verified=True,
        display_name="Test User",
        created_at=now,
        updated_at=now,
    )

    assert user.id == fixed_id
    assert user.apple_sub == "apple-sub-fixture-001"
    assert user.email == "user@example.com"
    assert user.email_verified is True
    assert user.display_name == "Test User"
    assert user.created_at == now
    assert user.updated_at == now


@pytest.mark.unit
def test_user_repr_redacts_email_and_display_name() -> None:
    """``repr(user)`` must not leak PII (email, display_name).

    PII safety contract: the repr surfaces only the primary key,
    Apple-opaque ``sub`` claim, the verification boolean, and timestamps.
    """
    user = User(
        id=uuid.UUID("00000000-0000-0000-0000-000000000002"),
        apple_sub="apple-sub-fixture-002",
        email="secret@example.com",
        email_verified=False,
        display_name="Secret Name",
        created_at=datetime(2026, 5, 25, 12, 0, 0, tzinfo=timezone.utc),
        updated_at=datetime(2026, 5, 25, 12, 0, 0, tzinfo=timezone.utc),
    )

    rendered = repr(user)

    # Identity fields appear.
    assert "apple-sub-fixture-002" in rendered, rendered
    assert "email_verified=False" in rendered, rendered
    # PII does NOT appear.
    assert "secret@example.com" not in rendered, rendered
    assert "Secret Name" not in rendered, rendered
