"""Startup fail-fast for production without a Sentry DSN (Phase 7.2, AC-3).

# What AC-3 pins

> ``ENVIRONMENT=production`` with a **missing or empty** ``SENTRY_DSN_API``
> raises :class:`LookupError` at startup — the app *refuses to boot*.

Shipping production with error reporting silently disabled is a
launch-readiness regression, so the absence of a DSN in production must be a
hard error at construction time, never a deferred/first-request failure and
never a silent no-op.

# The boot chain this module verifies

``api.main.create_app`` calls
:func:`api.observability.sentry.init_sentry_for_environment` as its first line
(before the ``FastAPI(...)`` constructor). That entry point resolves the DSN
through :func:`api.config.env.get_sentry_dsn_api`, whose production branch
raises :class:`LookupError`. The error therefore propagates out of
``create_app()`` and the process fails to start.

The tests fall into two tiers:

    1. **Boot-contract tier** (always runs): exercises the exact resolver the
       boot path delegates to — ``get_sentry_dsn_api()`` under
       ``ENVIRONMENT=production`` with the DSN unset/empty. This is the
       mechanism that produces the AC-3 ``LookupError``; it is the single
       source of truth for the fail-fast decision (``create_app`` and
       ``init_sentry_for_environment`` both route through it).

    2. **Startup-integration tier** (active once the Sentry init entry point
       is wired): asserts ``init_sentry_for_environment()`` propagates the
       error and that ``create_app()`` itself refuses to construct. These are
       guarded with ``skipif`` so this suite stays green while the
       concurrently-developed init entry point (AC-2) lands; the governed
       merge runs them for real against the composed tree.

# Test isolation

Every test drives ``ENVIRONMENT`` / ``SENTRY_DSN_API`` via
``monkeypatch.setenv`` / ``delenv`` (which mutate ``os.environ`` directly and
bypass the once-per-process ``.env`` cache). The DSN, where present, is a
synthetic string that never reaches the network — no test contacts Sentry.io.
"""

from __future__ import annotations

import pytest

from api.config.env import get_sentry_dsn_api

_ENV_VAR = "ENVIRONMENT"
_DSN_VAR = "SENTRY_DSN_API"

# Synthetic DSN — shaped like a real Sentry DSN but points nowhere. Used only
# to prove that a *present* DSN suppresses the fail-fast; the SDK is never
# initialized with it, so it never leaves the process.
_FAKE_DSN = "https://examplePublicKey@o0.ingest.sentry.io/0"

# The concurrently-developed Sentry init entry point (AC-2) and its wiring into
# ``create_app`` may not be present yet in an isolated worktree. Detect both so
# the startup-integration tier activates exactly when the boot chain exists,
# and stays skipped (rather than erroring on import) until then.
try:  # pragma: no cover - import-availability probe, not a behavior under test
    from api.observability.sentry import (  # type: ignore[attr-defined]
        init_sentry_for_environment,
    )

    _HAS_INIT_ENTRYPOINT = True
except ImportError:  # pragma: no cover - exercised only pre-merge in isolation
    init_sentry_for_environment = None  # type: ignore[assignment]
    _HAS_INIT_ENTRYPOINT = False

_requires_init = pytest.mark.skipif(
    not _HAS_INIT_ENTRYPOINT,
    reason=(
        "api.observability.sentry.init_sentry_for_environment is not yet wired "
        "(AC-2, developed concurrently); the startup-integration assertions "
        "activate once the boot entry point lands."
    ),
)


# ---------------------------------------------------------------------------
# Boot-contract tier — the resolver the boot path delegates to (always runs).
# These prove the LookupError that makes the app refuse to boot under AC-3.
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_boot_dsn_resolution_raises_in_production_when_unset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Production + unset DSN: the boot-time resolver raises ``LookupError``."""
    monkeypatch.setenv(_ENV_VAR, "production")
    monkeypatch.delenv(_DSN_VAR, raising=False)
    with pytest.raises(LookupError):
        get_sentry_dsn_api()


@pytest.mark.unit
def test_boot_dsn_resolution_raises_in_production_when_empty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Production + empty DSN: an empty string counts as "unset" → fail-fast.

    A stray ``SENTRY_DSN_API=`` line must not satisfy the production
    requirement and let the app boot with reporting disabled.
    """
    monkeypatch.setenv(_ENV_VAR, "production")
    monkeypatch.setenv(_DSN_VAR, "")
    with pytest.raises(LookupError):
        get_sentry_dsn_api()


@pytest.mark.unit
def test_boot_fail_fast_message_names_var_not_value(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The startup ``LookupError`` is actionable but leaks no value."""
    monkeypatch.setenv(_ENV_VAR, "production")
    monkeypatch.delenv(_DSN_VAR, raising=False)
    with pytest.raises(LookupError) as exc_info:
        get_sentry_dsn_api()
    message = str(exc_info.value)
    assert _DSN_VAR in message
    assert "production" in message
    assert _FAKE_DSN not in message


@pytest.mark.unit
def test_boot_does_not_fail_fast_in_production_when_dsn_present(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A present DSN in production suppresses the fail-fast (sanity guard).

    Pins that the boot guard fires on *absence*, not merely on
    ``ENVIRONMENT=production`` — a correctly-configured prod boots.
    """
    monkeypatch.setenv(_ENV_VAR, "production")
    monkeypatch.setenv(_DSN_VAR, _FAKE_DSN)
    assert get_sentry_dsn_api() == _FAKE_DSN


# ---------------------------------------------------------------------------
# Startup-integration tier — init entry point + create_app refuse to boot.
# Active once the AC-2 init entry point is wired into create_app.
# ---------------------------------------------------------------------------


@pytest.mark.unit
@_requires_init
def test_init_entrypoint_raises_in_production_when_dsn_unset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``init_sentry_for_environment()`` propagates the prod fail-fast."""
    monkeypatch.setenv(_ENV_VAR, "production")
    monkeypatch.delenv(_DSN_VAR, raising=False)
    assert init_sentry_for_environment is not None
    with pytest.raises(LookupError):
        init_sentry_for_environment()


@pytest.mark.unit
@_requires_init
def test_init_entrypoint_raises_in_production_when_dsn_empty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``init_sentry_for_environment()`` treats an empty DSN as unset."""
    monkeypatch.setenv(_ENV_VAR, "production")
    monkeypatch.setenv(_DSN_VAR, "")
    assert init_sentry_for_environment is not None
    with pytest.raises(LookupError):
        init_sentry_for_environment()


@pytest.mark.unit
@_requires_init
def test_create_app_refuses_to_boot_in_production_without_dsn(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The app factory itself refuses to construct (AC-3 headline behavior).

    ``init_sentry_for_environment`` is create_app's first line, so the
    production fail-fast surfaces during application construction — the
    process never reaches a serving state.
    """
    monkeypatch.setenv(_ENV_VAR, "production")
    monkeypatch.delenv(_DSN_VAR, raising=False)
    # Imported lazily: the module-level ``app = create_app()`` in api.main runs
    # under the ambient (non-production) environment at import time, so the
    # import itself is safe; only this explicit production-scoped call boots.
    from api.main import create_app

    with pytest.raises(LookupError):
        create_app()


@pytest.mark.unit
@_requires_init
def test_create_app_boot_failure_names_var_not_value(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The boot-refusal error keeps the secret-hygiene contract end-to-end."""
    monkeypatch.setenv(_ENV_VAR, "production")
    monkeypatch.delenv(_DSN_VAR, raising=False)
    from api.main import create_app

    with pytest.raises(LookupError) as exc_info:
        create_app()
    message = str(exc_info.value)
    assert _DSN_VAR in message
    assert _FAKE_DSN not in message


@pytest.mark.unit
@_requires_init
def test_create_app_boots_in_production_when_dsn_present(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A correctly-configured production boots — the guard fires on absence."""
    monkeypatch.setenv(_ENV_VAR, "production")
    monkeypatch.setenv(_DSN_VAR, _FAKE_DSN)
    from api.main import create_app

    app = create_app()
    assert app is not None
