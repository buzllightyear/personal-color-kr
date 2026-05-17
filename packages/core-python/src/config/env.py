"""Root-`.env` resolution and loading via `python-dotenv.find_dotenv()`.

# Why these helpers exist

The Seed Contract for the vendor-setup unit names a *single* source of
truth for all three vendor credentials (PostHog, Fal.ai, Superwall): the
`.env` file at the monorepo root. Two surfaces must agree on that file:

  * `apps/mobile/app.config.ts` — loaded by Expo at build/start time.
  * `packages/core-python/...`  — loaded by any Python entry point
    (notably `scripts/smoke_fal.py`).

If each Python script computes the path to `.env` independently
(`Path(__file__).parent / ".." / ".." / ".env"`, etc.) the resolution
drifts the moment a script is moved, copied, or invoked from a different
working directory. `python-dotenv.find_dotenv()` already implements the
correct algorithm — walk upwards from the caller (or current working
directory) until a `.env` is found — so the only piece worth owning here
is a *thin, well-documented, well-tested* wrapper that:

  1. Anchors the search at this module's location, not at the caller's
     `cwd`, so behaviour is reproducible regardless of where pytest or
     the smoke script is launched from.
  2. Returns explicit values (`None` / `False`) on miss instead of
     silently no-op'ing — callers that need a key absolutely must know
     when the file is unreachable.
  3. Exposes a `get_env(..., required=True)` helper so smoke scripts can
     fail fast with a precise error message (`'FAL_API_KEY' is not set
     in the root .env file at /abs/path/.env`) rather than the opaque
     `KeyError` you get from `os.environ[...]`.

# Boundary contract

  * `find_root_dotenv()` returns `None` if no `.env` is found anywhere
    above this module (e.g. a fresh checkout where the developer has
    not yet copied `.env.example`).
  * `load_root_dotenv()` is *idempotent* and *non-overriding* by
    default: values already present in `os.environ` (e.g. exported in
    CI) win over file values, matching `python-dotenv`'s own
    `override=False` semantics.
  * Neither helper raises on a missing `.env`. The "fail loudly" path is
    `get_env(name, required=True)`, which raises `LookupError` with the
    resolved path included in the message.

# Test isolation

These helpers MUST NOT auto-execute at import time — `load_root_dotenv()`
is only called by explicit consumers (smoke scripts, app bootstrap).
Auto-loading on import would pollute the global environment for the
existing 940-test pytest suite, which is exactly the failure mode the
Seed Contract's `test_isolation` evaluation principle calls out.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Final

from dotenv import find_dotenv, load_dotenv

# Anchor the search at this file rather than the caller's CWD so that the
# resolution is identical whether pytest, a smoke script, or an editor
# integration invokes us. `usecwd=False` is the default of `find_dotenv`,
# but spelling it out documents the intent.
_THIS_FILE: Final[Path] = Path(__file__).resolve()


def find_root_dotenv() -> str | None:
    """Return the absolute path to the monorepo root `.env`, or `None`.

    Wraps `python-dotenv.find_dotenv` with two clarifying behaviours:

      * Searches upward starting from *this module's directory* (stable
        across invocation contexts) rather than the process CWD.
      * Returns `None` instead of the empty string `""` that
        `find_dotenv` itself returns on miss, so callers can use the
        idiomatic `if path is None:` check.

    The function is side-effect free; it does not read or mutate
    `os.environ`. Use `load_root_dotenv()` to actually load values.
    """
    # `usecwd=False` (default) makes `find_dotenv` walk up from the
    # supplied filename's directory. We pass our own resolved path so
    # the search starts in `packages/core-python/src/config/` and walks
    # toward the repo root, finding the canonical `.env`.
    resolved = find_dotenv(filename=".env", usecwd=False)
    if not resolved:
        # `find_dotenv` returns `""` when no match is found. Convert to
        # `None` so callers can `if find_root_dotenv() is None:` rather
        # than the easier-to-miss `if not resolved:`.
        return None
    # `find_dotenv` may return a path relative to CWD; resolve to abs
    # so downstream consumers (smoke scripts that `chdir` around) get a
    # stable, reproducible path.
    return str(Path(resolved).resolve())


def load_root_dotenv(*, override: bool = False) -> bool:
    """Locate and load the root `.env` into `os.environ`.

    Returns `True` if a `.env` file was found and processed (even if it
    was empty) and `False` if no file was discovered. Mirrors the
    return-shape of `python-dotenv.load_dotenv` for callers that already
    know that API.

    Args:
        override: When `True`, file values overwrite pre-existing
            `os.environ` entries. The default (`False`) matches CI
            conventions where exported variables win over committed
            files — which is the right call for credential rotation:
            an operator can `export FAL_API_KEY=...` for a one-off run
            without editing `.env`.

    This function is intentionally *not* called at import time. Each
    consumer (a smoke script, an app bootstrap, a CLI) must opt in
    explicitly so the existing 940-test pytest suite is not exposed to
    credential side effects.
    """
    dotenv_path = find_root_dotenv()
    if dotenv_path is None:
        return False
    # `load_dotenv` returns True on a successful read. Explicitly forward
    # that signal so callers can log "loaded from /abs/path/.env" with
    # full confidence the load actually happened.
    return load_dotenv(dotenv_path=dotenv_path, override=override)


def get_env(
    name: str,
    default: str | None = None,
    *,
    required: bool = False,
) -> str | None:
    """Read an environment variable with explicit `required` semantics.

    Args:
        name: The environment variable name (e.g. `"FAL_API_KEY"`).
        default: Value returned when the variable is unset *and*
            `required=False`. Ignored when `required=True`.
        required: When `True`, raise `LookupError` if the variable is
            unset or empty. The error message includes the resolved
            root `.env` path so the operator knows exactly which file
            to edit.

    Returns:
        The string value of the environment variable, or `default` when
        the variable is unset/empty and `required=False`.

    Raises:
        LookupError: When `required=True` and the variable is unset or
            empty. This is intentionally a `LookupError` (and not
            `KeyError`) so smoke scripts can `except LookupError:`
            without accidentally catching `dict`-level `KeyError`s
            coming from unrelated code paths.
    """
    value = os.environ.get(name)
    # Treat empty strings as "unset" for credential variables. A stray
    # `FAL_API_KEY=` line in `.env` should fail the `required` check
    # instead of silently passing along an empty key to the vendor SDK.
    if value is None or value == "":
        if required:
            resolved = find_root_dotenv()
            location = resolved if resolved is not None else "<no .env found>"
            raise LookupError(
                f"Environment variable {name!r} is not set. "
                f"Expected to find it in the root .env file at {location}. "
                f"See .env.example for the canonical template."
            )
        return default
    return value
