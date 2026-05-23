"""Shared SQLAlchemy 2.0 declarative base for ``apps/api`` models.

The :class:`Base` class below is the sole :class:`DeclarativeBase` for
every ORM model in the FastAPI workspace. Phase 4.2 ships exactly one
concrete subclass (:class:`api.db.models.event.Event`); Phase 4.3+ will
add additional tables (e.g. ``users``) against the same registry so a
single ``alembic upgrade head`` keeps the entire schema in lockstep.

# Why a dedicated module?

Co-locating the declarative base with the first concrete model
(``event.py``) would create a circular import the moment a second model
needs to inherit from the same base. Splitting :class:`Base` into its own
module keeps the dependency graph one-way:

    api.db.models.base   <-- api.db.models.event
                         <-- api.db.models.<future_model>

The alembic ``env.py`` module imports :class:`Base` (via the
``api.db.models`` package re-export) and reads ``Base.metadata`` to drive
autogeneration. The single shared ``MetaData`` instance guarantees every
model lands in the same alembic migration chain.
"""

from __future__ import annotations

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Shared declarative base for every ``apps/api`` ORM model.

    The class body is intentionally empty — Phase 4.2 does not require a
    naming convention, a per-column default, or a base mixin. The Seed's
    schema spec is small enough (6 columns on a single table) that adding
    machinery here would be premature. Phase 4.3+ can attach a
    :class:`~sqlalchemy.MetaData` ``naming_convention`` dict if/when
    multi-table constraint naming becomes load-bearing.
    """
