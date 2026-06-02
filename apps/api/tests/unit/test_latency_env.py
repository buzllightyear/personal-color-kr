"""Unit tests for ``get_latency_alert_p95_threshold_ms`` (Phase 7.1).

The threshold knob is *sensible-default*, never fail-fast: a missing,
empty, non-integer, or non-positive value must fall back to the 500ms
default rather than raising. These tests pin that contract.
"""

from __future__ import annotations

import pytest

from api.config.env import (
    DEFAULT_LATENCY_ALERT_P95_THRESHOLD_MS,
    get_latency_alert_p95_threshold_ms,
)

_VAR = "LATENCY_ALERT_P95_THRESHOLD_MS"


@pytest.mark.unit
def test_default_when_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(_VAR, raising=False)
    assert get_latency_alert_p95_threshold_ms() == 500
    assert DEFAULT_LATENCY_ALERT_P95_THRESHOLD_MS == 500


@pytest.mark.unit
def test_default_when_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(_VAR, "")
    assert get_latency_alert_p95_threshold_ms() == 500


@pytest.mark.unit
def test_parses_valid_positive_int(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(_VAR, "1200")
    assert get_latency_alert_p95_threshold_ms() == 1200


@pytest.mark.unit
@pytest.mark.parametrize("bad", ["abc", "12.5", "  ", "1_000ms"])
def test_default_on_malformed(monkeypatch: pytest.MonkeyPatch, bad: str) -> None:
    monkeypatch.setenv(_VAR, bad)
    assert get_latency_alert_p95_threshold_ms() == 500


@pytest.mark.unit
@pytest.mark.parametrize("bad", ["0", "-1", "-500"])
def test_default_on_non_positive(monkeypatch: pytest.MonkeyPatch, bad: str) -> None:
    monkeypatch.setenv(_VAR, bad)
    assert get_latency_alert_p95_threshold_ms() == 500
