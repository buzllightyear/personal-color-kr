"""Unit/integration tests for ``GET /v1/metrics/latency`` (Phase 7.1).

Exercises the HTTP surface with an in-process app (no Postgres):

    * an authenticated request returns 200 with the documented schema
      (``generated_at`` ISO-8601 + ``Z``, ``window_seconds``, ``threshold_ms``,
      ``buckets``),
    * percentiles surface as integers once a bucket clears the 10-sample
      floor (and as ``null`` below it),
    * the live ``is_alerting`` flag is projected onto the wire model,
    * an anonymous request is rejected with 401.

The unit-tier ``conftest.py`` auto-stubs ``require_current_user`` on every
``create_app()`` instance, so the authenticated path needs no token; the
401 case explicitly clears that override.
"""

from __future__ import annotations

import time
from collections.abc import AsyncIterator
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient

from api.db.session import get_session
from api.dependencies.auth import require_current_user
from api.main import create_app

_MIN_SAMPLES = 10


async def _no_session() -> AsyncIterator[None]:
    """Stub ``get_session`` so dependency resolution never touches Postgres."""
    yield None


def _client(app: Any) -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver")


@pytest.mark.unit
async def test_latency_endpoint_empty_returns_200_and_shape() -> None:
    app = create_app()
    async with _client(app) as client:
        response = await client.get("/v1/metrics/latency")
    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body.keys()) == {
        "generated_at",
        "window_seconds",
        "threshold_ms",
        "buckets",
    }
    assert body["generated_at"].endswith("Z")
    assert body["window_seconds"] == 60
    assert isinstance(body["threshold_ms"], int)
    assert isinstance(body["buckets"], list)


@pytest.mark.unit
async def test_latency_endpoint_reports_percentiles_for_filled_bucket() -> None:
    app = create_app()
    # Seed a bucket past the MIN_SAMPLES floor with deterministic latencies.
    now = time.perf_counter_ns()
    aggregator = app.state.latency_aggregator
    for _ in range(_MIN_SAMPLES + 2):
        aggregator.record("GET", "/v1/seeded", 7.0, now)

    async with _client(app) as client:
        response = await client.get("/v1/metrics/latency")

    assert response.status_code == 200, response.text
    buckets = {b["path_template"]: b for b in response.json()["buckets"]}
    seeded = buckets["/v1/seeded"]
    assert seeded["method"] == "GET"
    assert seeded["sample_count"] == _MIN_SAMPLES + 2
    assert seeded["p50_ms"] == 7
    assert seeded["p95_ms"] == 7
    assert seeded["p99_ms"] == 7
    assert seeded["is_alerting"] is False


@pytest.mark.unit
async def test_latency_endpoint_null_percentiles_below_floor() -> None:
    app = create_app()
    now = time.perf_counter_ns()
    aggregator = app.state.latency_aggregator
    for _ in range(_MIN_SAMPLES - 1):  # one short of the floor
        aggregator.record("GET", "/v1/sparse", 7.0, now)

    async with _client(app) as client:
        response = await client.get("/v1/metrics/latency")

    sparse = {b["path_template"]: b for b in response.json()["buckets"]}["/v1/sparse"]
    assert sparse["sample_count"] == _MIN_SAMPLES - 1
    assert sparse["p50_ms"] is None
    assert sparse["p95_ms"] is None
    assert sparse["p99_ms"] is None


@pytest.mark.unit
async def test_latency_endpoint_projects_is_alerting() -> None:
    app = create_app()
    aggregator = app.state.latency_aggregator
    now = time.perf_counter_ns()
    # Breach the default 500ms threshold (10 samples @ 900ms).
    for _ in range(_MIN_SAMPLES):
        aggregator.record("GET", "/v1/slow", 900.0, now)

    async with _client(app) as client:
        response = await client.get("/v1/metrics/latency")

    slow = {b["path_template"]: b for b in response.json()["buckets"]}["/v1/slow"]
    assert slow["is_alerting"] is True
    assert slow["p95_ms"] == 900


@pytest.mark.unit
async def test_latency_endpoint_requires_authentication() -> None:
    app = create_app()
    app.dependency_overrides.pop(require_current_user, None)
    app.dependency_overrides[get_session] = _no_session
    async with _client(app) as client:
        response = await client.get("/v1/metrics/latency")
    assert response.status_code == 401, response.text
