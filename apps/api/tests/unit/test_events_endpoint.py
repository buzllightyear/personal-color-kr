"""Unit tests for ``POST /v1/events`` (Phase 4.4).

Exercises the handler with an in-memory fake session (no real Postgres):

    * a valid body returns HTTP 201 and echoes the server-authoritative
      fields,
    * the persisted ``user_id`` is forced from the authenticated user even
      when the client sends a different ``user_id`` in the body
      (impersonation prevention),
    * a ``event_name`` violating ``^[a-z_]+$`` is rejected with HTTP 422,
    * an anonymous request (no override → real dependency) returns 401.

The auth dependency is overridden with a deterministic user so the forced
``user_id`` is assertable; the session dependency is overridden with a
fake that records the inserted row.
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

_USER_ID = uuid.UUID("11111111-1111-1111-1111-111111111111")


class _FakeSession:
    """Minimal AsyncSession stand-in capturing the single inserted row."""

    def __init__(self) -> None:
        self.added: list[Any] = []
        self.committed = False

    def add(self, instance: Any) -> None:
        self.added.append(instance)

    async def flush(self) -> None:  # noqa: D401 - test double
        return None

    async def commit(self) -> None:  # noqa: D401 - test double
        self.committed = True


def _known_user() -> User:
    user = User()
    user.id = _USER_ID
    user.apple_sub = "sub-events-test"
    user.email = None
    user.email_verified = False
    user.display_name = None
    now = datetime.now(timezone.utc)
    user.created_at = now
    user.updated_at = now
    return user


def _build_app_with_overrides() -> tuple[Any, _FakeSession]:
    app = create_app()
    fake = _FakeSession()

    async def _override_session() -> AsyncIterator[_FakeSession]:
        yield fake

    app.dependency_overrides[require_current_user] = _known_user
    app.dependency_overrides[get_session] = _override_session
    return app, fake


@pytest.mark.unit
async def test_post_event_returns_201_and_echoes_fields() -> None:
    app, fake = _build_app_with_overrides()
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        response = await client.post(
            "/v1/events",
            json={
                "anonymous_id": "distinct-abc",
                "event_name": "magazine_delivered",
                "occurred_at": "2026-01-10T08:00:00+00:00",
                "properties": {"issue": 7},
            },
        )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["event_name"] == "magazine_delivered"
    assert body["user_id"] == str(_USER_ID)
    assert uuid.UUID(body["event_id"])  # parses as a UUID
    assert fake.committed is True
    # The repository persisted exactly one row with the forced user_id.
    assert len(fake.added) == 1
    assert fake.added[0].user_id == _USER_ID
    assert fake.added[0].anonymous_id == "distinct-abc"


@pytest.mark.unit
async def test_post_event_forces_user_id_ignoring_client_value() -> None:
    app, fake = _build_app_with_overrides()
    attacker_id = str(uuid.uuid4())
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        response = await client.post(
            "/v1/events",
            json={
                "anonymous_id": "distinct-abc",
                "event_name": "magazine_viewed",
                "occurred_at": "2026-01-10T08:00:00+00:00",
                # Client attempts to attribute the event to another user.
                "user_id": attacker_id,
            },
        )

    assert response.status_code == 201, response.text
    body = response.json()
    # The forced user wins; the client-supplied user_id is ignored.
    assert body["user_id"] == str(_USER_ID)
    assert body["user_id"] != attacker_id
    assert fake.added[0].user_id == _USER_ID


@pytest.mark.unit
async def test_post_event_rejects_invalid_event_name() -> None:
    app, _ = _build_app_with_overrides()
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        response = await client.post(
            "/v1/events",
            json={
                "anonymous_id": "distinct-abc",
                "event_name": "Magazine-Delivered",  # invalid: caps + hyphen
                "occurred_at": "2026-01-10T08:00:00+00:00",
            },
        )

    assert response.status_code == 422, response.text


@pytest.mark.unit
async def test_post_event_requires_authentication() -> None:
    # Clear the conftest auto-stub so the REAL require_current_user runs
    # and 401s because no Authorization header is supplied.
    app = create_app()
    app.dependency_overrides.pop(require_current_user, None)
    fake = _FakeSession()

    async def _override_session() -> AsyncIterator[_FakeSession]:
        yield fake

    app.dependency_overrides[get_session] = _override_session

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        response = await client.post(
            "/v1/events",
            json={
                "anonymous_id": "distinct-abc",
                "event_name": "magazine_viewed",
                "occurred_at": "2026-01-10T08:00:00+00:00",
            },
        )

    assert response.status_code == 401, response.text
