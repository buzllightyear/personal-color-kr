"""Focused unit tests for the P95 alert *trigger* condition (Phase 7.1).

This module isolates a single Seed acceptance criterion:

    The P95 ``request_slow_started`` alert fires for a bucket **iff** all
    three conjuncts hold on a :meth:`LatencyAggregator.record`:

        1. ``p95 > LATENCY_ALERT_P95_THRESHOLD_MS``   (strict greater-than)
        2. ``sample_count >= MIN_SAMPLES`` (10)
        3. ``not was_alerting``                       (transition dedup)

    Negating any single conjunct must suppress the emission. These tests
    drive each conjunct's boundary independently and then prove the full
    conjunction, complementing the broader lifecycle tests in
    ``test_latency_aggregator.py``.

All tests use explicit ``timestamp_ns`` values (no real clock) so the
60-second rolling window stays deterministic.
"""

from __future__ import annotations

import logging

import pytest

from api.services.latency_aggregator import (
    MIN_SAMPLES,
    LatencyAggregator,
)

_ONE_SECOND_NS = 1_000_000_000
_STARTED = "request_slow_started"


class _CapturingHandler(logging.Handler):
    """Collect ``(message, latency_ms)`` tuples for each emitted record."""

    def __init__(self) -> None:
        super().__init__()
        self.events: list[tuple[str, object]] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.events.append((record.getMessage(), getattr(record, "latency_ms", None)))


def _make_aggregator(
    threshold_ms: int,
) -> tuple[LatencyAggregator, _CapturingHandler]:
    """Return an aggregator wired to an isolated, non-propagating logger."""
    logger = logging.getLogger(f"test.latency.trigger.{id(object())}")
    logger.handlers.clear()
    logger.propagate = False
    logger.setLevel(logging.DEBUG)
    handler = _CapturingHandler()
    logger.addHandler(handler)
    return LatencyAggregator(threshold_ms=threshold_ms, logger=logger), handler


def _record_n(
    agg: LatencyAggregator,
    *,
    n: int,
    latency_ms: float,
    base_ns: int = _ONE_SECOND_NS,
) -> None:
    """Record ``n`` samples 1ns apart, all inside the rolling window."""
    for i in range(n):
        agg.record("GET", "/v1/trigger", latency_ms, base_ns + i)


def _started(handler: _CapturingHandler) -> list[tuple[str, object]]:
    return [e for e in handler.events if e[0] == _STARTED]


# ---------------------------------------------------------------------------
# Conjunct 1: p95 > threshold (strict)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_triggers_when_p95_one_ms_above_threshold() -> None:
    # Just-above the threshold (threshold + 1) with enough samples and no
    # prior alert: the strict ``>`` must fire exactly once.
    threshold = 200
    agg, handler = _make_aggregator(threshold_ms=threshold)
    _record_n(agg, n=MIN_SAMPLES, latency_ms=float(threshold + 1))
    started = _started(handler)
    assert len(started) == 1
    assert started[0][1] == threshold + 1  # breaching p95 carried as int ms


@pytest.mark.unit
def test_no_trigger_when_p95_equals_threshold() -> None:
    # Equality is NOT a breach (strict greater-than): no emission.
    threshold = 200
    agg, handler = _make_aggregator(threshold_ms=threshold)
    _record_n(agg, n=MIN_SAMPLES, latency_ms=float(threshold))
    assert _started(handler) == []
    assert agg.snapshot(_ONE_SECOND_NS + MIN_SAMPLES)[0].is_alerting is False


@pytest.mark.unit
def test_no_trigger_when_p95_below_threshold() -> None:
    threshold = 200
    agg, handler = _make_aggregator(threshold_ms=threshold)
    _record_n(agg, n=MIN_SAMPLES, latency_ms=float(threshold - 1))
    assert _started(handler) == []


# ---------------------------------------------------------------------------
# Conjunct 2: sample_count >= MIN_SAMPLES (10)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_no_trigger_at_nine_breaching_samples() -> None:
    # One sample short of the floor — even though every sample breaches.
    agg, handler = _make_aggregator(threshold_ms=100)
    _record_n(agg, n=MIN_SAMPLES - 1, latency_ms=999.0)
    assert _started(handler) == []


@pytest.mark.unit
def test_triggers_exactly_on_tenth_breaching_sample() -> None:
    # The 10th breaching sample is the one that crosses the floor and flips
    # the alert; the 9th must have left the handler silent.
    agg, handler = _make_aggregator(threshold_ms=100)
    base = _ONE_SECOND_NS
    for i in range(MIN_SAMPLES - 1):
        agg.record("GET", "/v1/trigger", 999.0, base + i)
    assert _started(handler) == []  # still below the sample floor
    agg.record("GET", "/v1/trigger", 999.0, base + MIN_SAMPLES - 1)  # 10th
    assert len(_started(handler)) == 1  # conjunct 2 satisfied -> fires


# ---------------------------------------------------------------------------
# Conjunct 3: not was_alerting (transition dedup)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_no_re_trigger_while_already_alerting() -> None:
    # Once was_alerting is True, continued breaching with >= MIN_SAMPLES must
    # NOT re-emit started — conjunct 3 (not was_alerting) is false.
    agg, handler = _make_aggregator(threshold_ms=100)
    _record_n(agg, n=MIN_SAMPLES + 8, latency_ms=999.0)
    assert len(_started(handler)) == 1


# ---------------------------------------------------------------------------
# Full conjunction: fires iff all three hold
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize(
    ("n", "latency_ms", "expect_started"),
    [
        (MIN_SAMPLES - 1, 999.0, False),  # conjunct 2 false (too few samples)
        (MIN_SAMPLES, 100.0, False),  # conjunct 1 false (p95 == threshold)
        (MIN_SAMPLES, 50.0, False),  # conjunct 1 false (p95 < threshold)
        (MIN_SAMPLES, 101.0, True),  # all three true -> fires
    ],
)
def test_trigger_conjunction_truth_table(
    n: int, latency_ms: float, expect_started: bool
) -> None:
    agg, handler = _make_aggregator(threshold_ms=100)
    _record_n(agg, n=n, latency_ms=latency_ms)
    assert bool(_started(handler)) is expect_started
