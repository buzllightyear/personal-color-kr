"""Unit tests for the PostHog Cohort API pull client (Phase 4.4).

Uses ``httpx.MockTransport`` to assert the client:

    * sends the Personal API Key as a ``Bearer`` token,
    * builds the project-scoped cohort URL,
    * parses and returns the JSON object,
    * maps HTTP / transport / parse failures onto ``PostHogCohortError``.

No real network access — the transport intercepts every request.
"""

from __future__ import annotations

import httpx
import pytest

from api.posthog.posthog_cohort_client import (
    PostHogCohortClient,
    PostHogCohortError,
)

_API_KEY = "phx_test_key_abc123"
_PROJECT_ID = "4242"
_COHORT_ID = 99


@pytest.fixture(autouse=True)
def _posthog_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Set the PostHog env vars the client reads via the ``require_*`` seam."""
    monkeypatch.setenv("POSTHOG_PERSONAL_API_KEY", _API_KEY)
    monkeypatch.setenv("POSTHOG_PROJECT_ID", _PROJECT_ID)


def _factory(handler: object) -> object:
    """Return a zero-arg factory yielding a MockTransport-backed client."""

    def _make() -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=httpx.MockTransport(handler))  # type: ignore[arg-type]

    return _make


@pytest.mark.unit
async def test_fetch_cohort_sends_bearer_and_parses_json() -> None:
    """A 200 response yields the parsed object; auth header + URL are correct."""
    captured: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["auth"] = request.headers.get("authorization", "")
        return httpx.Response(
            200,
            json={"id": _COHORT_ID, "name": "Power Users", "count": 12},
        )

    client = PostHogCohortClient(http_client_factory=_factory(handler))
    cohort = await client.fetch_cohort(_COHORT_ID)

    assert cohort == {"id": _COHORT_ID, "name": "Power Users", "count": 12}
    assert captured["auth"] == f"Bearer {_API_KEY}"
    assert captured["url"] == (
        f"https://app.posthog.com/api/projects/{_PROJECT_ID}/cohorts/{_COHORT_ID}"
    )


@pytest.mark.unit
async def test_fetch_cohort_maps_http_error() -> None:
    """A non-2xx response raises ``PostHogCohortError`` (no secret leak)."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, json={"detail": "forbidden"})

    client = PostHogCohortClient(http_client_factory=_factory(handler))
    with pytest.raises(PostHogCohortError) as exc_info:
        await client.fetch_cohort(_COHORT_ID)
    assert "403" in str(exc_info.value)
    assert _API_KEY not in str(exc_info.value)


@pytest.mark.unit
async def test_fetch_cohort_maps_non_object_body() -> None:
    """A JSON array (not an object) raises ``PostHogCohortError``."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=[1, 2, 3])

    client = PostHogCohortClient(http_client_factory=_factory(handler))
    with pytest.raises(PostHogCohortError):
        await client.fetch_cohort(_COHORT_ID)


@pytest.mark.unit
async def test_fetch_cohort_requires_api_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Missing ``POSTHOG_PERSONAL_API_KEY`` fails fast with ``LookupError``."""
    monkeypatch.delenv("POSTHOG_PERSONAL_API_KEY", raising=False)

    def handler(request: httpx.Request) -> httpx.Response:  # pragma: no cover
        return httpx.Response(200, json={})

    client = PostHogCohortClient(http_client_factory=_factory(handler))
    with pytest.raises(LookupError):
        await client.fetch_cohort(_COHORT_ID)
