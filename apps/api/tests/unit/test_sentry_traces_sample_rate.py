"""Unit tests for ``get_sentry_traces_sample_rate`` (Phase 7.3, AC-1).

AC-1 contract: the resolver returns the correct per-environment default
transaction sample rate —

    development → 0.0   ci → 0.0   preview → 0.1   production → 0.1

— and applies the optional ``SENTRY_TRACES_SAMPLE_RATE`` override with an
environment-keyed validation policy:

    * a valid override (float within ``[0.0, 1.0]``) is returned verbatim,
    * a malformed / out-of-bounds override fails fast (``ValueError``) in
      ``production`` but falls back to the per-environment default (fail-open)
      in development / preview / ci.

These tests touch only env vars via ``monkeypatch`` — no Sentry SDK, no network.
"""

from __future__ import annotations

import pytest

from api.config.env import (
    DEFAULT_TRACES_SAMPLE_RATES,
    get_sentry_traces_sample_rate,
)

pytestmark = pytest.mark.unit


@pytest.fixture(autouse=True)
def _clear_override(monkeypatch: pytest.MonkeyPatch) -> None:
    """Ensure no ambient ``SENTRY_TRACES_SAMPLE_RATE`` leaks across cases."""
    monkeypatch.delenv("SENTRY_TRACES_SAMPLE_RATE", raising=False)


# ---------------------------------------------------------------------------
# Per-environment defaults (the core AC-1 assertion)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("environment", "expected"),
    [
        ("development", 0.0),
        ("ci", 0.0),
        ("preview", 0.1),
        ("production", 0.1),
    ],
)
def test_default_rate_per_environment(
    monkeypatch: pytest.MonkeyPatch, environment: str, expected: float
) -> None:
    monkeypatch.setenv("ENVIRONMENT", environment)
    assert get_sentry_traces_sample_rate() == expected


def test_default_when_environment_unset_is_development_zero(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Unset ENVIRONMENT → development (0.0), matching get_environment()'s default.
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    assert get_sentry_traces_sample_rate() == 0.0


def test_defaults_mapping_is_exhaustive_and_bounded() -> None:
    assert set(DEFAULT_TRACES_SAMPLE_RATES) == {
        "development",
        "ci",
        "preview",
        "production",
    }
    assert all(0.0 <= rate <= 1.0 for rate in DEFAULT_TRACES_SAMPLE_RATES.values())


# ---------------------------------------------------------------------------
# Valid override
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("environment", ["development", "ci", "preview", "production"])
def test_valid_override_wins_over_default(
    monkeypatch: pytest.MonkeyPatch, environment: str
) -> None:
    monkeypatch.setenv("ENVIRONMENT", environment)
    monkeypatch.setenv("SENTRY_TRACES_SAMPLE_RATE", "0.42")
    assert get_sentry_traces_sample_rate() == pytest.approx(0.42)


@pytest.mark.parametrize("boundary", ["0.0", "1.0"])
def test_override_accepts_inclusive_boundaries(
    monkeypatch: pytest.MonkeyPatch, boundary: str
) -> None:
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("SENTRY_TRACES_SAMPLE_RATE", boundary)
    assert get_sentry_traces_sample_rate() == pytest.approx(float(boundary))


def test_empty_override_falls_back_to_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ENVIRONMENT", "preview")
    monkeypatch.setenv("SENTRY_TRACES_SAMPLE_RATE", "")
    assert get_sentry_traces_sample_rate() == 0.1


# ---------------------------------------------------------------------------
# Invalid override — production fail-fast
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("bad", ["abc", "not-a-number", "0.1.2"])
def test_malformed_override_fails_fast_in_production(
    monkeypatch: pytest.MonkeyPatch, bad: str
) -> None:
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("SENTRY_TRACES_SAMPLE_RATE", bad)
    with pytest.raises(ValueError):
        get_sentry_traces_sample_rate()


@pytest.mark.parametrize("bad", ["-0.1", "1.5", "2", "10"])
def test_out_of_bounds_override_fails_fast_in_production(
    monkeypatch: pytest.MonkeyPatch, bad: str
) -> None:
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("SENTRY_TRACES_SAMPLE_RATE", bad)
    with pytest.raises(ValueError):
        get_sentry_traces_sample_rate()


# ---------------------------------------------------------------------------
# Invalid override — non-production fail-open (default + warning log)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("environment", ["development", "ci", "preview"])
def test_malformed_override_fails_open_outside_production(
    monkeypatch: pytest.MonkeyPatch, environment: str
) -> None:
    monkeypatch.setenv("ENVIRONMENT", environment)
    monkeypatch.setenv("SENTRY_TRACES_SAMPLE_RATE", "garbage")
    # Never raises; falls back to the per-environment default.
    assert get_sentry_traces_sample_rate() == DEFAULT_TRACES_SAMPLE_RATES[environment]


def test_out_of_bounds_override_fails_open_outside_production(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ENVIRONMENT", "preview")
    monkeypatch.setenv("SENTRY_TRACES_SAMPLE_RATE", "5.0")
    assert get_sentry_traces_sample_rate() == 0.1


def test_fail_open_emits_single_warning_log(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    import api.config.env as env_module

    monkeypatch.setenv("ENVIRONMENT", "development")
    monkeypatch.setenv("SENTRY_TRACES_SAMPLE_RATE", "nope")
    monkeypatch.setattr(env_module._logger, "propagate", True)

    with caplog.at_level("WARNING", logger="apps.api"):
        rate = get_sentry_traces_sample_rate()

    assert rate == 0.0
    records = [
        r
        for r in caplog.records
        if r.getMessage() == "sentry_traces_sample_rate_invalid"
    ]
    assert len(records) == 1
    assert getattr(records[0], "invalid_reason") == "not_a_float"
