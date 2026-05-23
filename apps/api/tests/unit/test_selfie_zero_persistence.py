"""AC13 — Selfie bytes are never persisted to disk and never logged.

Sends a known-magic selfie payload through ``POST /v1/diagnose`` (with the
diagnose dependency stubbed) and asserts:
    1. No file under ``tempfile.gettempdir()`` contains the magic prefix.
    2. No captured ``apps.api`` log record contains the magic-bytes hex
       prefix anywhere in its serialized JSON.

The stub never touches the bytes; the test simply exercises the handler's
end-to-end flow with a payload that would be conspicuous if it leaked.
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from api.config.logging import JsonFormatter, LOGGER_NAME
from api.dependencies.diagnose import get_diagnose_fn
from api.main import create_app
from personal_color.diagnosis_orchestrator import DiagnosisResult
from personal_color.season_classifier import Season
from personal_color.tone_classifier import Tone
from personal_color.contrast_classifier import Contrast

#: A recognizable JPEG-magic prefix + sentinel ASCII so any leak is easy to grep.
_MAGIC_PREFIX_BYTES = b"\xff\xd8\xff\xe0" + b"PCK_SELFIE_LEAK_SENTINEL_ABCDEF0123456789"
_MAGIC_PREFIX_HEX = _MAGIC_PREFIX_BYTES.hex()


def _stub_diagnose(_payload: bytes) -> DiagnosisResult:
    """Return a fixed DiagnosisResult; payload is intentionally unused."""
    return DiagnosisResult(
        season=Season.SPRING,
        confidence=0.9,
        tone=Tone.WARM,
        contrast=Contrast.HIGH,
        tone_confidence=0.9,
        contrast_confidence=0.9,
        skin_luma=0.5,
        hair_luma=0.4,
        eyes_luma=0.3,
    )


class _CapturingHandler(logging.Handler):
    def __init__(self) -> None:
        super().__init__()
        self.setFormatter(JsonFormatter())
        self.payloads: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        try:
            self.payloads.append(self.format(record))
        except Exception:  # noqa: BLE001
            self.payloads.append("<format-error>")


@pytest.fixture
async def client_and_handler() -> AsyncIterator[tuple[AsyncClient, _CapturingHandler]]:
    app = create_app()
    app.dependency_overrides[get_diagnose_fn] = lambda: _stub_diagnose
    logger = logging.getLogger(LOGGER_NAME)
    handler = _CapturingHandler()
    logger.addHandler(handler)
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac, handler
    finally:
        logger.removeHandler(handler)
        app.dependency_overrides.clear()


def _snapshot_tempdir_files() -> list[Path]:
    tempdir = Path(tempfile.gettempdir())
    return [p for p in tempdir.rglob("*") if p.is_file()]


async def test_selfie_bytes_never_touch_disk_or_logs(
    client_and_handler: tuple[AsyncClient, _CapturingHandler],
) -> None:
    client, handler = client_and_handler
    before = {p: p.stat().st_mtime_ns for p in _snapshot_tempdir_files()}

    response = await client.post(
        "/v1/diagnose",
        files={"selfie": ("test.jpg", _MAGIC_PREFIX_BYTES, "image/jpeg")},
    )
    assert response.status_code == 200

    # (a) No new or mutated tempdir file contains the magic prefix.
    for path in _snapshot_tempdir_files():
        # Only inspect files that are new or were modified after our snapshot.
        if path in before and path.stat().st_mtime_ns == before[path]:
            continue
        try:
            content = path.read_bytes()
        except OSError:
            continue  # permission / vanished — not our payload
        assert _MAGIC_PREFIX_BYTES not in content, f"Selfie bytes leaked to {path}"

    # (b) No log record contains the magic hex prefix.
    for payload in handler.payloads:
        assert (
            _MAGIC_PREFIX_HEX not in payload
        ), f"Selfie hex prefix leaked into log record: {payload}"
        # Defensive: also check that no JSON value contains the raw ASCII tail.
        try:
            decoded = json.loads(payload)
        except json.JSONDecodeError:
            continue
        flat = json.dumps(decoded, ensure_ascii=False)
        assert (
            "PCK_SELFIE_LEAK_SENTINEL" not in flat
        ), f"Selfie sentinel leaked into log record: {payload}"

    # Touch unused import paths to placate static analyzers — these are
    # imported above purely so the test fails loud if the module disappears.
    assert callable(get_diagnose_fn)
    assert os.path.isdir(tempfile.gettempdir())
