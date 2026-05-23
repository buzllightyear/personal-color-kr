"""FastAPI ``Depends(...)``-injectable callables for the apps/api workspace.

This package groups the Phase 4.1 dependency seams — small, importable
functions / classes / coroutines that ``api.routers.*`` modules consume via
``fastapi.Depends`` so tests can override them through
``app.dependency_overrides`` without touching the production code path.

Phase 4.1 invariants honored by this package:
    - Zero ``sqlalchemy*`` imports outside ``api.db.*``.
    - Zero ``mediapipe`` / ``Pillow`` imports here — those boundaries live
      inside ``packages/core-python`` and are reached transitively only by
      the diagnose Depends provider (added in a later sub-AC).
    - Each dependency module is independently testable; the selfie
      validator (``api.dependencies.selfie_validation``) is unit-tested in
      isolation from the ``POST /v1/diagnose`` endpoint.
"""

__all__: list[str] = []
