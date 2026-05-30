"""Unit tests for ``GET /v1/metrics/retention`` (Phase 4.4).

Covers, with an in-memory fake session (no real Postgres):

    * all five query params are mandatory (missing → HTTP 422),
    * ``window_days`` is bounded to [1, 365] (out of range → 422),
    * ``cohort_end < cohort_start`` → HTTP 400 ``invalid_date_range``,
    * a known cohort/active fixture yields the correct ``retention_rate``
      and echoes the query params,
    * an anonymous request → 401.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient

from api.db.models.user import User
from api.db.session import get_session
from api.dependencies.auth import require_current_user
from api.main import create_app

_USER_ID = uuid.UUID("22222222-2222-2222-2222-222222222222")


class _FakeScalars:
    def __init__(self, rows: list[Any]) -> None:
        self._rows = rows

    def all(self) -> list[Any]:
        return self._rows


class _FakeResult:
    def __init__(self, rows: list[Any]) -> None:
        self._rows = rows

    def scalars(self) -> _FakeScalars:
        return _FakeScalars(self._rows)


class _QueuedSession:
    """Returns successive queued row-lists from ``execute`` calls."""

    def __init__(self, queued: list[list[Any]]) -> None:
        self._queued = list(queued)
        self.calls = 0

    async def execute(self, _stmt: Any) -> _FakeResult:
        rows = self._queued[self.calls] if self.calls < len(self._queued) else []
        self.calls += 1
        return _FakeResult(rows)


def _known_user() -> User:
    user = User()
    user.id = _USER_ID
    user.apple_sub = "sub-metrics-test"
    user.email = None
    user.email_verified = False
    user.display_name = None
    now = datetime.now(timezone.utc)
    user.created_at = now
    user.updated_at = now
    return user


def _build_app(queued: list[list[Any]]) -> Any:
    app = create_app()
    session = _QueuedSession(queued)

    async def _override_session() -> AsyncIterator[_QueuedSession]:
        yield session

    app.dependency_overrides[require_current_user] = _known_user
    app.dependency_overrides[get_session] = _override_session
    return app


_VALID_PARAMS = {
    "cohort_event": "magazine_delivered",
    "cohort_start": "2026-01-01",
    "cohort_end": "2026-01-07",
    "active_event": "magazine_viewed",
    "window_days": "30",
}


@pytest.mark.unit
async def test_retention_happy_path_computes_rate() -> None:
    cohort = [uuid.uuid4() for _ in range(4)]
    active = [cohort[0]]  # 1 of 4 returned → 0.25
    app = _build_app([cohort, active])

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        response = await client.get("/v1/metrics/retention", params=_VALID_PARAMS)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["cohort_size"] == 4
    assert body["active_size"] == 1
    assert body["retention_rate"] == pytest.approx(0.25)
    assert body["threshold_met"] is True  # 0.25 >= 0.25 (inclusive)
    assert body["cohort_event"] == "magazine_delivered"
    assert body["active_event"] == "magazine_viewed"
    assert body["window_days"] == 30
    assert "computed_at" in body


@pytest.mark.unit
async def test_retention_empty_cohort_is_zero_not_error() -> None:
    app = _build_app([[], []])
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        response = await client.get("/v1/metrics/retention", params=_VALID_PARAMS)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["cohort_size"] == 0
    assert body["active_size"] == 0
    assert body["retention_rate"] == 0.0


@pytest.mark.unit
@pytest.mark.parametrize("missing", sorted(_VALID_PARAMS.keys()))
async def test_retention_each_param_is_mandatory(missing: str) -> None:
    app = _build_app([[], []])
    params = {k: v for k, v in _VALID_PARAMS.items() if k != missing}
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        response = await client.get("/v1/metrics/retention", params=params)
    assert (
        response.status_code == 422
    ), f"omitting {missing!r} should 422, got {response.status_code}"


@pytest.mark.unit
async def test_retention_window_days_out_of_range() -> None:
    app = _build_app([[], []])
    params = {**_VALID_PARAMS, "window_days": "0"}
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        response = await client.get("/v1/metrics/retention", params=params)
    assert response.status_code == 422, response.text


@pytest.mark.unit
async def test_retention_invalid_date_range_returns_400() -> None:
    app = _build_app([[], []])
    params = {**_VALID_PARAMS, "cohort_start": "2026-02-01", "cohort_end": "2026-01-01"}
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        response = await client.get("/v1/metrics/retention", params=params)
    assert response.status_code == 400, response.text
    assert response.json()["detail"] == "invalid_date_range"


@pytest.mark.unit
async def test_retention_requires_authentication() -> None:
    app = create_app()
    app.dependency_overrides.pop(require_current_user, None)
    session = _QueuedSession([[], []])

    async def _override_session() -> AsyncIterator[_QueuedSession]:
        yield session

    app.dependency_overrides[get_session] = _override_session
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        response = await client.get("/v1/metrics/retention", params=_VALID_PARAMS)
    assert response.status_code == 401, response.text
