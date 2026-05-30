"""Pydantic v2 response schema for ``GET /v1/metrics/retention`` (Phase 4.4).

The retention endpoint hosts the HTTP-ignorant core-python handler
``retention.api.get_retention_metrics`` over the ``events`` table. The
core handler returns a framework-agnostic ``dict`` envelope; this module
declares the typed wire-format response that the router projects that
envelope onto.

The response intentionally echoes the five query params (``cohort_event``,
``cohort_start``, ``cohort_end``, ``active_event``, ``window_days``) back
to the caller alongside the computed metrics so a dashboard rendering the
result never has to correlate it with the request it sent.

Field provenance:

    * ``cohort_size`` / ``active_size`` / ``retention_rate`` /
      ``threshold_met`` / ``threshold_value`` come from the core handler's
      ``data`` payload (mapping the handler keys ``meets_threshold`` →
      ``threshold_met`` and ``threshold`` → ``threshold_value``).
    * ``computed_at`` is stamped by the router (the core handler is pure
      and time-ignorant, so the HTTP layer owns the timestamp).

This module imports no SQLAlchemy, no httpx — a pure validation surface.
"""

from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class RetentionMetricsResponse(BaseModel):
    """HTTP 200 body for ``GET /v1/metrics/retention``.

    Carries the echoed query parameters plus the computed retention
    metrics. ``extra="forbid"`` guards against silent field drift between
    the core handler payload and this wire contract.
    """

    model_config = ConfigDict(extra="forbid")

    # ----- echoed query parameters -----
    cohort_event: str
    cohort_start: date
    cohort_end: date
    active_event: str
    window_days: int

    # ----- computed metrics (from the core retention handler) -----
    cohort_size: int
    active_size: int
    retention_rate: float
    threshold_value: float
    threshold_met: bool

    # ----- router-stamped metadata -----
    computed_at: datetime


__all__ = ["RetentionMetricsResponse"]
