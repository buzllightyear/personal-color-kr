"""Server-side ``FAL_API_KEY`` loader for the Fal.ai vendor adapter (AC 19).

# Why this module exists

The Seed Contract pins ``FAL_API_KEY`` as a *server-side only* secret:

  * It MUST be read from the root ``.env`` (the monorepo's single source
    of truth for credentials).
  * It MUST never be hard-coded in source files.
  * It MUST never end up in the mobile bundle
    (``apps/mobile/src/config/vendor-keys.ts`` deliberately omits a
    ``falApiKey`` field).
  * It MUST never appear in log statements, exception messages, or any
    response payload reaching a caller.

Two surfaces already need this exact secret:

  1. ``packages/core-python/scripts/smoke_fal.py`` — the zero-cost auth
     probe that fails fast when ``.env`` is unpopulated.
  2. :class:`image_edit.FalAiVendorCaller` — the production adapter
     constructed via dependency injection by ``edit_image``.

Both surfaces use the *same* loader contract: walk up from the
``config.env`` module's directory until a ``.env`` is found
(``find_dotenv`` semantics), idempotently load it into ``os.environ``,
then read ``FAL_API_KEY`` with a precise error message when missing.

Encapsulating that contract in a small, well-tested helper means the
adapter never has to repeat the ``load_root_dotenv() + get_env(...)``
dance inline, and any future Phase 4 FastAPI bootstrap can reuse the
same function without re-discovering the resolution algorithm.

# Boundary contract

  * :func:`load_fal_api_key` is the single public entry point. It
    triggers an idempotent ``.env`` load (matching ``smoke_fal``'s
    behaviour) and returns the resolved ``FAL_API_KEY`` string.
  * Missing or empty values raise :class:`LookupError` — the same
    exception type :func:`config.env.get_env` uses — so callers can
    ``except LookupError:`` uniformly across both surfaces.
  * The function is **side-effect free with respect to its return
    value**: it never logs, never prints, and never stores the key
    in module-level state. The only mutation is the ``os.environ``
    update performed by ``load_root_dotenv`` itself, which is
    intentionally non-overriding (CI-exported variables win over file
    values).
  * The function is **safe under concurrent invocation**: ``os.environ``
    reads are atomic in CPython and ``load_root_dotenv`` is idempotent,
    so calling :func:`load_fal_api_key` from multiple threads cannot
    corrupt shared state.

# Security posture

  * The key never appears in any string formatted by this module.
  * No exception raised here embeds the key value (only the variable
    *name* and the resolved ``.env`` *path*, both of which are safe
    to surface to operators).
  * No ``print``, no ``logging`` call — the module is silent by design
    so DEBUG-level log statements added later (per the Seed Contract's
    observability principle) cannot accidentally embed the secret.

# Test isolation

The function does NOT auto-execute at import time. Each caller must
opt in explicitly (mirroring the design of :func:`config.env.load_root_dotenv`),
so the 940-test pytest suite is never exposed to credential side
effects from a stray ``import image_edit.fal_ai_api_key``.
"""

from __future__ import annotations

from typing import Final

from config.env import get_env, load_root_dotenv

#: The single environment variable name this module is responsible for.
#:
#: Exposed as a module-level ``Final`` constant — rather than inlined as a
#: string literal — so tests can reference the same identifier the
#: production code uses, and a future rename (extremely unlikely, but
#: possible) only needs one edit site.
FAL_API_KEY_ENV_VAR: Final[str] = "FAL_API_KEY"


def load_fal_api_key() -> str:
    """Resolve ``FAL_API_KEY`` from the root ``.env`` (or the process env).

    The resolution order matches :mod:`config.env`'s documented contract:

      1. Idempotently load the root ``.env`` via
         :func:`config.env.load_root_dotenv` (``override=False``, so any
         value already exported in ``os.environ`` — e.g. by CI or
         ``direnv`` — wins over the committed file value). The load is a
         no-op when the ``.env`` is unreachable (fresh checkout, missing
         file): the next step's ``required=True`` check is then the
         single fail-fast site.
      2. Read ``FAL_API_KEY`` via :func:`config.env.get_env` with
         ``required=True`` so a missing or empty value raises
         :class:`LookupError` with a precise message containing the
         resolved ``.env`` path (or ``<no .env found>`` when no file
         exists). The error message intentionally never embeds the
         (missing/empty) value itself.

    Returns:
        The non-empty ``FAL_API_KEY`` string. The value is *not* parsed
        or validated for format (Fal.ai keys are documented as
        ``<key_id>:<key_secret>`` pairs, but the adapter and the
        smoke script handle format checks separately — this loader is
        intentionally narrow).

    Raises:
        LookupError: When ``FAL_API_KEY`` is unset or empty. The error
            message includes the resolved ``.env`` path so the operator
            knows exactly which file to edit. The key value itself is
            never embedded in the exception (it cannot be — the value
            is missing by construction in this code path).

    Thread safety:
        Safe to call concurrently from multiple threads. ``os.environ``
        reads are atomic in CPython and :func:`load_root_dotenv` is
        idempotent.

    Side effects:
        * May populate ``os.environ`` from the root ``.env`` (idempotent,
          non-overriding). This is the documented behaviour of
          :func:`config.env.load_root_dotenv`.
        * Does NOT log, print, or otherwise surface the key value.
    """
    # Step 1: best-effort load of the root `.env`. The return value is
    # intentionally ignored — a missing file is fine here because the
    # operator may have exported `FAL_API_KEY` directly (CI secret, a
    # `direnv` block, an editor integration). The fatal-on-missing path
    # is `get_env(required=True)` below, which raises with a precise
    # message including the resolved `.env` path.
    load_root_dotenv()

    # Step 2: read the key with required=True so we fail fast with a
    # location-tagged error message instead of returning `None` and
    # letting the adapter's HTTP layer surface an opaque 401.
    api_key = get_env(FAL_API_KEY_ENV_VAR, required=True)

    # `get_env(required=True)` guarantees a non-empty string on the happy
    # path. This assertion narrows `str | None` → `str` for mypy without
    # adding a runtime cost worth measuring (a single `is not None` check).
    assert api_key is not None and api_key != ""
    return api_key


__all__ = [
    "FAL_API_KEY_ENV_VAR",
    "load_fal_api_key",
]
