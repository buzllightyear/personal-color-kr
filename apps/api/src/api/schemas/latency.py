"""Pydantic v2 response schemas for ``GET /v1/metrics/latency`` (Phase 7.1).

The latency endpoint exposes a real-time view of the in-process
:class:`api.services.latency_aggregator.LatencyAggregator`. The aggregator
returns framework-agnostic :class:`~api.services.latency_aggregator.LatencyBucket`
snapshots; this module declares the typed wire-format the router projects
them onto.

Field provenance:

    * ``window_seconds`` / ``threshold_ms`` are read off the aggregator's
      configuration accessors (fixed 60s window; env-driven P95 threshold).
    * Each :class:`LatencyBucketModel` mirrors one aggregator bucket. The
      percentile fields are ``None`` until a bucket holds at least
      ``MIN_SAMPLES`` (10) in-window samples.
    * ``generated_at`` is stamped by the router as an ISO-8601 UTC string
      with a trailing ``Z`` (Seed: ``datetime.utcnow().isoformat() + "Z"``).

This module imports no SQLAlchemy, no httpx — a pure validation surface.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class LatencyBucketModel(BaseModel):
    """One ``(method, path_template)`` bucket's rolling-window stats."""

    model_config = ConfigDict(extra="forbid")

    method: str
    path_template: str
    sample_count: int
    p50_ms: int | None
    p95_ms: int | None
    p99_ms: int | None
    is_alerting: bool


class LatencyMetricsResponse(BaseModel):
    """HTTP 200 body for ``GET /v1/metrics/latency``.

    Carries the aggregator's fixed window/threshold configuration, the
    router-stamped ``generated_at`` timestamp, and the per-bucket
    percentile snapshot. ``extra="forbid"`` guards against silent field
    drift between the aggregator snapshot and this wire contract.
    """

    model_config = ConfigDict(extra="forbid")

    generated_at: str
    window_seconds: int
    threshold_ms: int
    buckets: list[LatencyBucketModel]


__all__ = ["LatencyBucketModel", "LatencyMetricsResponse"]
