"""Unit/integration tests for ``GET /v1/metrics/latency`` (Phase 7.1).

Drives the real ASGI stack (request_id middleware + router) via
``httpx.AsyncClient`` against a fresh ``create_app()``. The unit-tier
``conftest.py`` auto-installs a stub ``require_current_user`` override, so
authenticated calls succeed without a real JWT; the 401 case explicitly
clears that override.

Covers:
    * 200 + valid response schema for an authenticated caller,
    * 401 for an anonymous caller (auth override cleared),
    * ``generated_at`` is ISO-8601 UTC with a trailing ``Z``,
    * ``window_seconds`` / ``threshold_ms`` echo the aggregator config,
    * path-template extraction: a routed request buckets under its template
      (``/v1/health``) while an unmatched 404 buckets under ``<unmatched>``.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from time import perf_counter_ns
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient

from api.db.session import get_session
from api.dependencies.auth import require_current_user
from api.main import create_app


async def _fake_session() -> AsyncIterator[object]:
    """Yield a dummy session so the auth dep never opens a real DB engine.

    ``require_current_user`` raises 401 on a missing bearer token *before*
    it ever touches the session, so this stub is never queried; it exists
    only to keep the ``Depends(get_session)`` sub-dependency from
    constructing a real SQLAlchemy engine (which needs ``DATABASE_URL``).
    """
    yield object()


@pytest.fixture
async def authed_client() -> AsyncIterator[tuple[AsyncClient, Any]]:
    """Yield a client bound to an app whose aggregator we can inspect."""
    app = create_app()  # conftest auto-installs the stub-user override
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as ac:
        yield ac, app


@pytest.mark.unit
async def test_latency_endpoint_authed_empty_schema(
    authed_client: tuple[AsyncClient, Any],
) -> None:
    client, app = authed_client
    response = await client.get("/v1/metrics/latency")
    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body.keys()) == {
        "generated_at",
        "window_seconds",
        "threshold_ms",
        "buckets",
    }
    assert body["window_seconds"] == 60
    assert body["threshold_ms"] == app.state.latency_aggregator.threshold_ms
    assert isinstance(body["buckets"], list)
    assert body["generated_at"].endswith("Z")


@pytest.mark.unit
async def test_latency_endpoint_requires_authentication() -> None:
    app = create_app()
    app.dependency_overrides.pop(require_current_user, None)
    app.dependency_overrides[get_session] = _fake_session
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as ac:
        response = await ac.get("/v1/metrics/latency")
    assert response.status_code == 401, response.text


@pytest.mark.unit
async def test_latency_endpoint_bucket_schema_shape(
    authed_client: tuple[AsyncClient, Any],
) -> None:
    client, app = authed_client
    # Seed a known bucket directly on the aggregator (10 samples → percentiles).
    agg = app.state.latency_aggregator
    # Seed with a *current* monotonic base so the samples sit inside the
    # 60s window when the endpoint snapshots via ``perf_counter_ns()``.
    base = perf_counter_ns()
    for i in range(10):
        agg.record("GET", "/v1/seeded", float(i + 1), base + i)

    response = await client.get("/v1/metrics/latency")
    assert response.status_code == 200, response.text
    buckets = response.json()["buckets"]
    seeded = [b for b in buckets if b["path_template"] == "/v1/seeded"]
    assert len(seeded) == 1
    bucket = seeded[0]
    assert set(bucket.keys()) == {
        "method",
        "path_template",
        "sample_count",
        "p50_ms",
        "p95_ms",
        "p99_ms",
        "is_alerting",
    }
    assert bucket["method"] == "GET"
    assert bucket["sample_count"] == 10
    assert bucket["p50_ms"] == 5
    assert bucket["p95_ms"] == 10
    assert bucket["is_alerting"] is False


@pytest.mark.unit
async def test_path_template_extraction_routed_vs_unmatched(
    authed_client: tuple[AsyncClient, Any],
) -> None:
    client, app = authed_client
    # A routed request → buckets under its route template.
    await client.get("/v1/health")
    # An unmatched path (404) → buckets under the <unmatched> sentinel.
    await client.get("/v1/this-route-does-not-exist")

    response = await client.get("/v1/metrics/latency")
    assert response.status_code == 200, response.text
    templates = {b["path_template"] for b in response.json()["buckets"]}
    assert "/v1/health" in templates
    assert "<unmatched>" in templates


@pytest.mark.unit
async def test_middleware_tolerates_absent_aggregator() -> None:
    """A request must not crash if ``app.state`` has no aggregator.

    The middleware feeds samples defensively (``getattr`` → skip). Removing
    the aggregator simulates an app constructed without Phase 7.1 wiring and
    asserts the request path still completes normally.
    """
    app = create_app()
    if hasattr(app.state, "latency_aggregator"):
        delattr(app.state, "latency_aggregator")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as ac:
        response = await ac.get("/v1/health")
    assert response.status_code == 200, response.text
