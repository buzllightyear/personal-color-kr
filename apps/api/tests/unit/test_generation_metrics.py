"""Unit tests for AC3: request-level generation success-rate metric (Sentry).

Two layers:
  1. Endpoint integration — ``POST /v1/generate`` records the terminal outcome
     (success / failed) with the retry count through the injected
     :class:`GenerationMetricsRecorder` seam (stubbed; no live Sentry).
  2. Sentry implementation — :class:`SentryGenerationMetricsRecorder` forwards
     the outcome to ``sentry_sdk`` (tag + breadcrumb, and a warning capture for
     non-success), verified with a mocked ``sentry_sdk``.
"""

from __future__ import annotations

import io
import uuid
from collections.abc import AsyncGenerator
from datetime import datetime, timezone
from typing import Any
from unittest import mock

import pytest
from httpx import ASGITransport, AsyncClient
from PIL import Image

from api.db.models.recipe import RECIPE_STATUS_PUBLISHED, Recipe
from api.db.models.user import User
from api.db.session import get_session
from api.dependencies.auth import require_current_user
from api.dependencies.generate import get_generate_runner
from api.main import create_app
from api.observability.generation_metrics import (
    OUTCOME_FAILED,
    OUTCOME_SUCCESS,
    SentryGenerationMetricsRecorder,
    get_generation_metrics_recorder,
)
from personal_color.generate.fal_client import FalGenerationConfig
from personal_color.generate.orchestrator import (
    GenerationBudgetExhaustedError,
    OrchestrationResult,
)
from personal_color.generate.rejection import RejectionVerdict

_NOW = datetime.now(timezone.utc)


def _png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (32, 32), (1, 2, 3)).save(buf, format="PNG")
    return buf.getvalue()


def _recipe() -> Recipe:
    r = Recipe()
    r.id = uuid.uuid4()
    r.recipe_id = "r-001"
    r.model_id = "fal-ai/flux/dev"
    r.prompt_template = "p"
    r.style_reference_key = None
    r.parameters = {}
    r.status = RECIPE_STATUS_PUBLISHED
    r.publish_date = _NOW
    r.display_order = 0
    r.created_at = _NOW
    r.updated_at = _NOW
    return r


class _Result:
    def __init__(self, rows: list[Recipe]) -> None:
        self._rows = rows

    def scalar_one_or_none(self) -> Recipe | None:
        return self._rows[0] if self._rows else None


class _Session:
    def __init__(self, rows: list[Recipe]) -> None:
        self._rows = rows

    async def execute(self, _stmt: Any) -> _Result:
        return _Result(self._rows)


def _user() -> User:
    u = User()
    u.id = uuid.uuid4()
    u.apple_sub = "sub"
    u.email = None
    u.email_verified = False
    u.display_name = None
    u.referral_code = "AAAAAAAA"
    u.referrer_user_id = None
    u.created_at = _NOW
    u.updated_at = _NOW
    return u


class _RecordingRecorder:
    def __init__(self) -> None:
        self.calls: list[tuple[str, int]] = []

    def record_outcome(self, outcome: str, *, retry_count: int) -> None:
        self.calls.append((outcome, retry_count))


def _build_app(runner: Any, recorder: _RecordingRecorder) -> Any:
    app = create_app()
    session = _Session([_recipe()])

    async def _sess() -> AsyncGenerator[_Session, None]:
        yield session

    app.dependency_overrides[get_session] = _sess
    app.dependency_overrides[require_current_user] = _user
    app.dependency_overrides[get_generate_runner] = lambda: runner
    app.dependency_overrides[get_generation_metrics_recorder] = lambda: recorder
    return app


@pytest.mark.asyncio
async def test_records_success_outcome_with_retry_count() -> None:
    def _runner(_c: FalGenerationConfig, _b: bytes) -> OrchestrationResult:
        return OrchestrationResult(
            image_bytes=_png(),
            retry_count=2,
            last_verdict=RejectionVerdict(
                nsfw_flag=False,
                artifact_flag=False,
                passed=True,
                nsfw_score=0.0,
                artifact_score=0.0,
                reject_reason=None,
            ),
        )

    recorder = _RecordingRecorder()
    app = _build_app(_runner, recorder)
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://t"
    ) as client:
        resp = await client.post(
            "/v1/generate",
            data={"recipe_id": "r-001"},
            files={"selfie": ("s.png", _png(), "image/png")},
        )
    assert resp.status_code == 200
    assert recorder.calls == [(OUTCOME_SUCCESS, 2)]


@pytest.mark.asyncio
async def test_records_failed_outcome_on_budget_exhausted() -> None:
    def _runner(_c: FalGenerationConfig, _b: bytes) -> OrchestrationResult:
        raise GenerationBudgetExhaustedError(
            "exhausted", retry_count=5, last_reject_reason="artifact"
        )

    recorder = _RecordingRecorder()
    app = _build_app(_runner, recorder)
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://t"
    ) as client:
        resp = await client.post(
            "/v1/generate",
            data={"recipe_id": "r-001"},
            files={"selfie": ("s.png", _png(), "image/png")},
        )
    assert resp.status_code == 503
    assert recorder.calls == [(OUTCOME_FAILED, 5)]


def test_sentry_recorder_tags_and_breadcrumbs_success() -> None:
    recorder = SentryGenerationMetricsRecorder()
    with (mock.patch("api.observability.generation_metrics.sentry_sdk") as sdk,):
        recorder.record_outcome(OUTCOME_SUCCESS, retry_count=1)
    sdk.set_tag.assert_any_call("generation.outcome", "success")
    sdk.set_tag.assert_any_call("generation.retry_count", "1")
    sdk.add_breadcrumb.assert_called_once()
    # Success must NOT emit a warning capture.
    sdk.capture_message.assert_not_called()


def test_sentry_recorder_captures_warning_on_failure() -> None:
    recorder = SentryGenerationMetricsRecorder()
    with mock.patch("api.observability.generation_metrics.sentry_sdk") as sdk:
        recorder.record_outcome(OUTCOME_FAILED, retry_count=3)
    sdk.set_tag.assert_any_call("generation.outcome", "failed")
    sdk.capture_message.assert_called_once_with("generation_failed", level="warning")
