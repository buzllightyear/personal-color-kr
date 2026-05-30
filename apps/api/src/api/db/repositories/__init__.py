"""Repository layer for the apps/api persistence boundary (Phase 4.4).

A *repository* is the sole SQL access surface for one table. It lives
inside ``apps/api/src/api/db/`` so its ``from api.db.session import ...``
re-export usage stays within the single SQLAlchemy import boundary
(AC11). Routers and services depend on the repository's typed function
surface — they never build SQL or touch the ORM model directly.

Phase 4.4 ships :mod:`api.db.repositories.events_repository`, the single
read/write boundary for the ``events`` table.
"""

__all__: list[str] = []
