"""HTTP route definitions for the apps/api FastAPI workspace (Phase 4.1).

This package groups the three `/v1/` routers exposed by Phase 4.1:

    - ``api.routers.health``    — `GET /v1/health`, `GET /v1/db-health`.
    - ``api.routers.diagnose``  — `POST /v1/diagnose`.

The routers are mounted onto the FastAPI app inside ``api.main.create_app``
under the single ``/v1`` prefix. There are no flat-prefix duplicates and no
other routes in Phase 4.1.
"""

__all__: list[str] = []
