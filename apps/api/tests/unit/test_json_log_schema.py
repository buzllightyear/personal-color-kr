"""AC15 — Structured JSON logging emits the documented 8-key schema.

Captures records from the ``apps.api`` logger during an httpx.AsyncClient
call and asserts each record:
    1. Has *exactly* the 8 documented keys (no extras, no omissions).
    2. ``latency_ms`` is a number.
    3. ``request_id`` matches the UUID4 regex.
    4. ``method`` / ``path`` / ``status`` reflect the request.
"""

from __future__ import annotations

import json
import logging
import re
from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient

from api.config.logging import JSON_LOG_KEYS, JsonFormatter, LOGGER_NAME
from api.main import create_app

_UUID4_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
)


class _CapturingHandler(logging.Handler):
    """Capture formatted JSON records into ``self.records`` for assertions."""

    def __init__(self) -> None:
        super().__init__()
        self.setFormatter(JsonFormatter())
        self.records: list[dict[str, object]] = []

    def emit(self, record: logging.LogRecord) -> None:
        try:
            self.records.append(json.loads(self.format(record)))
        except Exception:  # noqa: BLE001 — defensive; should never trip
            self.records.append({"_emit_error": True})


@pytest.fixture
async def client_and_handler() -> AsyncIterator[tuple[AsyncClient, _CapturingHandler]]:
    app = create_app()
    logger = logging.getLogger(LOGGER_NAME)
    handler = _CapturingHandler()
    logger.addHandler(handler)
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac, handler
    finally:
        logger.removeHandler(handler)


async def test_health_emits_one_record_with_documented_schema(
    client_and_handler: tuple[AsyncClient, _CapturingHandler],
) -> None:
    client, handler = client_and_handler
    await client.get("/v1/health")
    assert len(handler.records) == 1
    record = handler.records[0]
    assert (
        set(record.keys()) == JSON_LOG_KEYS
    ), f"Expected exactly {JSON_LOG_KEYS}, got {set(record.keys())}"
    assert isinstance(record["latency_ms"], (int, float))
    assert isinstance(record["request_id"], str)
    assert _UUID4_RE.match(str(record["request_id"])) is not None
    assert record["method"] == "GET"
    assert record["path"] == "/v1/health"
    assert record["status"] == 200


async def test_404_also_emits_record_with_schema(
    client_and_handler: tuple[AsyncClient, _CapturingHandler],
) -> None:
    client, handler = client_and_handler
    await client.get("/v1/does-not-exist")
    assert len(handler.records) == 1
    record = handler.records[0]
    assert set(record.keys()) == JSON_LOG_KEYS
    assert record["status"] == 404
