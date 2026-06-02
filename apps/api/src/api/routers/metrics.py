"""``GET /v1/metrics/retention`` route handler (Phase 4.4).

Hosts the HTTP-ignorant core-python retention handler
(``retention.api.get_retention_metrics``) over the ``events`` table. The
router owns three responsibilities the pure handler cannot:

    1. **Authentication** — ``Depends(require_current_user)``; no
       anonymous access.
    2. **Cohort / active assembly** — translate the five calendar query
       params into instant windows and resolve the cohort denominator and
       active numerator from the ``events`` table via the events
       repository (the sole SQL boundary).
    3. **Response shaping + timestamp** — project the core handler's
       framework-agnostic ``dict`` envelope onto the typed
       :class:`RetentionMetricsResponse`, stamping ``computed_at`` (the
       core handler is pure and time-ignorant).

All five query params are mandatory (no defaults): ``cohort_event``,
``cohort_start``, ``cohort_end``, ``active_event``, ``window_days``.

Window semantics:
    * Cohort window — ``[cohort_start 00:00 UTC, (cohort_end + 1 day) 00:00
      UTC)``: a half-open interval that includes every instant of the
      ``cohort_end`` calendar day.
    * Active window — the ``window_days`` calendar days immediately
      *after* ``cohort_end``: ``[(cohort_end + 1 day) 00:00 UTC,
      (cohort_end + 1 day + window_days) 00:00 UTC)``.

The ``events`` table is the sole source of truth — no PostHog data feeds
this calculation.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from time import perf_counter_ns
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from api.db.models.user import User
from api.db.repositories.events_repository import (
    fetch_active_user_ids,
    fetch_cohort_user_ids,
)
from api.db.session import AsyncSession, get_session
from api.dependencies.auth import require_current_user
from api.schemas.latency import LatencyBucketModel, LatencyMetricsResponse
from api.schemas.metrics import RetentionMetricsResponse
from api.services.latency_aggregator import LatencyAggregator
from retention.api import get_retention_metrics

#: Router hosting ``GET /v1/metrics/retention``. The ``/v1`` prefix is
#: applied by ``api.main.create_app``.
router: APIRouter = APIRouter(tags=["metrics"])


def _utc_midnight(day: date) -> datetime:
    """Return the UTC-midnight instant at the start of ``day``."""
    return datetime.combine(day, time.min, tzinfo=timezone.utc)


@router.get(
    "/metrics/retention",
    response_model=RetentionMetricsResponse,
    status_code=status.HTTP_200_OK,
    summary="30-day retention metric assembled from the events table",
    description=(
        "Computes a rolling-retention metric from the events table. The "
        "cohort is the distinct users who emitted ``cohort_event`` within "
        "[``cohort_start``, ``cohort_end``]; the active set is the cohort "
        "members who emitted ``active_event`` in the ``window_days`` days "
        "after ``cohort_end``. Requires a valid backend JWT."
    ),
)
async def get_retention(
    cohort_event: str = Query(
        min_length=1,
        description="Event name defining cohort membership.",
    ),
    cohort_start: date = Query(
        description="Inclusive cohort window start (YYYY-MM-DD).",
    ),
    cohort_end: date = Query(
        description="Inclusive cohort window end (YYYY-MM-DD).",
    ),
    active_event: str = Query(
        min_length=1,
        description="Event name defining active status in the window.",
    ),
    window_days: int = Query(
        ge=1,
        le=365,
        description="Days after cohort_end for the active measurement window.",
    ),
    current_user: User = Depends(require_current_user),
    session: AsyncSession = Depends(get_session),
) -> RetentionMetricsResponse:
    """Assemble cohort/active sets and return the retention metric.

    Raises
    ------
    HTTPException
        * 400 ``{"detail": "invalid_date_range"}`` when ``cohort_end`` is
          earlier than ``cohort_start``.
        * 500 ``{"detail": "retention_computation_failed"}`` when the core
          handler returns a ``success=False`` envelope (e.g. a degenerate
          threshold) — surfaced without leaking internals.
    """
    if cohort_end < cohort_start:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="invalid_date_range",
        )

    cohort_window_start = _utc_midnight(cohort_start)
    cohort_window_end = _utc_midnight(cohort_end + timedelta(days=1))
    active_window_start = cohort_window_end
    active_window_end = _utc_midnight(cohort_end + timedelta(days=1 + window_days))

    cohort_user_ids = await fetch_cohort_user_ids(
        session,
        event_name=cohort_event,
        window_start=cohort_window_start,
        window_end=cohort_window_end,
    )
    active_user_ids = await fetch_active_user_ids(
        session,
        event_name=active_event,
        window_start=active_window_start,
        window_end=active_window_end,
        cohort_user_ids=cohort_user_ids,
    )

    # Delegate the math to the unmodified pure-Python core handler. It
    # returns a framework-agnostic ``ApiResponse`` envelope.
    envelope: dict[str, Any] = get_retention_metrics(
        cohort_user_ids,
        active_user_ids,
    )
    if not envelope.get("success"):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="retention_computation_failed",
        )

    data: dict[str, Any] = envelope["data"]
    return RetentionMetricsResponse(
        cohort_event=cohort_event,
        cohort_start=cohort_start,
        cohort_end=cohort_end,
        active_event=active_event,
        window_days=window_days,
        cohort_size=data["cohort_size"],
        active_size=data["active_size"],
        retention_rate=data["retention_rate"],
        threshold_value=data["threshold"],
        threshold_met=data["meets_threshold"],
        computed_at=datetime.now(timezone.utc),
    )


@router.get(
    "/metrics/latency",
    response_model=LatencyMetricsResponse,
    status_code=status.HTTP_200_OK,
    summary="Real-time in-process request latency percentiles",
    description=(
        "Returns P50/P95/P99 latency percentiles over a 60-second rolling "
        "window per (method, path_template) bucket, plus each bucket's live "
        "P95 alert state. Percentiles are null until a bucket has at least "
        "10 in-window samples. Reads the in-process aggregator on "
        "``app.state`` — no database access. Requires a valid backend JWT."
    ),
)
async def get_latency(
    request: Request,
    current_user: User = Depends(require_current_user),
) -> LatencyMetricsResponse:
    """Project the in-process latency aggregator snapshot onto the wire model.

    The aggregator lives on ``request.app.state.latency_aggregator`` (set by
    :func:`api.main.create_app`). Reading it is a pure in-memory operation:
    :meth:`LatencyAggregator.snapshot` lazily prunes each bucket's rolling
    window to the last 60 seconds, then computes nearest-rank percentiles.
    """
    aggregator: LatencyAggregator = request.app.state.latency_aggregator
    buckets = aggregator.snapshot(perf_counter_ns())
    return LatencyMetricsResponse(
        # Seed-pinned format: UTC isoformat with an explicit ``Z`` suffix.
        generated_at=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        window_seconds=aggregator.window_seconds,
        threshold_ms=aggregator.threshold_ms,
        buckets=[
            LatencyBucketModel(
                method=bucket.method,
                path_template=bucket.path_template,
                sample_count=bucket.sample_count,
                p50_ms=bucket.p50_ms,
                p95_ms=bucket.p95_ms,
                p99_ms=bucket.p99_ms,
                is_alerting=bucket.is_alerting,
            )
            for bucket in buckets
        ],
    )


__all__ = ["router"]
