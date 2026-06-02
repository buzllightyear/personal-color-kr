"""App-state wiring contract for the latency aggregator (Phase 7.1).

This module pins the *integration contract* of the latency-monitoring slice
rather than the percentile math (covered by ``test_latency_aggregator.py``)
or the HTTP surface (``test_metrics_latency_endpoint.py``):

    * the :class:`LatencyAggregator` instance lives on
      ``app.state.latency_aggregator`` and is created during
      ``create_app()`` (FastAPI startup) — never as a module-level global,
    * the request_id middleware reaches that *same* instance via
      ``request.app.state.latency_aggregator`` (object identity, not a
      fresh copy) and feeds it one sample per completed request,
    * two ``create_app()`` instances own *distinct* aggregators (no shared
      module-level state leaks between apps).

These assertions are what AC "LatencyAggregator instance lives as
``app.state.latency_aggregator`` ... middleware accesses via
``request.app.state.latency_aggregator``" demands.
"""

from __future__ import annotations

import time
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient

import api.main as main_module
from api.main import create_app
from api.services.latency_aggregator import LatencyAggregator


def _client(app: Any) -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver")


@pytest.mark.unit
def test_aggregator_is_set_on_app_state_at_startup() -> None:
    """``create_app()`` wires a ``LatencyAggregator`` onto ``app.state``."""
    app = create_app()
    aggregator = app.state.latency_aggregator
    assert isinstance(aggregator, LatencyAggregator)
    # Config is sourced from the env knob (sensible default, not fail-fast).
    assert aggregator.window_seconds == 60
    assert isinstance(aggregator.threshold_ms, int)


@pytest.mark.unit
def test_no_module_level_aggregator_global() -> None:
    """The aggregator must not leak as a module-level global on ``api.main``.

    Per the Seed constraint "no module-level globals — use
    ``app.state.latency_aggregator``": the instance is reachable only through
    ``app.state``, so the ``api.main`` module exposes no ``latency_aggregator``
    attribute of its own.
    """
    assert not hasattr(main_module, "latency_aggregator")


@pytest.mark.unit
def test_each_app_owns_a_distinct_aggregator() -> None:
    """Two apps get independent aggregators (no shared global state)."""
    app_a = create_app()
    app_b = create_app()
    assert app_a.state.latency_aggregator is not app_b.state.latency_aggregator


@pytest.mark.unit
async def test_middleware_feeds_the_app_state_instance() -> None:
    """A real request flows through the middleware into ``app.state``'s aggregator.

    Proves the middleware reaches the *same* object held on ``app.state``
    (identity check via ``snapshot``): after one routed request, the
    aggregator that ``app.state`` exposes has recorded a sample for that
    route's template.
    """
    app = create_app()
    aggregator = app.state.latency_aggregator

    # No samples before any traffic.
    assert aggregator.snapshot(time.perf_counter_ns()) == []

    async with _client(app) as client:
        response = await client.get("/v1/health")
    assert response.status_code == 200, response.text

    # The very instance on app.state now carries the routed sample, which is
    # only possible if the middleware used request.app.state.latency_aggregator.
    buckets = aggregator.snapshot(time.perf_counter_ns())
    templates = {bucket.path_template for bucket in buckets}
    assert "/v1/health" in templates
    health_bucket = next(b for b in buckets if b.path_template == "/v1/health")
    assert health_bucket.method == "GET"
    assert health_bucket.sample_count >= 1
