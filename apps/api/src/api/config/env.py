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


# ---------------------------------------------------------------------------
# Phase 4.3 — auth-layer env vars (JWT_SECRET, APPLE_BUNDLE_ID)
# ---------------------------------------------------------------------------
# These two env vars are required at app startup; missing values raise
# at import / dependency-resolution time so the app fails fast in CI and
# in production rather than at the first authenticated request.


def get_jwt_secret() -> str | None:
    """Return ``JWT_SECRET`` from env, or ``None`` if unset or empty.

    The backend HS256 signing secret. Used by
    :func:`api.auth.backend_jwt.issue_backend_jwt` and
    :func:`api.auth.backend_jwt.verify_backend_jwt`. Empty strings count
    as "unset" so a stray ``JWT_SECRET=`` line in ``.env`` doesn't
    propagate to a broken signing call.
    """
    _load_root_dotenv_once()
    value = os.environ.get("JWT_SECRET")
    if value is None or value == "":
        return None
    return value


def require_jwt_secret() -> str:
    """Return ``JWT_SECRET`` or raise :class:`LookupError`.

    Convenience for surfaces (auth router, ``require_current_user``
    dependency) that cannot operate without the secret. The error
    message names the env var but NOT its value — secrets never appear
    in exception text.
    """
    value = get_jwt_secret()
    if value is None:
        raise LookupError(
            "JWT_SECRET is required for the auth layer. "
            "Set the env var in .env or the deployment environment."
        )
    return value


def get_apple_bundle_id() -> str | None:
    """Return ``APPLE_BUNDLE_ID`` from env, or ``None`` if unset/empty.

    The iOS app's bundle identifier. Used by
    :func:`api.auth.apple_verifier.verify_apple_id_token` to enforce
    the ``aud`` claim on Apple ID tokens.
    """
    _load_root_dotenv_once()
    value = os.environ.get("APPLE_BUNDLE_ID")
    if value is None or value == "":
        return None
    return value


def require_apple_bundle_id() -> str:
    """Return ``APPLE_BUNDLE_ID`` or raise :class:`LookupError`.

    Convenience for the auth router. The error message names the env
    var but not its value.
    """
    value = get_apple_bundle_id()
    if value is None:
        raise LookupError(
            "APPLE_BUNDLE_ID is required for the auth layer. "
            "Set the env var in .env or the deployment environment."
        )
    return value


# ---------------------------------------------------------------------------
# Phase 4.4 — PostHog Cohort API pull integration env vars
# ---------------------------------------------------------------------------
# The PostHog Cohort API pull layer (``api.posthog.posthog_cohort_client``)
# needs two server-side values to construct an authenticated request against
# PostHog's project-scoped cohorts endpoint:
#
#   * ``POSTHOG_PERSONAL_API_KEY`` — a Personal API Key (``phx_*`` format)
#     sent as a ``Bearer`` token. This is a *server-side* secret; it is
#     never exposed to the mobile client and never appears in any response
#     body or log line (the same secret-hygiene contract as JWT_SECRET).
#   * ``POSTHOG_PROJECT_ID`` — the numeric project identifier used to build
#     the ``/api/projects/{project_id}/cohorts/{cohort_id}`` URL path.
#
# Both follow the established fail-fast ``require_*`` convention: the
# ``get_*`` accessor returns ``None`` when unset/empty; the ``require_*``
# wrapper raises :class:`LookupError` (naming the var, never its value) so
# the pull layer fails fast rather than firing a malformed request.


def get_posthog_personal_api_key() -> str | None:
    """Return ``POSTHOG_PERSONAL_API_KEY`` from env, or ``None`` if unset/empty.

    The PostHog Personal API Key (``phx_*`` format) used as the ``Bearer``
    credential on the Cohort API pull request. Empty strings count as
    "unset" so a stray ``POSTHOG_PERSONAL_API_KEY=`` line in ``.env`` does
    not propagate a blank credential into the ``Authorization`` header.
    """
    _load_root_dotenv_once()
    value = os.environ.get("POSTHOG_PERSONAL_API_KEY")
    if value is None or value == "":
        return None
    return value


def require_posthog_personal_api_key() -> str:
    """Return ``POSTHOG_PERSONAL_API_KEY`` or raise :class:`LookupError`.

    Convenience for the PostHog cohort pull client. The error message
    names the env var but NOT its value — the key is a secret and never
    appears in exception text.
    """
    value = get_posthog_personal_api_key()
    if value is None:
        raise LookupError(
            "POSTHOG_PERSONAL_API_KEY is required for the PostHog cohort "
            "pull integration. Set the env var in .env or the deployment "
            "environment."
        )
    return value


# ---------------------------------------------------------------------------
# Phase 4.5 — referral share-URL base (REFERRAL_BASE_URL)
# ---------------------------------------------------------------------------
# The referral feature assembles a user's shareable URL **exclusively
# server-side** (Seed: single_source_of_truth). ``REFERRAL_BASE_URL`` is the
# origin/base the server combines with a user's ``referral_code`` to build the
# ``share_url`` returned by ``GET /v1/referrals/me`` and embedded in the
# sign-in response. The mobile client carries no ``REFERRAL_BASE_URL`` constant
# and never assembles the URL itself — it renders whatever ``share_url`` the
# server hands back.
#
# Follows the established fail-fast convention: the ``get_*`` accessor returns
# ``None`` when unset/empty; the ``require_*`` wrapper raises ``LookupError``
# (naming the var, never leaking a value) so the share-URL builder fails fast
# rather than emitting a malformed ``None/r/<code>`` URL.


def get_referral_base_url() -> str | None:
    """Return ``REFERRAL_BASE_URL`` from env, or ``None`` if unset/empty.

    The origin/base the server combines with a user's ``referral_code`` to
    assemble the ``share_url`` (e.g. ``https://pcolor.example``). Empty strings
    count as "unset" so a stray ``REFERRAL_BASE_URL=`` line in ``.env`` does
    not propagate a blank base into the share-URL builder.
    """
    _load_root_dotenv_once()
    value = os.environ.get("REFERRAL_BASE_URL")
    if value is None or value == "":
        return None
    return value


def require_referral_base_url() -> str:
    """Return ``REFERRAL_BASE_URL`` or raise :class:`LookupError`.

    Convenience for the share-URL builder / referrals router. The error
    message names the env var but not its value.
    """
    value = get_referral_base_url()
    if value is None:
        raise LookupError(
            "REFERRAL_BASE_URL is required to assemble referral share URLs. "
            "Set the env var in .env or the deployment environment."
        )
    return value


def get_posthog_project_id() -> str | None:
    """Return ``POSTHOG_PROJECT_ID`` from env, or ``None`` if unset/empty.

    The numeric PostHog project identifier used to build the cohort API
    URL path. Returned as the raw string value (not coerced to ``int``)
    so a malformed value surfaces at the HTTP layer rather than as an
    opaque ``ValueError`` during env resolution; the client validates the
    shape when it builds the URL.
    """
    _load_root_dotenv_once()
    value = os.environ.get("POSTHOG_PROJECT_ID")
    if value is None or value == "":
        return None
    return value


def require_posthog_project_id() -> str:
    """Return ``POSTHOG_PROJECT_ID`` or raise :class:`LookupError`.

    Convenience for the PostHog cohort pull client. The error message
    names the env var but not its value.
    """
    value = get_posthog_project_id()
    if value is None:
        raise LookupError(
            "POSTHOG_PROJECT_ID is required for the PostHog cohort pull "
            "integration. Set the env var in .env or the deployment "
            "environment."
        )
    return value
