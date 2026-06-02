"""Unit tests for the in-process latency aggregator (Phase 7.1).

Covers the Seed's correctness + alert-fidelity + memory-safety pillars:

    * nearest-rank percentile math on known vectors (incl. int truncation),
    * the ``MIN_SAMPLES`` (10) floor — percentiles are ``None`` below it,
    * 60-second rolling-window pruning (lazy, on record + snapshot),
    * ``MAX_SAMPLES_PER_BUCKET`` (1024) FIFO eviction,
    * transition-based P95 alerting: fires ``request_slow_started`` exactly
      once on breach, ``request_slow_recovered`` exactly once on recovery,
      and never on insufficient samples,
    * empty-window / unknown-bucket behaviour.

All tests drive :class:`LatencyAggregator` directly with explicit
``timestamp_ns`` values (no real clock) so the rolling window is
deterministic.
"""

from __future__ import annotations

import logging
from dataclasses import FrozenInstanceError

import pytest

from api.services.latency_aggregator import (
    MAX_SAMPLES_PER_BUCKET,
    MIN_SAMPLES,
    WINDOW_SECONDS,
    LatencyAggregator,
    LatencyBucket,
    nearest_rank,
)

#: One second in nanoseconds (the ``perf_counter_ns`` unit the aggregator uses).
_ONE_SECOND_NS = 1_000_000_000
#: Window length expressed in ns.
_WINDOW_NS = WINDOW_SECONDS * _ONE_SECOND_NS


class _CapturingHandler(logging.Handler):
    """Collect ``(message, latency_ms, method, path)`` tuples per record."""

    def __init__(self) -> None:
        super().__init__()
        self.events: list[tuple[str, object, object, object]] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.events.append(
            (
                record.getMessage(),
                getattr(record, "latency_ms", None),
                getattr(record, "method", None),
                getattr(record, "path", None),
            )
        )


def _make_aggregator(
    threshold_ms: int = 100,
) -> tuple[LatencyAggregator, _CapturingHandler]:
    """Return an aggregator wired to an isolated capturing logger."""
    logger = logging.getLogger(f"test.latency.{id(object())}")
    logger.handlers.clear()
    logger.propagate = False
    logger.setLevel(logging.DEBUG)
    handler = _CapturingHandler()
    logger.addHandler(handler)
    return LatencyAggregator(threshold_ms=threshold_ms, logger=logger), handler


# ---------------------------------------------------------------------------
# nearest-rank percentile math
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_nearest_rank_ten_samples_one_to_ten() -> None:
    samples = [float(v) for v in range(1, 11)]  # 1.0 .. 10.0
    assert nearest_rank(samples, 50) == 5
    assert nearest_rank(samples, 95) == 10
    assert nearest_rank(samples, 99) == 10


@pytest.mark.unit
def test_nearest_rank_hundred_samples() -> None:
    samples = [float(v) for v in range(1, 101)]  # 1.0 .. 100.0
    assert nearest_rank(samples, 50) == 50
    assert nearest_rank(samples, 95) == 95
    assert nearest_rank(samples, 99) == 99


@pytest.mark.unit
def test_nearest_rank_truncates_to_int() -> None:
    # A single fractional sample must truncate (not round) to int ms.
    assert nearest_rank([5.9], 95) == 5
    assert nearest_rank([12.99, 12.99], 50) == 12


@pytest.mark.unit
def test_nearest_rank_empty_raises() -> None:
    with pytest.raises(ValueError):
        nearest_rank([], 95)


# ---------------------------------------------------------------------------
# MIN_SAMPLES floor + empty-window behaviour
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_snapshot_empty_aggregator_returns_no_buckets() -> None:
    agg, _ = _make_aggregator()
    assert agg.snapshot(_ONE_SECOND_NS) == []


@pytest.mark.unit
def test_percentiles_none_below_min_samples() -> None:
    agg, _ = _make_aggregator()
    base = _ONE_SECOND_NS
    for i in range(MIN_SAMPLES - 1):  # 9 samples — one short of the floor
        agg.record("GET", "/v1/x", 50.0, base + i)
    buckets = agg.snapshot(base + MIN_SAMPLES)
    assert len(buckets) == 1
    bucket = buckets[0]
    assert bucket.sample_count == MIN_SAMPLES - 1
    assert bucket.p50_ms is None
    assert bucket.p95_ms is None
    assert bucket.p99_ms is None
    assert bucket.is_alerting is False


@pytest.mark.unit
def test_percentiles_present_at_min_samples() -> None:
    agg, _ = _make_aggregator()
    base = _ONE_SECOND_NS
    for i in range(MIN_SAMPLES):
        agg.record("GET", "/v1/x", float(i + 1), base + i)  # 1..10 ms
    bucket = agg.snapshot(base + MIN_SAMPLES)[0]
    assert bucket.sample_count == MIN_SAMPLES
    assert bucket.p50_ms == 5
    assert bucket.p95_ms == 10
    assert bucket.p99_ms == 10
    assert isinstance(bucket, LatencyBucket)


# ---------------------------------------------------------------------------
# rolling-window pruning + FIFO bound
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_window_prunes_samples_older_than_60s() -> None:
    agg, _ = _make_aggregator()
    base = _ONE_SECOND_NS
    # 10 old samples at t≈base.
    for i in range(MIN_SAMPLES):
        agg.record("GET", "/v1/x", 500.0, base + i)
    # Snapshot well past the window: every old sample must have aged out.
    later = base + _WINDOW_NS + _ONE_SECOND_NS
    bucket = agg.snapshot(later)[0]
    assert bucket.sample_count == 0
    assert bucket.p95_ms is None


@pytest.mark.unit
def test_record_prunes_aged_samples_before_evaluating() -> None:
    agg, _ = _make_aggregator()
    base = _ONE_SECOND_NS
    for i in range(MIN_SAMPLES):
        agg.record("GET", "/v1/x", 10.0, base + i)
    # A fresh sample > 60s later should evict all the originals on record().
    fresh_ts = base + _WINDOW_NS + _ONE_SECOND_NS
    agg.record("GET", "/v1/x", 10.0, fresh_ts)
    bucket = agg.snapshot(fresh_ts)[0]
    assert bucket.sample_count == 1


@pytest.mark.unit
def test_bucket_capped_at_max_samples() -> None:
    agg, _ = _make_aggregator()
    base = _ONE_SECOND_NS
    # Push more than the cap, all inside the window (1ns apart).
    for i in range(MAX_SAMPLES_PER_BUCKET + 200):
        agg.record("GET", "/v1/x", 1.0, base + i)
    bucket = agg.snapshot(base + MAX_SAMPLES_PER_BUCKET + 200)[0]
    assert bucket.sample_count == MAX_SAMPLES_PER_BUCKET


@pytest.mark.unit
def test_distinct_method_path_form_distinct_buckets() -> None:
    agg, _ = _make_aggregator()
    base = _ONE_SECOND_NS
    agg.record("GET", "/v1/a", 1.0, base)
    agg.record("POST", "/v1/a", 1.0, base + 1)
    agg.record("GET", "/v1/b", 1.0, base + 2)
    buckets = agg.snapshot(base + 3)
    keys = {(b.method, b.path_template) for b in buckets}
    assert keys == {("GET", "/v1/a"), ("POST", "/v1/a"), ("GET", "/v1/b")}


# ---------------------------------------------------------------------------
# transition-based P95 alerting
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_no_alert_below_min_samples() -> None:
    agg, handler = _make_aggregator(threshold_ms=100)
    base = _ONE_SECOND_NS
    for i in range(MIN_SAMPLES - 1):  # 9 breaching samples, still under floor
        agg.record("GET", "/v1/slow", 999.0, base + i)
    assert handler.events == []


@pytest.mark.unit
def test_alert_fires_once_on_breach() -> None:
    agg, handler = _make_aggregator(threshold_ms=100)
    base = _ONE_SECOND_NS
    for i in range(MIN_SAMPLES):  # 10 samples @ 999ms > 100ms threshold
        agg.record("GET", "/v1/slow", 999.0, base + i)
    started = [e for e in handler.events if e[0] == "request_slow_started"]
    assert len(started) == 1
    # The alert carries the breaching P95 as latency_ms + the bucket identity.
    assert started[0][1] == 999  # p95 (int)
    assert started[0][2] == "GET"
    assert started[0][3] == "/v1/slow"
    # Snapshot reflects the live alert state.
    assert agg.snapshot(base + MIN_SAMPLES)[0].is_alerting is True


@pytest.mark.unit
def test_alert_not_re_emitted_while_still_breaching() -> None:
    agg, handler = _make_aggregator(threshold_ms=100)
    base = _ONE_SECOND_NS
    for i in range(MIN_SAMPLES + 5):  # keep breaching well past the trigger
        agg.record("GET", "/v1/slow", 999.0, base + i)
    started = [e for e in handler.events if e[0] == "request_slow_started"]
    assert len(started) == 1  # exactly once, no spurious repeats


@pytest.mark.unit
def test_alert_recovers_once_then_silent() -> None:
    agg, handler = _make_aggregator(threshold_ms=100)
    base = _ONE_SECOND_NS
    # Breach: 10 slow samples.
    for i in range(MIN_SAMPLES):
        agg.record("GET", "/v1/slow", 999.0, base + i)
    # Recovery: 10 fast samples > 60s later (old slow ones prune away).
    recover_base = base + _WINDOW_NS + _ONE_SECOND_NS
    for i in range(MIN_SAMPLES):
        agg.record("GET", "/v1/slow", 10.0, recover_base + i)
    started = [e for e in handler.events if e[0] == "request_slow_started"]
    recovered = [e for e in handler.events if e[0] == "request_slow_recovered"]
    assert len(started) == 1
    assert len(recovered) == 1
    assert recovered[0][1] == 10  # recovering p95 (int)
    assert agg.snapshot(recover_base + MIN_SAMPLES)[0].is_alerting is False


@pytest.mark.unit
def test_p95_exactly_at_threshold_does_not_alert() -> None:
    # Breach is strict ``>`` — a P95 equal to the threshold must not alert.
    agg, handler = _make_aggregator(threshold_ms=500)
    base = _ONE_SECOND_NS
    for i in range(MIN_SAMPLES):
        agg.record("GET", "/v1/edge", 500.0, base + i)
    assert handler.events == []
    assert agg.snapshot(base + MIN_SAMPLES)[0].is_alerting is False


@pytest.mark.unit
def test_alert_state_initialized_false_for_unknown_bucket() -> None:
    # was_alerting defaults False: a bucket that never breaches reports
    # is_alerting False even once it crosses MIN_SAMPLES with fast samples.
    agg, handler = _make_aggregator(threshold_ms=100)
    base = _ONE_SECOND_NS
    for i in range(MIN_SAMPLES):
        agg.record("GET", "/v1/fast", 10.0, base + i)
    assert handler.events == []
    assert agg.snapshot(base + MIN_SAMPLES)[0].is_alerting is False


@pytest.mark.unit
def test_alert_refires_on_rebreach_after_recovery() -> None:
    # Each threshold crossing is its own transition: breach -> recover ->
    # breach must emit started TWICE and recovered ONCE (no dedup across
    # separate crossings).
    agg, handler = _make_aggregator(threshold_ms=100)
    base = _ONE_SECOND_NS
    # First breach.
    for i in range(MIN_SAMPLES):
        agg.record("GET", "/v1/slow", 999.0, base + i)
    # Recovery a full window later (slow samples prune away).
    recover_base = base + _WINDOW_NS + _ONE_SECOND_NS
    for i in range(MIN_SAMPLES):
        agg.record("GET", "/v1/slow", 10.0, recover_base + i)
    # Second breach another full window later (fast samples prune away).
    rebreach_base = recover_base + _WINDOW_NS + _ONE_SECOND_NS
    for i in range(MIN_SAMPLES):
        agg.record("GET", "/v1/slow", 999.0, rebreach_base + i)
    started = [e for e in handler.events if e[0] == "request_slow_started"]
    recovered = [e for e in handler.events if e[0] == "request_slow_recovered"]
    assert len(started) == 2
    assert len(recovered) == 1
    assert agg.snapshot(rebreach_base + MIN_SAMPLES)[0].is_alerting is True


@pytest.mark.unit
def test_alert_state_frozen_when_samples_drop_below_min() -> None:
    # State changes only with sufficient samples: once alerting, if the
    # window prunes below MIN_SAMPLES the bucket must NOT emit a recovery and
    # must retain its alerting state (no transition on insufficient samples).
    agg, handler = _make_aggregator(threshold_ms=100)
    base = _ONE_SECOND_NS
    for i in range(MIN_SAMPLES):
        agg.record("GET", "/v1/slow", 999.0, base + i)
    assert agg.snapshot(base + MIN_SAMPLES)[0].is_alerting is True
    # One fresh breaching sample > 60s later prunes all originals: the bucket
    # now holds a single sample (< MIN_SAMPLES), so _evaluate_alert short-
    # circuits and the alert state is left untouched.
    fresh_ts = base + _WINDOW_NS + _ONE_SECOND_NS
    agg.record("GET", "/v1/slow", 999.0, fresh_ts)
    recovered = [e for e in handler.events if e[0] == "request_slow_recovered"]
    assert recovered == []  # no recovery emitted on insufficient samples
    bucket = agg.snapshot(fresh_ts)[0]
    assert bucket.sample_count == 1
    assert bucket.is_alerting is True  # state frozen, not flipped


@pytest.mark.unit
def test_window_and_threshold_accessors() -> None:
    agg, _ = _make_aggregator(threshold_ms=250)
    assert agg.window_seconds == 60
    assert agg.threshold_ms == 250


@pytest.mark.unit
def test_latency_bucket_is_frozen_immutable() -> None:
    # Per coding-style.md, LatencyBucket must be a frozen dataclass: any
    # attribute assignment after construction raises FrozenInstanceError and
    # leaves the original instance unchanged (immutable snapshot contract).
    bucket = LatencyBucket(
        method="GET",
        path_template="/v1/slow",
        sample_count=42,
        p50_ms=10,
        p95_ms=480,
        p99_ms=600,
        is_alerting=False,
    )
    with pytest.raises(FrozenInstanceError):
        bucket.p95_ms = 999  # type: ignore[misc]
    with pytest.raises(FrozenInstanceError):
        bucket.is_alerting = True  # type: ignore[misc]
    # Original values preserved — no in-place mutation slipped through.
    assert bucket.p95_ms == 480
    assert bucket.is_alerting is False


@pytest.mark.unit
def test_latency_bucket_snapshot_instances_are_frozen() -> None:
    # The instances produced by snapshot() are the same frozen type, so the
    # endpoint cannot mutate aggregator-owned state through them.
    agg, _ = _make_aggregator(threshold_ms=100)
    base = _ONE_SECOND_NS
    for i in range(MIN_SAMPLES):
        agg.record("GET", "/v1/slow", 50.0, base + i)
    bucket = agg.snapshot(base + MIN_SAMPLES)[0]
    assert isinstance(bucket, LatencyBucket)
    with pytest.raises(FrozenInstanceError):
        bucket.sample_count = 0  # type: ignore[misc]
