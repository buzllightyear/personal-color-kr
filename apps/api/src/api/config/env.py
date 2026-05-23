"""Root-`.env` resolution and ``DATABASE_URL`` access for apps/api (Phase 4.1).

# Why this module exists

The Phase 1.2 convention (already in use by ``packages/core-python/src/config/env.py``)
is "single root ``.env`` resolved via ``python-dotenv.find_dotenv()``". Two
surfaces inside apps/api need that file:

    * ``api.db.engine.get_engine`` — must read ``DATABASE_URL`` to build the
      SQLAlchemy 2.0 ``AsyncEngine`` used by ``GET /v1/db-health``.
    * Future Alembic ``env.py`` (Sub-AC pending) — must read ``DATABASE_URL``
      so ``alembic -c apps/api/alembic.ini upgrade head`` resolves the same
      URL as the running FastAPI app.

Rather than duplicating the ``find_dotenv`` boilerplate inside each surface
(which is the failure mode the Phase 1.2 Seed explicitly calls out), this
module owns *one* idempotent loader and a thin ``get_database_url`` accessor.

# Boundary contract

    * :func:`get_database_url` returns the value of ``os.environ["DATABASE_URL"]``
      (after loading the root ``.env`` once per process), or ``None`` if the
      variable is unset or empty.
    * The loader does **not** override pre-existing env vars: an exported
      ``DATABASE_URL`` (CI, integration tests using ``monkeypatch.setenv``)
      always wins over the file value. This matches ``python-dotenv``'s
      ``override=False`` semantics and the convention already pinned by
      ``packages/core-python/src/config/env.py``.
    * No secrets appear in error messages. The variable name is included in
      ``LookupError`` text; the value is not.

# Test isolation

Loading is gated by a module-level ``_dotenv_loaded`` flag so the file is
read at most once per process. Tests that need to swap ``DATABASE_URL``
between cases should use ``monkeypatch.setenv`` (which mutates
``os.environ`` directly and bypasses the file entirely).
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Final

from dotenv import find_dotenv, load_dotenv

# Anchor the search at this module's path so the upward walk for ``.env``
# is identical regardless of where pytest / uvicorn was invoked from.
# Mirrors the precedent in ``packages/core-python/src/config/env.py``.
_THIS_FILE: Final[Path] = Path(__file__).resolve()

# Process-wide flag so the file is read at most once. Setting it before the
# load attempt (rather than after) is intentional: even when ``find_dotenv``
# returns no path (fresh checkout), we don't want to re-walk the tree on
# every ``get_database_url`` call.
_dotenv_loaded: bool = False


def _load_root_dotenv_once() -> None:
    """Locate and load the monorepo-root ``.env`` (idempotent, no-override).

    Mirrors ``packages/core-python/src/config/env.py:load_root_dotenv`` but
    with two simplifications appropriate for apps/api:

        1. The function is private (``_``-prefixed) — apps/api consumers go
           through :func:`get_database_url`, which calls this loader.
        2. ``override=False`` is the only behavior exposed. Apps/api never
           needs to overwrite an exported env var, because the integration
           test path uses ``monkeypatch.setenv`` (which sets the var in
           ``os.environ`` directly, *before* this loader runs).
    """
    global _dotenv_loaded
    if _dotenv_loaded:
        return
    # Set the flag *before* the load attempt: even when ``find_dotenv``
    # returns ``""`` (no file found) we want to avoid re-walking on every
    # subsequent call. The flag is a no-op-once guard, not a success guard.
    _dotenv_loaded = True
    # ``usecwd=False`` (default) walks upward from this file's directory,
    # not from ``os.getcwd``, so the resolution is stable across pytest
    # invocation contexts and uvicorn working directories.
    dotenv_path = find_dotenv(filename=".env", usecwd=False)
    if not dotenv_path:
        return
    # ``override=False`` preserves CI-exported env vars and
    # ``monkeypatch.setenv`` values — which is exactly what the integration
    # test relies on to point apps/api at ``DATABASE_URL_TEST``.
    load_dotenv(dotenv_path=dotenv_path, override=False)


def get_database_url() -> str | None:
    """Return the SQLAlchemy URL for the FastAPI app, or ``None`` if unset.

    The expected format is ``postgresql+asyncpg://user:pass@host:5432/db``
    (Seed Phase 4.1 constraint). The function does **not** validate the
    URL's scheme or syntax — :func:`sqlalchemy.create_async_engine` reports
    a precise error if the URL is malformed, which is the appropriate
    failure surface (the engine layer is the single SQLAlchemy import
    boundary inside apps/api).

    Returns
    -------
    str | None
        The string value of ``os.environ["DATABASE_URL"]`` (after the root
        ``.env`` has been loaded once). ``None`` is returned when the
        variable is unset or empty so callers can short-circuit on a fresh
        checkout without the file present.
    """
    _load_root_dotenv_once()
    value = os.environ.get("DATABASE_URL")
    # Treat empty strings as "unset" so a stray ``DATABASE_URL=`` line in
    # ``.env`` doesn't propagate to ``create_async_engine`` and surface as
    # a confusing driver-level error.
    if value is None or value == "":
        return None
    return value
