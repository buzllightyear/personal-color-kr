"""FastAPI HTTP surface for personal-color-kr (Phase 4.1).

Importable package: `api`. Sub-packages live under this root:
    - ``api.main``         — FastAPI app construction + router include + middleware.
    - ``api.routers``      — `/v1/` HTTP route definitions.
    - ``api.dependencies`` — Depends-injectable callables (diagnose, session).
    - ``api.db``           — Single SQLAlchemy 2.0 async + Alembic import boundary.
    - ``api.config``       — Phase 1.2 root `.env` loader via `find_dotenv()`.

Note: This package contains zero ``sqlalchemy*`` imports outside ``api.db.*``.
"""

__all__: list[str] = []
