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

import logging
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Final, Literal

from dotenv import find_dotenv, load_dotenv

from api.config.logging import LOGGER_NAME

#: Module logger — the shared ``apps.api`` JSON logger (see
#: :mod:`api.config.logging`). Used only for the fail-open
#: ``sentry_traces_sample_rate_invalid`` warning emitted when a non-production
#: ``SENTRY_TRACES_SAMPLE_RATE`` override is malformed/out-of-bounds and we fall
#: back to the per-environment default. ``api.config.logging`` does not import
#: this module, so the import is acyclic.
_logger: Final[logging.Logger] = logging.getLogger(LOGGER_NAME)

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


# ---------------------------------------------------------------------------
# Phase 7.1 — in-process latency monitoring threshold
# (LATENCY_ALERT_P95_THRESHOLD_MS)
# ---------------------------------------------------------------------------
# The in-process latency aggregator (``api.services.latency_aggregator``)
# fires a transition-based P95 alert when a route bucket's rolling-window
# P95 latency crosses this threshold. Unlike the fail-fast ``require_*``
# secrets above, this knob has a *sensible default* (500 ms): a missing,
# empty, or malformed value must NOT crash the app — latency monitoring is
# an observability aid, not a hard dependency. The getter therefore always
# returns a positive ``int``, falling back to the default for any
# unparseable / non-positive input.

#: Default P95 alert threshold (milliseconds) when the env var is unset,
#: empty, or malformed. Sensible-default, never fail-fast.
DEFAULT_LATENCY_ALERT_P95_THRESHOLD_MS: Final[int] = 500


def get_latency_alert_p95_threshold_ms() -> int:
    """Return the P95 alert threshold in ms (default 500, never raises).

    Reads ``LATENCY_ALERT_P95_THRESHOLD_MS`` from the environment (after
    loading the root ``.env`` once). Any value that is unset, empty,
    non-integer, or non-positive falls back to
    :data:`DEFAULT_LATENCY_ALERT_P95_THRESHOLD_MS` (500). This mirrors the
    Seed constraint that the threshold is a *sensible default*, not a
    fail-fast secret — a misconfigured monitoring knob must never take the
    API down.

    Returns
    -------
    int
        A strictly-positive threshold in milliseconds.
    """
    _load_root_dotenv_once()
    value = os.environ.get("LATENCY_ALERT_P95_THRESHOLD_MS")
    if value is None or value == "":
        return DEFAULT_LATENCY_ALERT_P95_THRESHOLD_MS
    try:
        parsed = int(value)
    except ValueError:
        return DEFAULT_LATENCY_ALERT_P95_THRESHOLD_MS
    if parsed <= 0:
        return DEFAULT_LATENCY_ALERT_P95_THRESHOLD_MS
    return parsed


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


# ---------------------------------------------------------------------------
# Phase 7.2 — Sentry release identifier (GIT_SHA)
# ---------------------------------------------------------------------------
# The Sentry SDK tags every captured event with a ``release`` so errors can be
# correlated back to the exact deployed commit. We source it from the
# ``GIT_SHA`` env var (the CI/CD pipeline injects the deployed commit SHA) and
# fall back to the literal ``"unknown"`` when it is unset or empty.
#
# Unlike the fail-fast ``require_*`` secrets above, the release tag is a
# *sensible-default* knob: a missing ``GIT_SHA`` (local dev, a bare checkout)
# must NEVER crash app startup — observability metadata is an aid, not a hard
# dependency. The getter therefore always returns a non-empty ``str``.

#: Fallback release identifier when ``GIT_SHA`` is unset or empty. Sentry
#: shows this verbatim, so it is intentionally human-legible.
DEFAULT_RELEASE: Final[str] = "unknown"


def get_release() -> str:
    """Return the Sentry release identifier (``GIT_SHA`` or ``"unknown"``).

    Reads ``GIT_SHA`` from the environment (after loading the root ``.env``
    once). A value that is unset or empty falls back to
    :data:`DEFAULT_RELEASE` (``"unknown"``) so the Sentry ``release`` tag is
    always a non-empty string and app startup never fails on missing release
    metadata. This mirrors the ``os.environ.get("GIT_SHA", "unknown")``
    contract pinned by the Phase 7.2 Seed.

    Returns
    -------
    str
        The deployed commit SHA from ``GIT_SHA``, or ``"unknown"`` when the
        variable is unset or empty.
    """
    _load_root_dotenv_once()
    value = os.environ.get("GIT_SHA")
    if value is None or value == "":
        return DEFAULT_RELEASE
    return value


# ---------------------------------------------------------------------------
# Phase 7.2 — runtime environment selector (ENVIRONMENT)
# ---------------------------------------------------------------------------
# The Sentry observability layer (``api.observability.sentry``) keys its
# initialization behavior off a single, enumerated runtime environment:
#
#   * ``production`` — Sentry init is *fail-fast*: a missing ``SENTRY_DSN_API``
#     raises ``LookupError`` at startup (no silent no-op in prod).
#   * ``development`` / ``preview`` / ``ci`` — Sentry init is *fail-open*: a
#     missing DSN is a no-op plus a warning log, never a crash.
#
# Unlike the secret accessors above (``None`` on unset) and the latency knob
# (numeric default), this getter returns a *closed enum*. Two design choices
# pin the contract the Phase 7.2 Seed requires:
#
#   1. Unset/empty ``ENVIRONMENT`` defaults to ``"development"`` — the safest
#      local default, matching the fail-open developer experience.
#   2. An *unknown, non-empty* value raises ``ValueError`` (naming the var and
#      the offending value, plus the allowed set). A typo'd ``ENVIRONMENT``
#      must fail loudly rather than silently degrading to a default and
#      mis-routing Sentry init behavior.

Environment = Literal["development", "preview", "production", "ci"]

#: The closed set of valid runtime environments. Public so callers and tests
#: can reference the canonical tuple rather than re-typing string literals.
ENVIRONMENTS: Final[tuple[Environment, ...]] = (
    "development",
    "preview",
    "production",
    "ci",
)

#: Default runtime environment when ``ENVIRONMENT`` is unset or empty.
DEFAULT_ENVIRONMENT: Final[Environment] = "development"


def get_environment() -> Environment:
    """Return the runtime environment enum (default ``"development"``).

    Reads ``ENVIRONMENT`` from the environment (after loading the root
    ``.env`` once). The contract is a *closed enum*, not a free-form string.

    Returns
    -------
    Environment
        One of ``"development"``, ``"preview"``, ``"production"``, ``"ci"``.
        An unset or empty ``ENVIRONMENT`` falls back to
        :data:`DEFAULT_ENVIRONMENT` (``"development"``).

    Raises
    ------
    ValueError
        If ``ENVIRONMENT`` is set to a non-empty value outside
        :data:`ENVIRONMENTS`. The message names the var, the offending
        value, and the allowed set so a typo fails loudly at startup
        rather than silently mis-routing Sentry init behavior.
    """
    _load_root_dotenv_once()
    value = os.environ.get("ENVIRONMENT")
    if value is None or value == "":
        return DEFAULT_ENVIRONMENT
    if value not in ENVIRONMENTS:
        raise ValueError(
            f"ENVIRONMENT={value!r} is not a valid runtime environment. "
            f"Expected one of {ENVIRONMENTS}."
        )
    return value


# ---------------------------------------------------------------------------
# Phase 7.2 — Sentry API project DSN (SENTRY_DSN_API)
# ---------------------------------------------------------------------------
# ``SENTRY_DSN_API`` is the connection string the Sentry SDK uses to ship
# captured events to the API project. Its access policy is *environment-keyed*
# and intentionally asymmetric — neither a pure ``get_*`` (always ``None`` on
# unset) nor a pure ``require_*`` (always raises on unset):
#
#   * ``production`` — **fail-fast**. A missing/empty DSN raises
#     :class:`LookupError` at startup. Shipping prod with error reporting
#     silently disabled is a launch-readiness regression, so the absence is a
#     hard error rather than a no-op.
#   * ``development`` / ``preview`` / ``ci`` — **fail-open**. A missing/empty
#     DSN returns ``None``. The init layer (``api.observability.sentry``) turns
#     that ``None`` into a no-op plus a single warning log; local dev, preview
#     builds, and the test suite must never crash for lacking a DSN.
#
# The fail-fast decision is delegated to :func:`get_environment` (the single
# source of truth for the runtime environment) rather than re-reading
# ``ENVIRONMENT`` here, so the two getters can never disagree. A DSN is not a
# secret in the JWT/credential sense (it is a write-only ingestion key), but to
# stay consistent with the established secret-hygiene contract the
# ``LookupError`` text names the env var and NOT any value.


def get_sentry_dsn_api() -> str | None:
    """Return ``SENTRY_DSN_API``, applying production-only fail-fast.

    Reads ``SENTRY_DSN_API`` from the environment (after loading the root
    ``.env`` once) and applies an environment-keyed access policy driven by
    :func:`get_environment`:

        * A non-empty DSN is returned verbatim in every environment.
        * An unset/empty DSN **in production** raises :class:`LookupError` so
          the app fails fast at startup rather than running prod with error
          reporting silently disabled.
        * An unset/empty DSN in ``development`` / ``preview`` / ``ci`` returns
          ``None`` (fail-open). The Sentry init layer turns that ``None`` into
          a no-op plus a warning log — it never crashes a non-prod process.

    Returns
    -------
    str | None
        The ``SENTRY_DSN_API`` value, or ``None`` when it is unset/empty and
        the runtime environment is not ``production``.

    Raises
    ------
    LookupError
        When ``SENTRY_DSN_API`` is unset/empty **and**
        :func:`get_environment` is ``"production"``. The message names the env
        var but never leaks a value.
    ValueError
        Propagated from :func:`get_environment` when ``ENVIRONMENT`` is set to
        a non-empty value outside :data:`ENVIRONMENTS`.
    """
    _load_root_dotenv_once()
    value = os.environ.get("SENTRY_DSN_API")
    if value is not None and value != "":
        return value
    # Unset/empty: the environment decides between fail-fast and fail-open.
    if get_environment() == "production":
        raise LookupError(
            "SENTRY_DSN_API is required when ENVIRONMENT=production. "
            "Sentry error reporting must not be silently disabled in "
            "production; set the env var in the deployment environment."
        )
    return None


# ---------------------------------------------------------------------------
# Phase 7.3 — environment-aware Sentry transaction sampling
# (traces_sample_rate + SENTRY_TRACES_SAMPLE_RATE override)
# ---------------------------------------------------------------------------
# Phase 7.2 shipped error capture only (tracing disabled). Phase 7.3 turns on
# *top-level HTTP transaction* tracing and keys the sample rate off the runtime
# environment so cost/volume stays bounded:
#
#   * development / ci — 0.0 (tracing off): local runs and the test suite must
#     ship zero transactions, keeping CI deterministic and free of ingest.
#   * preview / production — 0.1 (10%): a representative sample that surfaces
#     latency trends without paying to ingest every request.
#
# An optional ``SENTRY_TRACES_SAMPLE_RATE`` env var overrides the default for
# ad-hoc tuning (e.g. temporarily sampling 100% in preview to chase a latency
# regression). The override is validated against the Sentry SDK's inclusive
# ``[0.0, 1.0]`` contract with an *environment-keyed* failure policy that mirrors
# :func:`get_sentry_dsn_api`:
#
#   * production — **fail-fast**: a malformed (non-float) or out-of-bounds
#     override raises :class:`ValueError` at startup rather than silently
#     mis-sampling prod traffic with a bad config value.
#   * development / preview / ci — **fail-open**: a bad override is ignored with
#     a single ``sentry_traces_sample_rate_invalid`` warning and the
#     per-environment default is used, so a fat-fingered local value never
#     crashes the dev/test process.

#: Per-environment default transaction sample rates. Dev/CI keep tracing fully
#: off (``0.0``); preview/production sample 10% (``0.1``). Public so callers and
#: tests reference the canonical mapping rather than re-typing literals.
DEFAULT_TRACES_SAMPLE_RATES: Final[dict[Environment, float]] = {
    "development": 0.0,
    "ci": 0.0,
    "preview": 0.1,
    "production": 0.1,
}

#: Inclusive lower/upper bounds for a valid ``traces_sample_rate`` (the Sentry
#: SDK rejects values outside ``[0.0, 1.0]``).
TRACES_SAMPLE_RATE_MIN: Final[float] = 0.0
TRACES_SAMPLE_RATE_MAX: Final[float] = 1.0


def get_sentry_traces_sample_rate() -> float:
    """Return the Sentry ``traces_sample_rate`` for the runtime environment.

    Resolves the per-environment default from :data:`DEFAULT_TRACES_SAMPLE_RATES`
    (``development`` → ``0.0``, ``ci`` → ``0.0``, ``preview`` → ``0.1``,
    ``production`` → ``0.1``), then applies the optional
    ``SENTRY_TRACES_SAMPLE_RATE`` override:

        * **unset/empty** — the per-environment default is returned.
        * **valid** (a float within ``[0.0, 1.0]``) — the override is returned.
        * **malformed or out-of-bounds** — the failure policy is keyed off
          :func:`get_environment`:

              - ``production`` raises :class:`ValueError` (fail-fast): a bad
                sampling config must not silently mis-sample prod traffic.
              - ``development`` / ``preview`` / ``ci`` log a single
                ``sentry_traces_sample_rate_invalid`` warning and fall back to
                the per-environment default (fail-open).

    Returns
    -------
    float
        A sample rate within ``[0.0, 1.0]`` — the override when valid, otherwise
        the per-environment default.

    Raises
    ------
    ValueError
        When ``SENTRY_TRACES_SAMPLE_RATE`` is malformed or out of ``[0.0, 1.0]``
        **and** :func:`get_environment` is ``"production"``. Also propagated
        from :func:`get_environment` when ``ENVIRONMENT`` is an unknown,
        non-empty value.
    """
    _load_root_dotenv_once()
    environment = get_environment()
    default = DEFAULT_TRACES_SAMPLE_RATES[environment]

    raw = os.environ.get("SENTRY_TRACES_SAMPLE_RATE")
    if raw is None or raw == "":
        return default

    try:
        parsed = float(raw)
    except ValueError:
        return _reject_or_default_traces_rate(
            environment=environment,
            default=default,
            raw=raw,
            reason="not_a_float",
        )

    # Reject NaN/inf and anything outside the SDK's inclusive [0.0, 1.0] range.
    if not (TRACES_SAMPLE_RATE_MIN <= parsed <= TRACES_SAMPLE_RATE_MAX):
        return _reject_or_default_traces_rate(
            environment=environment,
            default=default,
            raw=raw,
            reason="out_of_bounds",
        )

    return parsed


# ---------------------------------------------------------------------------
# Content Generation — admin route bearer token (ADMIN_TOKEN)
# ---------------------------------------------------------------------------
# All /admin routes are protected by a static bearer token. The token is
# set via the ``ADMIN_TOKEN`` env var; it must be non-empty in every
# environment where the admin UI is in use. Unlike the JWT secret (which
# is a signing key), ADMIN_TOKEN is a simple shared secret — long, random,
# and known only to the single operator.
#
# Access policy:
#   * Unset/empty → returns None (fail-open, so local dev can start without it;
#     the admin-auth dependency will reject requests with 403).
#   * Set → returns the value verbatim.
#
# The ``require_*`` variant is used by the admin-auth dependency to enforce
# the presence of the token at request time (not at startup), so a missing
# ADMIN_TOKEN only impacts admin-route access, never the user-facing surface.


def get_admin_token() -> str | None:
    """Return ``ADMIN_TOKEN`` from env, or ``None`` if unset/empty.

    The static bearer token that guards all ``/admin`` routes. Never
    appears in error messages or logs (same secret-hygiene contract as
    ``JWT_SECRET``).
    """
    _load_root_dotenv_once()
    value = os.environ.get("ADMIN_TOKEN")
    if value is None or value == "":
        return None
    return value


def require_admin_token() -> str:
    """Return ``ADMIN_TOKEN`` or raise :class:`LookupError`.

    Convenience for the admin-auth dependency. The error message names
    the env var but NOT its value.
    """
    value = get_admin_token()
    if value is None:
        raise LookupError(
            "ADMIN_TOKEN is required to protect admin routes. "
            "Set the env var in .env or the deployment environment."
        )
    return value


def _reject_or_default_traces_rate(
    *,
    environment: Environment,
    default: float,
    raw: str,
    reason: str,
) -> float:
    """Apply the environment-keyed policy for an invalid traces-rate override.

    Production fails fast (:class:`ValueError`); every other environment logs a
    single ``sentry_traces_sample_rate_invalid`` warning and returns the
    per-environment ``default`` (fail-open). The ``raw`` value is included in the
    message/log because ``SENTRY_TRACES_SAMPLE_RATE`` is a sampling knob, not a
    secret — no credential ever flows through it.

    Parameters
    ----------
    environment:
        The resolved runtime environment (decides fail-fast vs fail-open).
    default:
        The per-environment default returned on the fail-open path.
    raw:
        The offending ``SENTRY_TRACES_SAMPLE_RATE`` string.
    reason:
        A stable machine code (``"not_a_float"`` / ``"out_of_bounds"``) attached
        to the warning log and the exception text.

    Raises
    ------
    ValueError
        When ``environment`` is ``"production"``.
    """
    if environment == "production":
        raise ValueError(
            f"SENTRY_TRACES_SAMPLE_RATE={raw!r} is invalid ({reason}). "
            f"Expected a float within "
            f"[{TRACES_SAMPLE_RATE_MIN}, {TRACES_SAMPLE_RATE_MAX}]. "
            "A malformed sampling rate must not silently mis-sample "
            "production traffic."
        )
    _logger.warning(
        "sentry_traces_sample_rate_invalid",
        extra={
            "invalid_reason": reason,
            "invalid_value": raw,
            "environment": environment,
            "fallback_rate": default,
        },
    )
    return default


# ---------------------------------------------------------------------------
# Content Generation (AC4) — object storage credentials (S3 / Cloudflare R2)
# ---------------------------------------------------------------------------
# The generated, watermarked images are persisted to an S3-compatible object
# store (AWS S3 or Cloudflare R2 — both speak the same SigV4 + REST API). The
# five values below fully describe the connection; they are read as a single
# group so a partially-configured store (e.g. a bucket without a secret) is
# treated as "unconfigured" rather than silently building a broken client.
#
# Access policy (mirrors the fal.ai key seam in ``dependencies/generate.py``):
#   * All five present → :func:`get_object_storage_config` returns a frozen
#     config object; the production :class:`S3ObjectStorage` is constructed.
#   * Any missing/empty → returns ``None``; the storage dependency falls back
#     to a process-local in-memory store (local dev / CI) so the app still
#     boots and the generation flow works end-to-end without cloud creds.
#
# The secret access key never appears in any log line or error message — same
# secret-hygiene contract as ``JWT_SECRET`` / ``ADMIN_TOKEN``.


@dataclass(frozen=True)
class ObjectStorageConfig:
    """Immutable S3 / R2 connection parameters resolved from the environment.

    Attributes
    ----------
    endpoint_url:
        The S3-compatible REST endpoint origin, e.g.
        ``https://<account>.r2.cloudflarestorage.com`` (R2) or
        ``https://s3.us-east-1.amazonaws.com`` (AWS). No trailing slash.
    bucket:
        The bucket name objects are written under.
    access_key_id:
        The access key id used for SigV4 signing.
    secret_access_key:
        The secret signing key (never logged).
    region:
        The signing region. R2 ignores the region for routing but still
        requires it in the SigV4 credential scope; ``auto`` is the R2
        convention and a sensible default.
    """

    endpoint_url: str
    bucket: str
    access_key_id: str
    secret_access_key: str
    region: str


#: Default SigV4 signing region when ``S3_REGION`` is unset. ``auto`` matches
#: the Cloudflare R2 convention; AWS deployments should set the real region.
DEFAULT_S3_REGION: Final[str] = "auto"


def get_object_storage_config() -> ObjectStorageConfig | None:
    """Return the S3/R2 connection config, or ``None`` if not fully configured.

    Reads ``S3_ENDPOINT_URL``, ``S3_BUCKET``, ``S3_ACCESS_KEY_ID``,
    ``S3_SECRET_ACCESS_KEY`` (all required) and ``S3_REGION`` (optional,
    defaults to :data:`DEFAULT_S3_REGION`). When any required value is unset or
    empty the function returns ``None`` so the caller can fall back to the
    in-memory store rather than constructing a half-configured client.

    Returns
    -------
    ObjectStorageConfig | None
        The frozen config when all required vars are present, else ``None``.
    """
    _load_root_dotenv_once()
    endpoint = os.environ.get("S3_ENDPOINT_URL")
    bucket = os.environ.get("S3_BUCKET")
    access_key = os.environ.get("S3_ACCESS_KEY_ID")
    secret_key = os.environ.get("S3_SECRET_ACCESS_KEY")
    if not endpoint or not bucket or not access_key or not secret_key:
        return None
    region = os.environ.get("S3_REGION") or DEFAULT_S3_REGION
    return ObjectStorageConfig(
        endpoint_url=endpoint.rstrip("/"),
        bucket=bucket,
        access_key_id=access_key,
        secret_access_key=secret_key,
        region=region,
    )


# ---------------------------------------------------------------------------
# Content Generation (AC4) — generated-image retention TTL (IMAGE_TTL_DAYS)
# ---------------------------------------------------------------------------
# Generated images are retained for a fixed window then swept (the gallery
# read-path filters expired rows; an out-of-band sweep deletes the rows and
# their storage objects). Like the latency threshold, this is a *sensible
# default* knob — a missing/malformed value must never crash the app, so the
# getter always returns a strictly-positive ``int``.

#: Default retention window (days) when ``IMAGE_TTL_DAYS`` is unset, empty, or
#: malformed. 30 days balances "let users revisit their results" against the
#: storage cost of an unbounded cumulative gallery.
DEFAULT_IMAGE_TTL_DAYS: Final[int] = 30


def get_image_ttl_days() -> int:
    """Return the generated-image retention window in days (default 30).

    Reads ``IMAGE_TTL_DAYS`` from the environment (after loading the root
    ``.env`` once). Any value that is unset, empty, non-integer, or
    non-positive falls back to :data:`DEFAULT_IMAGE_TTL_DAYS` (30). A
    misconfigured retention knob must never take the API down.

    Returns
    -------
    int
        A strictly-positive retention window in days.
    """
    _load_root_dotenv_once()
    value = os.environ.get("IMAGE_TTL_DAYS")
    if value is None or value == "":
        return DEFAULT_IMAGE_TTL_DAYS
    try:
        parsed = int(value)
    except ValueError:
        return DEFAULT_IMAGE_TTL_DAYS
    if parsed <= 0:
        return DEFAULT_IMAGE_TTL_DAYS
    return parsed
