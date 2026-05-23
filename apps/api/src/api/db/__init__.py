"""Single SQLAlchemy 2.0 async + Alembic import boundary for ``apps/api``.

Every ``sqlalchemy*`` import in the apps/api source tree lives under this
sub-package (`api.db.*`). The Phase 4.1 grep invariant — running
``grep -r 'sqlalchemy' apps/api/src/api --include='*.py'`` outside this
directory must return zero matches — is enforced by code review and the AC11
boundary test.

Modules:
    - ``api.db.health``     — async ``check_db_health(session)`` (SELECT 1).
    - ``api.db.engine``     — AsyncEngine factory (lazy, cached, disposable).
    - ``api.db.session``    — AsyncSession factory + ``get_session`` Depends.
    - ``api.db.migrations`` — Alembic ``env.py`` + ``versions/`` (later AC).
"""

from __future__ import annotations

from api.db.health import check_db_health

__all__ = ["check_db_health"]
