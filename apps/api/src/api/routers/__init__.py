"""HTTP route definitions for the apps/api FastAPI workspace.

This package groups the `/v1/` routers mounted by ``api.main.create_app``:

    - ``api.routers.health``    — `GET /v1/health`, `GET /v1/db-health`.
    - ``api.routers.version``   — `GET /v1/version`.
    - ``api.routers.auth``      — `POST /v1/auth/sign-in-with-apple` (Phase 4.3).
    - ``api.routers.diagnose``  — `POST /v1/diagnose`.
    - ``api.routers.events``    — `POST /v1/events` (Phase 4.4, authenticated).
    - ``api.routers.metrics``   — `GET /v1/metrics/retention` (Phase 4.4,
      authenticated, assembled from the events table).

The routers are mounted under the single ``/v1`` prefix. There are no
flat-prefix duplicates.
"""

__all__: list[str] = []
