"""AC16 — RequestIdMiddleware sets the per-request ``request_id`` Sentry tag.

The ``RequestIdMiddleware`` is the single source of the per-request UUID4.
Phase 7.2 requires that *the same* UUID4 it emits to the JSON logs
(``X-Request-ID`` header / ``request_completed`` log record) is also pushed to
Sentry as a ``request_id`` tag, so an operator triaging a Sentry issue can
pivot straight to the correlated structured-log records (and vice-versa).

These tests assert that contract without ever contacting Sentry.io: the
module-level ``sentry_sdk`` reference is monkeypatched with a recorder that
captures every ``set_tag`` call. We then verify:

    * a ``("request_id", <uuid4>)`` tag is set on each request,
    * the tagged value is identical to the value placed on
      ``request.state.request_id`` and the ``X-Request-ID`` response header
      (i.e. the same UUID emitted in JSON logs),
    * each request produces its own distinct tag value, and
    * the tag value is a canonical UUID4 string.
"""

from __future__ import annotations

import re
from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient

import api.middleware.request_id as request_id_module
from api.main import create_app
from api.middleware.request_id import REQUEST_ID_HEADER

#: Canonical UUID4 regex (lowercase hex, version nibble 4, variant nibble 8-b).
_UUID4_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
)


class _TagRecorder:
    """Stand-in for ``sentry_sdk`` capturing ``set_tag(key, value)`` calls."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, object]] = []

    def set_tag(self, key: str, value: object) -> None:
        self.calls.append((key, value))

    def request_id_values(self) -> list[object]:
        """Return the values of every ``request_id`` tag, in call order."""
        return [value for key, value in self.calls if key == "request_id"]


@pytest.fixture
def tag_recorder(monkeypatch: pytest.MonkeyPatch) -> _TagRecorder:
    """Swap the middleware's ``sentry_sdk`` for a call recorder."""
    recorder = _TagRecorder()
    monkeypatch.setattr(request_id_module, "sentry_sdk", recorder)
    return recorder


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    """Yield an httpx.AsyncClient bound to a fresh FastAPI app."""
    app = create_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


async def test_set_tag_called_with_request_id_key(
    client: AsyncClient, tag_recorder: _TagRecorder
) -> None:
    """Each request sets exactly one ``request_id`` Sentry tag."""
    await client.get("/v1/health")
    assert len(tag_recorder.request_id_values()) == 1


async def test_tag_value_matches_response_header(
    client: AsyncClient, tag_recorder: _TagRecorder
) -> None:
    """The Sentry ``request_id`` tag equals the X-Request-ID header value.

    The header carries the same UUID emitted in the JSON logs, so tag/header
    parity proves Sentry<->log cross-referencing works.
    """
    response = await client.get("/v1/health")
    header_value = response.headers[REQUEST_ID_HEADER]
    assert tag_recorder.request_id_values() == [header_value]


async def test_tag_value_is_canonical_uuid4(
    client: AsyncClient, tag_recorder: _TagRecorder
) -> None:
    """The tagged value is a canonical UUID4 string (8-4-4-4-12)."""
    await client.get("/v1/health")
    (tagged,) = tag_recorder.request_id_values()
    assert isinstance(tagged, str)
    assert _UUID4_RE.match(tagged) is not None


async def test_each_request_tags_a_distinct_request_id(
    client: AsyncClient, tag_recorder: _TagRecorder
) -> None:
    """Two consecutive requests tag two distinct UUID4 values."""
    await client.get("/v1/health")
    await client.get("/v1/health")
    values = tag_recorder.request_id_values()
    assert len(values) == 2
    assert values[0] != values[1]


async def test_tag_set_even_on_4xx(
    client: AsyncClient, tag_recorder: _TagRecorder
) -> None:
    """The tag is set for unmatched (404) routes too — middleware runs first."""
    response = await client.get("/v1/does-not-exist")
    assert response.status_code == 404
    header_value = response.headers[REQUEST_ID_HEADER]
    assert tag_recorder.request_id_values() == [header_value]
