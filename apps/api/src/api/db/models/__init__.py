"""SQLAlchemy declarative models for ``apps/api`` (Phase 4.2).

This sub-package owns every declarative ORM model used by the FastAPI app.
The Phase 4.1 Seed pins ``apps/api/src/api/db/`` as the single SQLAlchemy
import boundary; declarative models therefore live here (alongside
``engine.py``, ``session.py``, ``health.py`` and ``migrations/env.py``)
rather than in ``api.schemas`` or ``api.routers``.

# Why a sub-package?

A dedicated ``models/`` directory keeps the per-table file small (high
cohesion, low coupling) and gives Phase 4.3+ a stable home for the users
table without touching the events module. ``__init__`` re-exports the
shared :class:`Base` and every concrete model so the alembic ``env.py``
can keep a single import line:

    from api.db.models import Base
    target_metadata = Base.metadata

# Boundary contract

    * :class:`Base` is the sole :class:`~sqlalchemy.orm.DeclarativeBase` for
      the entire ``apps/api`` ORM. Phase 4.2 ships exactly one concrete
      subclass (:class:`Event`); Phase 4.3+ extends the registry without
      forking the metadata.
    * Importing this package does NOT touch the database — the
      :class:`Base.metadata` registry is built at import time but no engine
      is constructed and no DDL is emitted.
"""

from __future__ import annotations

from api.db.models.base import Base
from api.db.models.event import Event

# Public re-exports. Adding a new model in Phase 4.3+ MUST also append the
# model class name to this tuple so the import-side effect that populates
# ``Base.metadata`` runs before ``env.py`` queries it.
__all__ = ["Base", "Event"]
