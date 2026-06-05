"""Unauthenticated routes leave the Sentry user context unset (Phase 7.3).

Seed invariant: ``sentry_sdk.set_user`` is attached at exactly **one** seam —
the ``require_current_user`` FastAPI dependency (via ``set_request_user``). The
public, unauthenticated routes — ``GET /v1/health``, ``GET /v1/version``, and
``POST /v1/auth/sign-in-with-apple`` (Apple sign-in / login) — never resolve
that dependency, so they must **never** call ``set_user``. There is no sentinel
user for unauthenticated requests: ``set_user`` is simply skipped.

Two layers of evidence:

* **Behavioral** — drive the real ASGI stack with the Sentry boundary
  (``sentry_sdk.set_user``) monkeypatched to a recorder, hit the public GET
  routes, and assert the recorder stays empty.
* **Structural** — walk each public route's FastAPI dependency tree and assert
  ``require_current_user`` (the only seam that calls ``set_request_user``) is
  absent. This covers the auth-login route without standing up the full Apple
  JWKS / bundle-id verification machinery.

The Sentry boundary is monkeypatched, so no real SDK scope is touched and no
network call is made.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Iterator
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient

import api.observability.sentry as sentry_module
from api.dependencies.auth import require_current_user
from api.main import create_app

pytestmark = pytest.mark.unit


# ---------------------------------------------------------------------------
# Sentry boundary recorder
# ---------------------------------------------------------------------------


class _SetUserRecorder:
    """Records every payload passed to ``sentry_sdk.set_user``."""

    def __init__(self) -> None:
        self.payloads: list[Any] = []

    def __call__(self, payload: Any) -> None:
        self.payloads.append(payload)


@pytest.fixture()
def set_user_recorder(monkeypatch: pytest.MonkeyPatch) -> _SetUserRecorder:
    """Replace ``sentry_sdk.set_user`` with an in-memory recorder."""
    rec = _SetUserRecorder()
    monkeypatch.setattr(sentry_module.sentry_sdk, "set_user", rec)
    return rec


@pytest.fixture()
async def client() -> AsyncIterator[AsyncClient]:
    """Yield an httpx.AsyncClient bound to a fresh FastAPI app."""
    app = create_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


# ---------------------------------------------------------------------------
# Behavioral: real requests to public GET routes never tag the Sentry user
# ---------------------------------------------------------------------------


async def test_health_route_leaves_sentry_user_unset(
    client: AsyncClient, set_user_recorder: _SetUserRecorder
) -> None:
    response = await client.get("/v1/health")

    assert response.status_code == 200
    # No authenticated user → no Sentry user context attached.
    assert set_user_recorder.payloads == []


async def test_version_route_leaves_sentry_user_unset(
    client: AsyncClient, set_user_recorder: _SetUserRecorder
) -> None:
    response = await client.get("/v1/version")

    assert response.status_code == 200
    assert set_user_recorder.payloads == []


async def test_multiple_public_requests_never_tag_sentry_user(
    client: AsyncClient, set_user_recorder: _SetUserRecorder
) -> None:
    # A burst of unauthenticated traffic must not leak a single set_user call.
    for _ in range(3):
        await client.get("/v1/health")
        await client.get("/v1/version")

    assert set_user_recorder.payloads == []


# ---------------------------------------------------------------------------
# Structural: public routes do not resolve the user-correlation seam
# ---------------------------------------------------------------------------


def _iter_dependant_calls(dependant: Any) -> Iterator[Any]:
    """Yield every callable in a FastAPI ``Dependant`` tree (endpoint + deps)."""
    if getattr(dependant, "call", None) is not None:
        yield dependant.call
    for sub in getattr(dependant, "dependencies", []):
        yield from _iter_dependant_calls(sub)


def _route_calls(path: str, method: str) -> tuple[Any, ...]:
    """Return all dependency callables wired into the ``method`` ``path`` route."""
    app = create_app()
    for route in app.routes:
        if getattr(route, "path", None) == path and method in getattr(
            route, "methods", set()
        ):
            return tuple(_iter_dependant_calls(route.dependant))
    raise AssertionError(f"route not found: {method} {path}")


@pytest.mark.parametrize(
    ("path", "method"),
    [
        ("/v1/health", "GET"),
        ("/v1/version", "GET"),
        ("/v1/auth/sign-in-with-apple", "POST"),
    ],
)
def test_public_route_does_not_depend_on_require_current_user(
    path: str, method: str
) -> None:
    # ``require_current_user`` is the ONLY seam that calls ``set_request_user``
    # (→ ``sentry_sdk.set_user``). Its absence from these routes' dependency
    # trees proves the auth-login / health / version routes can never tag the
    # Sentry user context — no Apple-JWKS mocking required to prove it.
    calls = _route_calls(path, method)
    assert require_current_user not in calls
