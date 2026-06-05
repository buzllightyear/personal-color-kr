"""Env-driven unit tests for ``get_sentry_traces_sample_rate`` (Phase 7.3).

This suite is the dedicated *environment-variable resolution* contract for the
Sentry transaction sampling knob. It pins, end-to-end through the real
``os.environ`` boundary (driven only by ``monkeypatch``), the four behaviors the
Phase 7.3 Seed mandates:

    1. **All four environments** resolve to their canonical per-environment
       default — ``development`` → ``0.0``, ``ci`` → ``0.0``, ``preview`` →
       ``0.1``, ``production`` → ``0.1`` — when no override is present.
    2. **Override** — a well-formed ``SENTRY_TRACES_SAMPLE_RATE`` wins over the
       per-environment default in every environment.
    3. **Bounds** — the inclusive ``[0.0, 1.0]`` contract is honored: the
       boundary values are accepted and anything outside is rejected.
    4. **Fail-fast / fail-open** — a malformed or out-of-bounds override raises
       :class:`ValueError` in ``production`` (fail-fast) but falls back to the
       per-environment default with a single warning log everywhere else
       (fail-open), so a fat-fingered local value never crashes dev/ci/preview.

The tests exercise the env boundary only — no Sentry SDK, no
``sentry_sdk.init``, no network. ``SENTRY_TRACES_SAMPLE_RATE`` is a sampling
knob (never a secret), so its value is asserted on directly.
"""

from __future__ import annotations

import pytest

from api.config.env import (
    DEFAULT_TRACES_SAMPLE_RATES,
    TRACES_SAMPLE_RATE_MAX,
    TRACES_SAMPLE_RATE_MIN,
    get_sentry_traces_sample_rate,
)

pytestmark = pytest.mark.unit

_ENV_VAR = "ENVIRONMENT"
_RATE_VAR = "SENTRY_TRACES_SAMPLE_RATE"

#: Every valid runtime environment paired with its canonical default rate.
_ENV_DEFAULTS: tuple[tuple[str, float], ...] = (
    ("development", 0.0),
    ("ci", 0.0),
    ("preview", 0.1),
    ("production", 0.1),
)
#: The three environments where an invalid override is fail-open (default+warn).
_NON_PROD_ENVIRONMENTS: tuple[str, ...] = ("development", "ci", "preview")


@pytest.fixture(autouse=True)
def _isolate_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Clear both env vars so no ambient value leaks across cases.

    Each test sets exactly what it needs via ``monkeypatch.setenv``; the
    autouse delete guarantees a clean baseline (a developer's exported
    ``SENTRY_TRACES_SAMPLE_RATE`` or a CI ``ENVIRONMENT`` cannot perturb the
    assertions).
    """
    monkeypatch.delenv(_RATE_VAR, raising=False)
    monkeypatch.delenv(_ENV_VAR, raising=False)


# ---------------------------------------------------------------------------
# (1) All four environments — per-environment defaults, no override present.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(("environment", "expected"), _ENV_DEFAULTS)
def test_env_default_rate_for_each_environment(
    monkeypatch: pytest.MonkeyPatch, environment: str, expected: float
) -> None:
    """Each ``ENVIRONMENT`` resolves to its canonical default with no override."""
    monkeypatch.setenv(_ENV_VAR, environment)
    assert get_sentry_traces_sample_rate() == pytest.approx(expected)


def test_env_unset_defaults_to_development_zero(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Unset ``ENVIRONMENT`` defaults to ``development`` → ``0.0`` (tracing off)."""
    # _isolate_env already deletes ENVIRONMENT; assert the development default.
    assert get_sentry_traces_sample_rate() == pytest.approx(0.0)


def test_env_default_mapping_matches_resolver(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The resolver and the public default mapping agree for every environment."""
    for environment, _ in _ENV_DEFAULTS:
        monkeypatch.setenv(_ENV_VAR, environment)
        assert (
            get_sentry_traces_sample_rate() == DEFAULT_TRACES_SAMPLE_RATES[environment]
        )


# ---------------------------------------------------------------------------
# (2) Override — a valid SENTRY_TRACES_SAMPLE_RATE wins over the default.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("environment", [env for env, _ in _ENV_DEFAULTS])
def test_env_valid_override_wins_in_every_environment(
    monkeypatch: pytest.MonkeyPatch, environment: str
) -> None:
    """A well-formed override replaces the per-environment default everywhere."""
    monkeypatch.setenv(_ENV_VAR, environment)
    monkeypatch.setenv(_RATE_VAR, "0.25")
    assert get_sentry_traces_sample_rate() == pytest.approx(0.25)


@pytest.mark.parametrize("raw", ["0.5", "0.333", "1", "0"])
def test_env_override_parses_numeric_forms(
    monkeypatch: pytest.MonkeyPatch, raw: str
) -> None:
    """Integer-shaped and decimal-shaped overrides both parse as floats."""
    monkeypatch.setenv(_ENV_VAR, "preview")
    monkeypatch.setenv(_RATE_VAR, raw)
    assert get_sentry_traces_sample_rate() == pytest.approx(float(raw))


@pytest.mark.parametrize("environment", [env for env, _ in _ENV_DEFAULTS])
def test_env_empty_override_falls_back_to_default(
    monkeypatch: pytest.MonkeyPatch, environment: str
) -> None:
    """An empty ``SENTRY_TRACES_SAMPLE_RATE=`` is treated as unset (default)."""
    monkeypatch.setenv(_ENV_VAR, environment)
    monkeypatch.setenv(_RATE_VAR, "")
    assert get_sentry_traces_sample_rate() == DEFAULT_TRACES_SAMPLE_RATES[environment]


# ---------------------------------------------------------------------------
# (3) Bounds — inclusive [0.0, 1.0]: boundaries accepted, outside rejected.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("environment", [env for env, _ in _ENV_DEFAULTS])
def test_env_inclusive_boundaries_accepted(
    monkeypatch: pytest.MonkeyPatch, environment: str
) -> None:
    """Both inclusive boundary values (``0.0`` and ``1.0``) are accepted."""
    monkeypatch.setenv(_ENV_VAR, environment)
    for boundary in (TRACES_SAMPLE_RATE_MIN, TRACES_SAMPLE_RATE_MAX):
        monkeypatch.setenv(_RATE_VAR, str(boundary))
        assert get_sentry_traces_sample_rate() == pytest.approx(boundary)


def test_env_bounds_constants_are_unit_interval() -> None:
    """The bounds constants pin the SDK's inclusive ``[0.0, 1.0]`` contract."""
    assert TRACES_SAMPLE_RATE_MIN == 0.0
    assert TRACES_SAMPLE_RATE_MAX == 1.0


@pytest.mark.parametrize("bad", ["-0.0001", "1.0001", "1.5", "2", "-1", "100"])
def test_env_out_of_bounds_rejected_in_production(
    monkeypatch: pytest.MonkeyPatch, bad: str
) -> None:
    """Out-of-bounds overrides are rejected (fail-fast) in production."""
    monkeypatch.setenv(_ENV_VAR, "production")
    monkeypatch.setenv(_RATE_VAR, bad)
    with pytest.raises(ValueError):
        get_sentry_traces_sample_rate()


# ---------------------------------------------------------------------------
# (4a) Fail-fast — production raises on malformed / out-of-bounds overrides.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("bad", ["abc", "0,1", "1e", "nan-ish", "0.1.2", "  "])
def test_env_malformed_override_fails_fast_in_production(
    monkeypatch: pytest.MonkeyPatch, bad: str
) -> None:
    """A non-float override aborts startup in production (no silent mis-sampling)."""
    monkeypatch.setenv(_ENV_VAR, "production")
    monkeypatch.setenv(_RATE_VAR, bad)
    with pytest.raises(ValueError):
        get_sentry_traces_sample_rate()


def test_env_blank_override_is_unset_and_uses_production_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A bare empty ``SENTRY_TRACES_SAMPLE_RATE=`` is "unset" → prod default 0.1.

    The empty string short-circuits before float parsing, so it is never treated
    as a malformed value even in production — it simply yields the default.
    """
    monkeypatch.setenv(_ENV_VAR, "production")
    monkeypatch.setenv(_RATE_VAR, "")
    assert get_sentry_traces_sample_rate() == pytest.approx(0.1)


def test_env_production_failfast_message_names_var_and_value(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The production ``ValueError`` is actionable: names the var and the value."""
    monkeypatch.setenv(_ENV_VAR, "production")
    monkeypatch.setenv(_RATE_VAR, "garbage")
    with pytest.raises(ValueError) as exc_info:
        get_sentry_traces_sample_rate()
    message = str(exc_info.value)
    assert _RATE_VAR in message
    # The knob is not a secret, so echoing the offending value aids debugging.
    assert "garbage" in message


# ---------------------------------------------------------------------------
# (4b) Fail-open — non-production logs once and falls back to the default.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("environment", _NON_PROD_ENVIRONMENTS)
def test_env_malformed_override_fails_open_outside_production(
    monkeypatch: pytest.MonkeyPatch, environment: str
) -> None:
    """A malformed override never raises outside production; default is used."""
    monkeypatch.setenv(_ENV_VAR, environment)
    monkeypatch.setenv(_RATE_VAR, "definitely-not-a-float")
    assert get_sentry_traces_sample_rate() == DEFAULT_TRACES_SAMPLE_RATES[environment]


@pytest.mark.parametrize("environment", _NON_PROD_ENVIRONMENTS)
def test_env_out_of_bounds_override_fails_open_outside_production(
    monkeypatch: pytest.MonkeyPatch, environment: str
) -> None:
    """An out-of-bounds override falls back to the default outside production."""
    monkeypatch.setenv(_ENV_VAR, environment)
    monkeypatch.setenv(_RATE_VAR, "7.5")
    assert get_sentry_traces_sample_rate() == DEFAULT_TRACES_SAMPLE_RATES[environment]


def test_env_fail_open_emits_single_structured_warning(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """Fail-open path emits exactly one ``sentry_traces_sample_rate_invalid`` log."""
    import api.config.env as env_module

    monkeypatch.setenv(_ENV_VAR, "preview")
    monkeypatch.setenv(_RATE_VAR, "5.0")  # out of bounds → fail-open in preview
    monkeypatch.setattr(env_module._logger, "propagate", True)

    with caplog.at_level("WARNING", logger="apps.api"):
        rate = get_sentry_traces_sample_rate()

    assert rate == pytest.approx(0.1)
    records = [
        r
        for r in caplog.records
        if r.getMessage() == "sentry_traces_sample_rate_invalid"
    ]
    assert len(records) == 1
    assert getattr(records[0], "invalid_reason") == "out_of_bounds"
    assert getattr(records[0], "environment") == "preview"
    assert getattr(records[0], "fallback_rate") == pytest.approx(0.1)


# ---------------------------------------------------------------------------
# Cross-cutting — an invalid ENVIRONMENT propagates ValueError from the SSOT.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("bad_env", ["prod", "staging", "Production", "PROD"])
def test_env_invalid_environment_propagates_valueerror(
    monkeypatch: pytest.MonkeyPatch, bad_env: str
) -> None:
    """An unknown ``ENVIRONMENT`` surfaces ``ValueError`` from ``get_environment``."""
    monkeypatch.setenv(_ENV_VAR, bad_env)
    with pytest.raises(ValueError):
        get_sentry_traces_sample_rate()
