"""Environment / configuration loading for the apps/api FastAPI workspace.

Phase 4.1 invariants:
    - The only ``.env`` consumed is the canonical monorepo-root ``.env``
      (Phase 1.2). Resolution is delegated to ``python-dotenv.find_dotenv``
      so the search behavior matches the precedent already used by
      ``packages/core-python/src/config/env.py``.
    - Loading is opt-in: helpers in :mod:`api.config.env` populate
      ``os.environ`` only when explicitly called. Importing this package
      has no side effects.
    - No secrets are logged. The helpers either return the env value or
      raise a ``LookupError`` whose message identifies the variable name
      and the resolved ``.env`` path — never the value.
"""

__all__: list[str] = []
