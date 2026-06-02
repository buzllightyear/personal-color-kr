"""In-process request-latency aggregator (Phase 7.1).

A single :class:`LatencyAggregator` instance lives on
``app.state.latency_aggregator`` for the lifetime of one uvicorn worker
(MVP: a single worker, no cross-process aggregation). The request_id
middleware feeds it one ``(method, path_template, latency_ms)`` sample per
completed request; the ``GET /v1/metrics/latency`` endpoint reads a
:func:`LatencyAggregator.snapshot` of the current state.

Design contract (Seed-pinned):

* **Rolling window** — each ``(method, path_template)`` bucket keeps the
  samples observed in the last ``WINDOW_SECONDS`` (60s). Pruning is *lazy*:
  it happens on :meth:`record` and :meth:`snapshot`, never on a background
  timer or scheduler.
* **Bounded memory** — every bucket is a ``collections.deque`` with
  ``maxlen = MAX_SAMPLES_PER_BUCKET`` (1024), giving FIFO eviction on top
  of the time-window prune. Bucket cardinality is itself bounded because
  ``path_template`` is the matched route template (a static set), not the
  raw request path.
* **Percentiles** — P50 / P95 / P99 via the classic *nearest-rank*
  algorithm over the sorted in-window samples, returned as truncated
  ``int`` milliseconds. Percentiles are ``None`` until a bucket has at
  least ``MIN_SAMPLES`` (10) samples.
* **Transition-based alerting** — when a bucket's P95 first *exceeds* the
  configured threshold (with >= ``MIN_SAMPLES`` samples) a
  ``request_slow_started`` record is emitted exactly once; when it later
  recovers to <= threshold a ``request_slow_recovered`` record is emitted
  exactly once. No spurious re-emissions while the state is unchanged.

Concurrency assumption (documented, not enforced): this module uses **no**
``asyncio.Lock``. Under the cooperative single-threaded asyncio scheduler
both :meth:`record` and :meth:`snapshot` run start-to-finish with no
``await`` inside, so they cannot interleave with one another. A future
multi-worker / threaded deployment (Phase 7.2+) would need a different
synchronisation story.

Pure-Python only: no ``numpy``, no ``statistics`` — just ``sorted`` plus
indexing and ``math.ceil``.
"""

from __future__ import annotations

import logging
import math
from collections import deque
from dataclasses import dataclass
from typing import Deque, Final

#: Logger shared with ``api.config.logging`` so alert records emit under the
#: same ``apps.api`` JSON root as the per-request middleware logs.
_LOGGER_NAME: Final[str] = "apps.api"

#: Rolling-window duration in seconds (fixed by the Seed).
WINDOW_SECONDS: Final[int] = 60

#: Per-bucket deque cap. FIFO eviction past this many samples bounds memory
#: independently of the time-window prune.
MAX_SAMPLES_PER_BUCKET: Final[int] = 1024

#: Minimum in-window samples before percentiles are computed or an alert is
#: evaluated. Below this a bucket reports ``None`` percentiles and its alert
#: state is left untouched (no emission on insufficient samples).
MIN_SAMPLES: Final[int] = 10

#: ``WINDOW_SECONDS`` expressed in nanoseconds to match ``perf_counter_ns``.
_WINDOW_NS: Final[int] = WINDOW_SECONDS * 1_000_000_000

#: Default P95 alert threshold (ms) used when the env var is unset/invalid.
DEFAULT_P95_THRESHOLD_MS: Final[int] = 500


@dataclass(frozen=True)
class LatencyBucket:
    """Immutable snapshot of one ``(method, path_template)`` bucket.

    Percentile fields are ``None`` when the bucket holds fewer than
    :data:`MIN_SAMPLES` samples in the current window.
    """

    method: str
    path_template: str
    sample_count: int
    p50_ms: int | None
    p95_ms: int | None
    p99_ms: int | None
    is_alerting: bool


def nearest_rank(sorted_samples: list[float], percentile: int) -> int:
    """Return the ``percentile``-th value via the nearest-rank algorithm.

    The rank index is ``max(0, ceil(p / 100 * n) - 1)`` over the
    already-sorted ``sorted_samples`` (length ``n``). The selected float is
    truncated to ``int`` milliseconds (Seed: integer percentile output).

    Parameters
    ----------
    sorted_samples:
        Latency samples in ascending order. Must be non-empty.
    percentile:
        The percentile to compute (e.g. ``50``, ``95``, ``99``).

    Raises
    ------
    ValueError
        If ``sorted_samples`` is empty (caller must gate on sample count).
    """
    n = len(sorted_samples)
    if n == 0:
        raise ValueError("nearest_rank requires at least one sample")
    rank = math.ceil(percentile / 100 * n) - 1
    index = max(0, rank)
    return int(sorted_samples[index])


class LatencyAggregator:
    """Per-bucket rolling-window latency aggregator with P95 alerting.

    One instance per uvicorn worker, stored on ``app.state``. Not safe for
    use across threads or processes (see module docstring).
    """

    def __init__(
        self,
        threshold_ms: int = DEFAULT_P95_THRESHOLD_MS,
        logger: logging.Logger | None = None,
    ) -> None:
        self._threshold_ms: int = threshold_ms
        self._logger: logging.Logger = logger or logging.getLogger(_LOGGER_NAME)
        # bucket_key -> deque[(timestamp_ns, latency_ms)]
        self._buckets: dict[str, Deque[tuple[int, float]]] = {}
        # bucket_key -> (method, path_template) so snapshot never re-parses.
        self._meta: dict[str, tuple[str, str]] = {}
        # bucket_key -> was_alerting (transition dedup state).
        self._alerting: dict[str, bool] = {}

    # -- read-only configuration accessors (consumed by the endpoint) -------

    @property
    def window_seconds(self) -> int:
        return WINDOW_SECONDS

    @property
    def threshold_ms(self) -> int:
        return self._threshold_ms

    # -- ingest -------------------------------------------------------------

    def record(
        self,
        method: str,
        path_template: str,
        latency_ms: float,
        timestamp_ns: int,
    ) -> None:
        """Record one request sample, prune the window, and re-evaluate the alert.

        ``timestamp_ns`` is a ``time.perf_counter_ns()`` reading taken at the
        end of the request; the same clock must be used for :meth:`snapshot`.
        """
        key = f"{method} {path_template}"
        bucket = self._buckets.get(key)
        if bucket is None:
            bucket = deque(maxlen=MAX_SAMPLES_PER_BUCKET)
            self._buckets[key] = bucket
            self._meta[key] = (method, path_template)
        bucket.append((timestamp_ns, latency_ms))
        self._prune(bucket, timestamp_ns)
        self._evaluate_alert(key, method, path_template, bucket)

    # -- read ---------------------------------------------------------------

    def snapshot(self, timestamp_ns: int) -> list[LatencyBucket]:
        """Return immutable per-bucket stats, pruning each window lazily first."""
        result: list[LatencyBucket] = []
        for key, bucket in self._buckets.items():
            self._prune(bucket, timestamp_ns)
            method, path_template = self._meta[key]
            count = len(bucket)
            if count < MIN_SAMPLES:
                p50 = p95 = p99 = None
            else:
                latencies = sorted(latency for _, latency in bucket)
                p50 = nearest_rank(latencies, 50)
                p95 = nearest_rank(latencies, 95)
                p99 = nearest_rank(latencies, 99)
            result.append(
                LatencyBucket(
                    method=method,
                    path_template=path_template,
                    sample_count=count,
                    p50_ms=p50,
                    p95_ms=p95,
                    p99_ms=p99,
                    is_alerting=self._alerting.get(key, False),
                )
            )
        return result

    # -- internals ----------------------------------------------------------

    def _prune(self, bucket: Deque[tuple[int, float]], now_ns: int) -> None:
        """Drop samples older than the rolling window (oldest-first)."""
        cutoff = now_ns - _WINDOW_NS
        while bucket and bucket[0][0] < cutoff:
            bucket.popleft()

    def _evaluate_alert(
        self,
        key: str,
        method: str,
        path_template: str,
        bucket: Deque[tuple[int, float]],
    ) -> None:
        """Emit a start/recovery record on a P95 threshold *transition*.

        Skipped entirely while the window holds fewer than
        :data:`MIN_SAMPLES` samples (no emission on insufficient samples).
        """
        if len(bucket) < MIN_SAMPLES:
            return
        latencies = sorted(latency for _, latency in bucket)
        p95 = nearest_rank(latencies, 95)
        was_alerting = self._alerting.get(key, False)
        is_breaching = p95 > self._threshold_ms
        if is_breaching and not was_alerting:
            self._alerting[key] = True
            self._log_alert("request_slow_started", method, path_template, p95)
        elif not is_breaching and was_alerting:
            self._alerting[key] = False
            self._log_alert("request_slow_recovered", method, path_template, p95)

    def _log_alert(
        self,
        event: str,
        method: str,
        path_template: str,
        p95_ms: int,
    ) -> None:
        """Emit a structured alert record through the shared ``apps.api`` logger.

        The carried fields reuse the JSON logger's known schema: ``method``
        and ``path`` identify the bucket, ``latency_ms`` carries the
        breaching/recovering P95 value. The record ``message`` is the event
        name (``request_slow_started`` / ``request_slow_recovered``).
        """
        self._logger.warning(
            event,
            extra={
                "request_id": None,
                "method": method,
                "path": path_template,
                "status": None,
                "latency_ms": p95_ms,
            },
        )


__all__ = [
    "DEFAULT_P95_THRESHOLD_MS",
    "MAX_SAMPLES_PER_BUCKET",
    "MIN_SAMPLES",
    "WINDOW_SECONDS",
    "LatencyAggregator",
    "LatencyBucket",
    "nearest_rank",
]
