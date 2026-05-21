"""Unit tests for `latency_tracker` (Sub-AC 9.2).

These tests use deterministic injected clocks instead of real
`time.monotonic`, so the suite is fast (< 200ms total) and never flaky
on CI even under load. The percentile maths is exercised against
hand-computed expected values on small sample sets where the answer
is unambiguous under nearest-rank — that catches off-by-one regressions
in `_nearest_rank_percentile` without needing a property-based fuzzer.

Coverage matrix:

  LatencyTracker basics
    - test_new_tracker_is_empty
    - test_record_appends_sample
    - test_reset_drops_all_samples
    - test_len_reflects_count

  Validation
    - test_record_rejects_negative_latency
    - test_record_rejects_nan_latency
    - test_record_rejects_non_numeric_latency
    - test_record_rejects_bool_latency
    - test_record_accepts_int_and_float

  Snapshot / percentiles
    - test_snapshot_empty_tracker_returns_zeros
    - test_snapshot_single_sample_percentiles_collapse
    - test_snapshot_percentiles_nearest_rank_known_dataset
    - test_snapshot_percentiles_unsorted_input
    - test_snapshot_min_max_mean_correct
    - test_snapshot_p99_on_100_sample_dataset
    - test_snapshot_is_immutable
    - test_snapshot_independent_of_future_records

  Decorator (`track_latency`)
    - test_decorator_records_elapsed_on_success
    - test_decorator_records_elapsed_on_exception
    - test_decorator_preserves_function_metadata
    - test_decorator_returns_wrapped_function_value
    - test_decorator_rejects_non_tracker
    - test_decorator_rejects_non_callable_clock
    - test_decorator_clamps_non_monotonic_clock

  Context manager (`measure_latency`)
    - test_context_manager_records_elapsed_on_success
    - test_context_manager_records_elapsed_on_exception
    - test_context_manager_rejects_non_tracker

  Thread safety
    - test_record_is_thread_safe
"""

from __future__ import annotations

import math
import threading
from typing import Iterator

import pytest

from image_edit.latency_tracker import (
    LatencyStats,
    LatencyTracker,
    measure_latency,
    track_latency,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


class _FakeClock:
    """Deterministic monotonic clock walking a pre-seeded list.

    The decorator and context manager each call the clock exactly
    twice per measured block (start + finish), so the test simply
    feeds in `[t0, t1, t0', t1', ...]` matching the call order.
    """

    def __init__(self, ticks: list[float]) -> None:
        self._ticks: Iterator[float] = iter(list(ticks))

    def __call__(self) -> float:
        try:
            return next(self._ticks)
        except StopIteration as exc:  # pragma: no cover - test bug
            raise AssertionError(
                "FakeClock exhausted: a measured block called the clock "
                "more times than the test seeded"
            ) from exc


# ---------------------------------------------------------------------------
# LatencyTracker basics
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_new_tracker_is_empty() -> None:
    tracker = LatencyTracker()
    assert len(tracker) == 0
    assert tracker.snapshot().count == 0


@pytest.mark.unit
def test_record_appends_sample() -> None:
    tracker = LatencyTracker()
    tracker.record(0.5)
    tracker.record(1.5)
    assert len(tracker) == 2


@pytest.mark.unit
def test_reset_drops_all_samples() -> None:
    tracker = LatencyTracker()
    for v in (0.1, 0.2, 0.3):
        tracker.record(v)
    tracker.reset()
    assert len(tracker) == 0
    assert tracker.snapshot().count == 0


@pytest.mark.unit
def test_len_reflects_count() -> None:
    tracker = LatencyTracker()
    for i in range(7):
        tracker.record(float(i))
    assert len(tracker) == 7


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_record_rejects_negative_latency() -> None:
    tracker = LatencyTracker()
    with pytest.raises(ValueError, match=">= 0"):
        tracker.record(-0.001)


@pytest.mark.unit
def test_record_rejects_nan_latency() -> None:
    tracker = LatencyTracker()
    with pytest.raises(ValueError, match="NaN"):
        tracker.record(math.nan)


@pytest.mark.unit
def test_record_rejects_non_numeric_latency() -> None:
    tracker = LatencyTracker()
    with pytest.raises(TypeError):
        tracker.record("0.5")  # type: ignore[arg-type]


@pytest.mark.unit
def test_record_rejects_bool_latency() -> None:
    # `bool` is a subclass of `int` in Python — guard against
    # `tracker.record(True)` silently landing as `1.0`.
    tracker = LatencyTracker()
    with pytest.raises(TypeError):
        tracker.record(True)  # type: ignore[arg-type]


@pytest.mark.unit
def test_record_accepts_int_and_float() -> None:
    tracker = LatencyTracker()
    tracker.record(2)
    tracker.record(3.5)
    stats = tracker.snapshot()
    assert stats.count == 2
    assert stats.min_seconds == pytest.approx(2.0)
    assert stats.max_seconds == pytest.approx(3.5)


# ---------------------------------------------------------------------------
# Snapshot / percentiles
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_snapshot_empty_tracker_returns_zeros() -> None:
    stats = LatencyTracker().snapshot()
    assert stats.count == 0
    assert stats.p50 == 0.0
    assert stats.p95 == 0.0
    assert stats.p99 == 0.0
    assert stats.min_seconds == 0.0
    assert stats.max_seconds == 0.0
    assert stats.mean_seconds == 0.0


@pytest.mark.unit
def test_snapshot_single_sample_percentiles_collapse() -> None:
    # With N=1, every percentile resolves to the only sample.
    tracker = LatencyTracker()
    tracker.record(4.2)
    stats = tracker.snapshot()
    assert stats.count == 1
    assert stats.p50 == pytest.approx(4.2)
    assert stats.p95 == pytest.approx(4.2)
    assert stats.p99 == pytest.approx(4.2)
    assert stats.min_seconds == pytest.approx(4.2)
    assert stats.max_seconds == pytest.approx(4.2)
    assert stats.mean_seconds == pytest.approx(4.2)


@pytest.mark.unit
def test_snapshot_percentiles_nearest_rank_known_dataset() -> None:
    # 10 samples 1..10. Nearest-rank:
    #   p50 → rank = ceil(0.50 * 10) = 5 → samples[4] = 5
    #   p95 → rank = ceil(0.95 * 10) = 10 → samples[9] = 10
    #   p99 → rank = ceil(0.99 * 10) = 10 → samples[9] = 10
    tracker = LatencyTracker()
    for v in range(1, 11):
        tracker.record(float(v))
    stats = tracker.snapshot()
    assert stats.count == 10
    assert stats.p50 == pytest.approx(5.0)
    assert stats.p95 == pytest.approx(10.0)
    assert stats.p99 == pytest.approx(10.0)


@pytest.mark.unit
def test_snapshot_percentiles_unsorted_input() -> None:
    # Insertion order must not affect the answer — snapshot sorts.
    tracker = LatencyTracker()
    for v in (7, 2, 5, 9, 1, 8, 3, 6, 4, 10):
        tracker.record(float(v))
    stats = tracker.snapshot()
    assert stats.p50 == pytest.approx(5.0)
    assert stats.p95 == pytest.approx(10.0)
    assert stats.min_seconds == pytest.approx(1.0)
    assert stats.max_seconds == pytest.approx(10.0)


@pytest.mark.unit
def test_snapshot_min_max_mean_correct() -> None:
    tracker = LatencyTracker()
    for v in (1.0, 2.0, 3.0, 4.0, 5.0):
        tracker.record(v)
    stats = tracker.snapshot()
    assert stats.min_seconds == pytest.approx(1.0)
    assert stats.max_seconds == pytest.approx(5.0)
    assert stats.mean_seconds == pytest.approx(3.0)


@pytest.mark.unit
def test_snapshot_p99_on_100_sample_dataset() -> None:
    # 100 samples 1..100. Nearest-rank:
    #   p50 → rank = 50 → samples[49] = 50
    #   p95 → rank = 95 → samples[94] = 95
    #   p99 → rank = 99 → samples[98] = 99
    # This catches a classic off-by-one where p99 returns 100 instead.
    tracker = LatencyTracker()
    for v in range(1, 101):
        tracker.record(float(v))
    stats = tracker.snapshot()
    assert stats.count == 100
    assert stats.p50 == pytest.approx(50.0)
    assert stats.p95 == pytest.approx(95.0)
    assert stats.p99 == pytest.approx(99.0)


@pytest.mark.unit
def test_snapshot_is_immutable() -> None:
    tracker = LatencyTracker()
    tracker.record(1.0)
    stats = tracker.snapshot()
    # `LatencyStats` is a frozen dataclass — direct field assignment
    # must raise.
    with pytest.raises(Exception):  # FrozenInstanceError is a subclass
        stats.count = 99  # type: ignore[misc]


@pytest.mark.unit
def test_snapshot_independent_of_future_records() -> None:
    # A snapshot is a point-in-time view; later writes must not
    # mutate it.
    tracker = LatencyTracker()
    tracker.record(1.0)
    snap = tracker.snapshot()
    tracker.record(99.0)
    assert snap.count == 1
    assert snap.max_seconds == pytest.approx(1.0)


# ---------------------------------------------------------------------------
# Decorator
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_decorator_records_elapsed_on_success() -> None:
    tracker = LatencyTracker()
    clock = _FakeClock([100.0, 100.75])  # start, end

    @track_latency(tracker, clock=clock)
    def edit() -> str:
        return "ok"

    assert edit() == "ok"
    stats = tracker.snapshot()
    assert stats.count == 1
    assert stats.max_seconds == pytest.approx(0.75)


@pytest.mark.unit
def test_decorator_records_elapsed_on_exception() -> None:
    # A failed call still consumed wall-clock time — record it so the
    # SLO dashboard does not under-count tail latency.
    tracker = LatencyTracker()
    clock = _FakeClock([0.0, 2.5])

    @track_latency(tracker, clock=clock)
    def boom() -> None:
        raise RuntimeError("vendor down")

    with pytest.raises(RuntimeError, match="vendor down"):
        boom()
    stats = tracker.snapshot()
    assert stats.count == 1
    assert stats.max_seconds == pytest.approx(2.5)


@pytest.mark.unit
def test_decorator_preserves_function_metadata() -> None:
    tracker = LatencyTracker()

    @track_latency(tracker)
    def edit_selfie(x: int) -> int:
        """Edit a selfie."""
        return x

    assert edit_selfie.__name__ == "edit_selfie"
    assert edit_selfie.__doc__ == "Edit a selfie."


@pytest.mark.unit
def test_decorator_returns_wrapped_function_value() -> None:
    tracker = LatencyTracker()
    clock = _FakeClock([0.0, 0.1])

    @track_latency(tracker, clock=clock)
    def add(a: int, b: int) -> int:
        return a + b

    assert add(2, 3) == 5


@pytest.mark.unit
def test_decorator_rejects_non_tracker() -> None:
    with pytest.raises(TypeError, match="LatencyTracker"):
        track_latency("not a tracker")  # type: ignore[arg-type]


@pytest.mark.unit
def test_decorator_rejects_non_callable_clock() -> None:
    with pytest.raises(TypeError, match="clock"):
        track_latency(LatencyTracker(), clock="not callable")  # type: ignore[arg-type]


@pytest.mark.unit
def test_decorator_clamps_non_monotonic_clock() -> None:
    # If an injected clock somehow goes backward, the recorded latency
    # must still be a valid non-negative sample.
    tracker = LatencyTracker()
    clock = _FakeClock([10.0, 5.0])

    @track_latency(tracker, clock=clock)
    def noop() -> None:
        return None

    noop()
    stats = tracker.snapshot()
    assert stats.count == 1
    assert stats.max_seconds == 0.0


# ---------------------------------------------------------------------------
# Context manager
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_context_manager_records_elapsed_on_success() -> None:
    tracker = LatencyTracker()
    clock = _FakeClock([1.0, 1.4])
    with measure_latency(tracker, clock=clock):
        pass
    stats = tracker.snapshot()
    assert stats.count == 1
    assert stats.max_seconds == pytest.approx(0.4)


@pytest.mark.unit
def test_context_manager_records_elapsed_on_exception() -> None:
    tracker = LatencyTracker()
    clock = _FakeClock([0.0, 3.0])
    with pytest.raises(ValueError, match="bad input"):
        with measure_latency(tracker, clock=clock):
            raise ValueError("bad input")
    stats = tracker.snapshot()
    assert stats.count == 1
    assert stats.max_seconds == pytest.approx(3.0)


@pytest.mark.unit
def test_context_manager_rejects_non_tracker() -> None:
    with pytest.raises(TypeError, match="LatencyTracker"):
        with measure_latency("not a tracker"):  # type: ignore[arg-type]
            pass


# ---------------------------------------------------------------------------
# Thread safety
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_record_is_thread_safe() -> None:
    # Many threads each appending samples must not lose any of them.
    # We don't assert on percentiles here — only on total count, which
    # is the property the lock is supposed to guarantee.
    tracker = LatencyTracker()
    samples_per_thread = 200
    n_threads = 8

    def writer() -> None:
        for i in range(samples_per_thread):
            tracker.record(float(i) / 1000.0)

    threads = [threading.Thread(target=writer) for _ in range(n_threads)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert len(tracker) == n_threads * samples_per_thread
    assert tracker.snapshot().count == n_threads * samples_per_thread


# ---------------------------------------------------------------------------
# LatencyStats DTO validation (defensive — constructed by tracker today,
# but a future caller might build one directly for a report)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_latency_stats_rejects_negative_count() -> None:
    with pytest.raises(ValueError, match="count"):
        LatencyStats(
            count=-1,
            p50=0.0,
            p95=0.0,
            p99=0.0,
            min_seconds=0.0,
            max_seconds=0.0,
            mean_seconds=0.0,
        )


@pytest.mark.unit
def test_latency_stats_rejects_negative_percentile() -> None:
    with pytest.raises(ValueError, match="p95"):
        LatencyStats(
            count=1,
            p50=0.0,
            p95=-0.001,
            p99=0.0,
            min_seconds=0.0,
            max_seconds=0.0,
            mean_seconds=0.0,
        )
