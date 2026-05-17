"""Latency tracker for vendor-wrapped image-edit calls (Sub-AC 9.2).

The Seed Contract pins a hard SLO on this surface: p95 latency from
selfie capture → edited result must stay below **30 seconds**. To know
whether we are honouring that contract — or quietly drifting past it —
the wrapper layer needs an in-process latency log it can roll up into
p50 / p95 / p99 percentiles on demand.

This module is the in-process recorder. It does *not* ship metrics off-
host (that is the observability layer's job); it only provides:

  - `LatencyTracker`   : an accumulator of latency samples (seconds).
  - `LatencyStats`     : immutable summary (`count`, `p50`, `p95`, `p99`,
                         `min`, `max`, `mean`).
  - `track_latency`    : decorator that records the wall-clock duration
                         of a function into a tracker.
  - `measure_latency`  : context-manager equivalent, for the cases the
                         decorator does not fit (closures, ad-hoc blocks).

Why an in-process tracker rather than dispatching every sample straight
to a metrics backend:

  - The vendor wrapper is called on the request-serving path. Pushing a
    metric per call to a remote sink would couple p95 of the edit
    endpoint to p95 of the metrics endpoint — exactly the dependency
    chain we cannot afford under a 30s end-to-end budget.
  - Local accumulation lets the wrapper compute *current-window* SLO
    health (e.g. last N edits) without round-tripping anywhere. The
    observability layer can later poll `LatencyStats` on a slow timer
    and forward it.
  - It is unit-testable. No clock, no network, no flakiness.

Design notes:

  - Samples are stored as a list of non-negative floats (seconds).
    Negative samples are rejected at write time — a negative latency is
    a clock bug, not a measurement, and silently keeping it in the
    histogram would corrupt every downstream percentile.
  - Percentiles use the **nearest-rank** method (NIST recommendation
    for small samples): for percentile `p`, the rank is
    `ceil(p/100 * N)`, 1-indexed against the sorted samples. This is
    the same definition used by Prometheus' `histogram_quantile` with
    exact buckets and avoids interpolation artefacts on tiny N — which
    matters because the wrapper window may be small (dozens of calls)
    before a fresh deploy resets it.
  - `LatencyTracker` is *thread-safe*: the wrapper module may be
    invoked from a thread-pool worker that fans vendor calls out in
    parallel. A `threading.Lock` guards every mutation and read. The
    lock is uncontended in the common case (single producer) and the
    critical section is just an append, so the overhead is negligible
    relative to a 5–8s vendor latency.
  - `LatencyStats` is a frozen dataclass — once returned to a caller,
    no other thread can mutate the snapshot underneath them.
  - The decorator and context manager both accept an injectable
    `clock` callable. Defaults to `time.monotonic` (the right clock
    for measuring elapsed time — wall-clock can jump). Tests pass a
    deterministic stub.
  - `track_latency` records latency *whether or not* the wrapped
    function raises. A request that fails after 25 seconds is still a
    25-second latency event for the user, and burying it would make
    p95 look artificially healthy under load.
"""

from __future__ import annotations

import math
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass
from functools import wraps
from typing import Callable, Final, Iterator, TypeVar


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

#: Percentiles surfaced by `LatencyStats`. Kept as module-level constants
#: so tests, dashboards, and alert thresholds reference the same numbers
#: instead of drifting into "p95 here, p90 there".
P50: Final[float] = 50.0
P95: Final[float] = 95.0
P99: Final[float] = 99.0


# ---------------------------------------------------------------------------
# Stats DTO
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class LatencyStats:
    """Immutable snapshot of a tracker's accumulated samples.

    Attributes:
        count: Number of samples in the snapshot. ``0`` when the
            tracker has never been written to — in that case the
            percentile / min / max / mean fields are all ``0.0``.
            (A more pedantic API would use ``None`` here, but the
            tracker's primary consumer is the SLO dashboard, and
            "no data → 0 latency" renders cleanly while "no data →
            None" requires every downstream chart to special-case.
            Always pair percentile readings with ``count`` before
            alerting.)
        p50: Nearest-rank 50th percentile, seconds.
        p95: Nearest-rank 95th percentile, seconds. The Seed
            Contract's SLO target.
        p99: Nearest-rank 99th percentile, seconds. Tail signal —
            useful for spotting one-in-a-hundred vendor stalls.
        min_seconds: Smallest sample in the window.
        max_seconds: Largest sample in the window.
        mean_seconds: Arithmetic mean of all samples.
    """

    count: int
    p50: float
    p95: float
    p99: float
    min_seconds: float
    max_seconds: float
    mean_seconds: float

    def __post_init__(self) -> None:
        if self.count < 0:
            raise ValueError("count must be >= 0")
        for field_name in (
            "p50",
            "p95",
            "p99",
            "min_seconds",
            "max_seconds",
            "mean_seconds",
        ):
            value = getattr(self, field_name)
            if value < 0:
                raise ValueError(f"{field_name} must be >= 0, got {value!r}")


# ---------------------------------------------------------------------------
# Tracker
# ---------------------------------------------------------------------------


class LatencyTracker:
    """Thread-safe accumulator of latency samples in seconds.

    Typical use::

        tracker = LatencyTracker()

        @track_latency(tracker)
        def edit(selfie: bytes) -> bytes:
            ...

        # Later, on a slow timer:
        stats = tracker.snapshot()
        if stats.p95 > 30.0:
            alert("edit p95 SLO breach")

    The tracker keeps *all* samples it has seen. If you want a sliding
    window, construct a new tracker per window or call `reset()` at the
    window boundary — keeping windowing out of this class avoids the
    "which window is this metric for" ambiguity that ring-buffer
    implementations create. The cost of a flat list is `O(N)` per
    `snapshot()`, which is fine at the call volumes we expect (the
    edit endpoint is throttled by vendor latency, not us).
    """

    __slots__ = ("_samples", "_lock")

    def __init__(self) -> None:
        # `list` rather than `deque`: snapshot() sorts a copy, and
        # `list.sort` is the fastest sort on the CPython platform.
        # A deque buys nothing here and would just complicate slicing.
        self._samples: list[float] = []
        self._lock: threading.Lock = threading.Lock()

    # ----- mutators -----

    def record(self, latency_seconds: float) -> None:
        """Append a latency sample.

        Args:
            latency_seconds: Wall-clock duration of the measured
                operation in seconds. Must be non-negative; negative
                values raise `ValueError` rather than being silently
                clamped — clamping would hide a clock bug.

        Raises:
            TypeError: ``latency_seconds`` is not numeric.
            ValueError: ``latency_seconds`` is negative or NaN.
        """
        if isinstance(latency_seconds, bool) or not isinstance(
            latency_seconds, (int, float)
        ):
            # `bool` is a subclass of `int` in Python — exclude it
            # explicitly so `tracker.record(True)` does not silently
            # land as the latency value `1.0`.
            raise TypeError(
                "latency_seconds must be a real number, "
                f"got {type(latency_seconds).__name__}"
            )
        value = float(latency_seconds)
        if math.isnan(value):
            raise ValueError("latency_seconds must not be NaN")
        if value < 0:
            raise ValueError(
                f"latency_seconds must be >= 0, got {value!r}"
            )
        with self._lock:
            self._samples.append(value)

    def reset(self) -> None:
        """Drop all accumulated samples.

        Use at window boundaries (e.g. start of each minute on a
        slow timer) when sliding-window semantics are desired.
        """
        with self._lock:
            self._samples.clear()

    # ----- readers -----

    def __len__(self) -> int:
        with self._lock:
            return len(self._samples)

    def snapshot(self) -> LatencyStats:
        """Compute a `LatencyStats` summary of the current samples.

        Snapshot semantics: the read takes a defensive copy of the
        sample list under the lock, then releases the lock before
        sorting + percentile math. Concurrent `record()` calls
        observed *after* this point are not reflected in the
        returned snapshot, which is the desired behaviour — a
        snapshot should be a point-in-time view.
        """
        with self._lock:
            samples_copy = list(self._samples)

        n = len(samples_copy)
        if n == 0:
            return LatencyStats(
                count=0,
                p50=0.0,
                p95=0.0,
                p99=0.0,
                min_seconds=0.0,
                max_seconds=0.0,
                mean_seconds=0.0,
            )

        samples_copy.sort()
        return LatencyStats(
            count=n,
            p50=_nearest_rank_percentile(samples_copy, P50),
            p95=_nearest_rank_percentile(samples_copy, P95),
            p99=_nearest_rank_percentile(samples_copy, P99),
            min_seconds=samples_copy[0],
            max_seconds=samples_copy[-1],
            mean_seconds=sum(samples_copy) / n,
        )


# ---------------------------------------------------------------------------
# Decorator + context manager
# ---------------------------------------------------------------------------


F = TypeVar("F", bound=Callable[..., object])


def track_latency(
    tracker: LatencyTracker,
    *,
    clock: Callable[[], float] = time.monotonic,
) -> Callable[[F], F]:
    """Decorator that records each call's duration into ``tracker``.

    The duration is recorded *whether or not* the wrapped function
    raises. A failed call still consumed real wall-clock time from the
    user's perspective; suppressing it from the histogram would let a
    vendor whose only failure mode is "timeout at 30 seconds" look
    healthy in the SLO dashboard.

    Args:
        tracker: Destination accumulator.
        clock: Injectable monotonic clock. Default is `time.monotonic`,
            which is the right choice for measuring elapsed time
            (wall-clock can jump backward on NTP corrections).

    Returns:
        A decorator. Use as ``@track_latency(my_tracker)`` on the
        function you want to measure.

    Raises:
        TypeError: ``tracker`` is not a `LatencyTracker`, or ``clock``
            is not callable. Raised at decoration time so a misuse
            fails at import, not on the first request.
    """
    if not isinstance(tracker, LatencyTracker):
        raise TypeError(
            f"tracker must be LatencyTracker, got {type(tracker).__name__}"
        )
    if not callable(clock):
        raise TypeError("clock must be callable")

    def decorator(func: F) -> F:
        @wraps(func)
        def wrapper(*args: object, **kwargs: object) -> object:
            start = clock()
            try:
                return func(*args, **kwargs)
            finally:
                elapsed = clock() - start
                # Defend against a non-monotonic injected clock in
                # tests: never record a negative sample.
                if elapsed < 0:
                    elapsed = 0.0
                tracker.record(elapsed)

        return wrapper  # type: ignore[return-value]

    return decorator


@contextmanager
def measure_latency(
    tracker: LatencyTracker,
    *,
    clock: Callable[[], float] = time.monotonic,
) -> Iterator[None]:
    """Context-manager equivalent of `track_latency`.

    Useful when the measured region is not a whole function — e.g.::

        with measure_latency(tracker):
            edited = vendor_caller(request, timeout)

    Same recording semantics as the decorator: duration is logged on
    exit whether the block raised or not.
    """
    if not isinstance(tracker, LatencyTracker):
        raise TypeError(
            f"tracker must be LatencyTracker, got {type(tracker).__name__}"
        )
    if not callable(clock):
        raise TypeError("clock must be callable")

    start = clock()
    try:
        yield
    finally:
        elapsed = clock() - start
        if elapsed < 0:
            elapsed = 0.0
        tracker.record(elapsed)


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------


def _nearest_rank_percentile(sorted_samples: list[float], percentile: float) -> float:
    """Nearest-rank percentile on a *pre-sorted* sample list.

    Definition (NIST 1-indexed):
        rank = ceil(percentile / 100 * N)

    Returns the sample at ``rank - 1`` in 0-indexed Python terms,
    clamped to the valid range so an off-by-one in `percentile` (say
    100.0001 from a float-math caller) does not raise `IndexError`.

    Pre-sorted is a hard precondition — callers (only `snapshot()`
    today) sort once for all three percentiles, which is `O(N log N)`
    instead of `O(N log N) * 3` if each percentile sorted on its own.
    """
    if not sorted_samples:
        # Defensive: callers should already early-return on empty.
        # Keeping this here means a future caller cannot quietly
        # divide by zero or index into an empty list.
        return 0.0
    if not 0.0 <= percentile <= 100.0:
        raise ValueError(
            f"percentile must be in [0, 100], got {percentile!r}"
        )
    n = len(sorted_samples)
    # `max(1, ...)` so percentile = 0 still resolves to the smallest
    # element rather than rank 0 (which would be index -1).
    rank = max(1, math.ceil(percentile / 100.0 * n))
    # Clamp to last valid index — guards against any float-math edge
    # where `ceil` yields `n + 1`.
    index = min(rank - 1, n - 1)
    return sorted_samples[index]
