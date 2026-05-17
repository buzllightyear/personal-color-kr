"""Root-`.env` configuration helpers for the `core-python` package.

The monorepo keeps all vendor credentials in a single `.env` file at the
repository root (see `/.env.example` for the canonical layout). Both the
mobile app (`apps/mobile/app.config.ts`) and every Python entry point in
this package must resolve to that *same* file, regardless of which
sub-directory the process happens to be invoked from.

The `config.env` module exposes the small, dependency-light helpers that
make this contract explicit:

  * `find_root_dotenv()` – locate the root `.env` via
    `python-dotenv.find_dotenv()`.
  * `load_root_dotenv()` – idempotently load that file into `os.environ`.
  * `get_env()`          – read a key with optional `required=True`
    semantics so smoke scripts (e.g. `scripts/smoke_fal.py`) can fail
    fast and clearly when a credential is missing.

This is a *separate* sub-package (mirroring the layout of `retention/`,
`funnel/`, etc.) so existing modules that do not need env access keep
their import graph clean and do not accidentally trigger `.env` loading
as a side effect of `import core_python`.
"""

from __future__ import annotations

from .env import (
    find_root_dotenv,
    get_env,
    load_root_dotenv,
)

__all__ = [
    "find_root_dotenv",
    "get_env",
    "load_root_dotenv",
]
