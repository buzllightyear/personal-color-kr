"""Alembic migration package for ``apps/api`` (Phase 4.1).

This package is the SINGLE Alembic boundary in the repository:
    - ``env.py``         — async SQLAlchemy engine wiring + target metadata.
    - ``script.py.mako`` — migration file template.
    - ``versions/``      — migration revision files (empty baseline + Phase 4.2+).

The ``apps/api/alembic.ini`` ``script_location = src/api/db/migrations`` points
here. The ``prepend_sys_path = src`` directive lets ``env.py`` import the
sibling ``api.*`` modules (e.g. future ``api.config.env``) without polluting
``sys.path`` in production processes.
"""

from __future__ import annotations
