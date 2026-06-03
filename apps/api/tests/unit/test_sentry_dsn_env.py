"""Unit tests for ``get_sentry_dsn_api`` (Phase 7.2, AC-6).

The Sentry DSN accessor applies an *environment-keyed* access policy that
is intentionally asymmetric — neither a pure ``get_*`` nor a pure
``require_*``. These tests pin every branch the Phase 7.2 Seed requires:

    * a non-empty DSN is returned verbatim in **every** environment,
    * an unset/empty DSN **in production** raises ``LookupError`` (fail-fast),
    * an unset/empty DSN in ``development`` / ``preview`` / ``ci`` returns
      ``None`` (fail-open — the init layer no-ops + warns),
    * the unset-and-unset (no DSN, no ENVIRONMENT) case defaults to
      ``development`` and therefore returns ``None``,
    * the fail-fast ``LookupError`` names the var but never leaks a value,
    * an invalid ``ENVIRONMENT`` propagates ``ValueError`` from
      :func:`get_environment` (the single source of truth).

All tests use ``monkeypatch.setenv`` / ``delenv`` (which mutate
``os.environ`` directly and bypass the once-per-process ``.env`` cache).
No test contacts Sentry.io — the DSN is a synthetic string.
"""

from __future__ import annotations

import pytest

from api.config.env import get_sentry_dsn_api

_DSN_VAR = "SENTRY_DSN_API"
_ENV_VAR = "ENVIRONMENT"

# Synthetic DSN — shaped like a real Sentry DSN but points nowhere. No test
# ever initializes the SDK with it, so it never reaches the network.
_FAKE_DSN = "https://examplePublicKey@o0.ingest.sentry.io/0"

# The three environments where a missing DSN is fail-open (no-op + warn).
_NON_PROD_ENVIRONMENTS = ("development", "preview", "ci")
# Every valid environment value, for the "DSN present always wins" sweep.
_ALL_ENVIRONMENTS = ("development", "preview", "production", "ci")


# ---------------------------------------------------------------------------
# DSN present: returned verbatim regardless of environment (incl. production).
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize("environment", _ALL_ENVIRONMENTS)
def test_returns_dsn_when_set_in_any_environment(
    monkeypatch: pytest.MonkeyPatch, environment: str
) -> None:
    monkeypatch.setenv(_ENV_VAR, environment)
    monkeypatch.setenv(_DSN_VAR, _FAKE_DSN)
    assert get_sentry_dsn_api() == _FAKE_DSN


@pytest.mark.unit
def test_returns_dsn_in_production_when_set(monkeypatch: pytest.MonkeyPatch) -> None:
    # The fail-fast path must NOT trigger when the DSN is present in prod.
    monkeypatch.setenv(_ENV_VAR, "production")
    monkeypatch.setenv(_DSN_VAR, _FAKE_DSN)
    assert get_sentry_dsn_api() == _FAKE_DSN


@pytest.mark.unit
def test_returns_dsn_when_environment_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    # ENVIRONMENT unset -> defaults to development; a present DSN is returned.
    monkeypatch.delenv(_ENV_VAR, raising=False)
    monkeypatch.setenv(_DSN_VAR, _FAKE_DSN)
    assert get_sentry_dsn_api() == _FAKE_DSN


# ---------------------------------------------------------------------------
# Production + missing DSN: fail-fast LookupError.
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_raises_in_production_when_dsn_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(_ENV_VAR, "production")
    monkeypatch.delenv(_DSN_VAR, raising=False)
    with pytest.raises(LookupError):
        get_sentry_dsn_api()


@pytest.mark.unit
def test_raises_in_production_when_dsn_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    # An empty string counts as "unset" — a stray ``SENTRY_DSN_API=`` line
    # must not satisfy the production requirement.
    monkeypatch.setenv(_ENV_VAR, "production")
    monkeypatch.setenv(_DSN_VAR, "")
    with pytest.raises(LookupError):
        get_sentry_dsn_api()


@pytest.mark.unit
def test_production_lookuperror_names_var_not_value(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(_ENV_VAR, "production")
    monkeypatch.delenv(_DSN_VAR, raising=False)
    with pytest.raises(LookupError) as exc_info:
        get_sentry_dsn_api()
    message = str(exc_info.value)
    # Names the env var and the triggering environment for actionable context.
    assert "SENTRY_DSN_API" in message
    assert "production" in message
    # Never leaks the (absent) value or any synthetic DSN.
    assert _FAKE_DSN not in message


# ---------------------------------------------------------------------------
# Non-production + missing DSN: fail-open, returns None.
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize("environment", _NON_PROD_ENVIRONMENTS)
def test_returns_none_when_dsn_unset_non_production(
    monkeypatch: pytest.MonkeyPatch, environment: str
) -> None:
    monkeypatch.setenv(_ENV_VAR, environment)
    monkeypatch.delenv(_DSN_VAR, raising=False)
    assert get_sentry_dsn_api() is None


@pytest.mark.unit
@pytest.mark.parametrize("environment", _NON_PROD_ENVIRONMENTS)
def test_returns_none_when_dsn_empty_non_production(
    monkeypatch: pytest.MonkeyPatch, environment: str
) -> None:
    monkeypatch.setenv(_ENV_VAR, environment)
    monkeypatch.setenv(_DSN_VAR, "")
    assert get_sentry_dsn_api() is None


@pytest.mark.unit
def test_returns_none_when_both_unset_defaults_development(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Neither var set: ENVIRONMENT defaults to development (fail-open), so a
    # missing DSN is a no-op (None), never a crash. This is the local-dev /
    # fresh-checkout path.
    monkeypatch.delenv(_ENV_VAR, raising=False)
    monkeypatch.delenv(_DSN_VAR, raising=False)
    assert get_sentry_dsn_api() is None


# ---------------------------------------------------------------------------
# Invalid ENVIRONMENT propagates ValueError from the single source of truth.
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize("bad", ["prod", "staging", "Production", "PRODUCTION"])
def test_propagates_valueerror_on_unknown_environment(
    monkeypatch: pytest.MonkeyPatch, bad: str
) -> None:
    # The fail-fast decision is delegated to get_environment, so an invalid
    # ENVIRONMENT surfaces as ValueError even when the DSN is unset.
    monkeypatch.setenv(_ENV_VAR, bad)
    monkeypatch.delenv(_DSN_VAR, raising=False)
    with pytest.raises(ValueError):
        get_sentry_dsn_api()


@pytest.mark.unit
def test_valueerror_takes_precedence_over_dsn_present(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # When the DSN is present we short-circuit before consulting the
    # environment, so a bad ENVIRONMENT does NOT raise — the DSN wins.
    monkeypatch.setenv(_ENV_VAR, "not-a-real-env")
    monkeypatch.setenv(_DSN_VAR, _FAKE_DSN)
    assert get_sentry_dsn_api() == _FAKE_DSN
