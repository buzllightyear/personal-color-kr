"""Integration test for ``GET /v1/db-health`` (Phase 4.1, Sub-AC 2).

Acceptance criterion (Sub-AC 2) being verified
----------------------------------------------
The ``GET /v1/db-health`` FastAPI route handler invokes
:func:`api.db.health.check_db_health` against a real SQLAlchemy 2.0 async
session backed by a Postgres 16 service container (docker-compose locally,
GitHub Actions ``services: postgres:`` in CI) and returns HTTP 200 with
body ``{"status": "ok", "db": "ok"}``.

Verification technique
----------------------
The test drives the FastAPI ``app`` directly via
``httpx.AsyncClient(transport=ASGITransport(app=app))`` (the Seed-mandated
test seam for end-to-end coverage). The ASGI transport routes requests
through the full FastAPI middleware stack and dependency resolution chain,
so the ``Depends(get_session)`` lifecycle, the ``async_sessionmaker``, the
asyncpg driver, and the real Postgres round-trip are all exercised — no
``app.dependency_overrides`` are applied here (those belong to the unit
tier).

Skip behavior
-------------
The test self-skips when no ``DATABASE_URL`` / ``DATABASE_URL_TEST``
environment variable is set (fresh checkout, no docker-compose, no CI
service container). This keeps ``pytest -q apps/api/tests`` green
out-of-the-box on forks and developer machines that have not yet run
``docker compose up -d postgres``.
"""

from __future__ import annotations

import os

import pytest
from httpx import ASGITransport, AsyncClient

# Wire constants from the Seed contract. Kept as module-level literals so the
# assertions read exactly the JSON the Phase 4.1 Seed pins as the success
# response body.
EXPECTED_STATUS_CODE: int = 200
EXPECTED_BODY: dict[str, str] = {"status": "ok", "db": "ok"}


def _resolved_database_url() -> str | None:
    """Return the DB URL the integration test will exercise, or ``None``.

    Preference order:

        1. ``DATABASE_URL_TEST`` — the dedicated test database URL the Seed
           introduces alongside ``DATABASE_URL`` (so the integration tier
           never accidentally writes to the production schema).
        2. ``DATABASE_URL`` — accepted as a fallback for developer machines
           that haven't split the URLs yet. The handler reads the same env
           var either way; this helper just picks the first one that's set.

    Both lookups go through ``os.environ`` directly (not through
    :func:`api.config.env.get_database_url`) so the skip check is fast and
    doesn't trigger a ``find_dotenv`` walk before pytest has even decided
    whether to collect the test.
    """
    candidate = os.environ.get("DATABASE_URL_TEST") or os.environ.get("DATABASE_URL")
    # An empty string is treated as "unset" so a stray ``DATABASE_URL=``
    # line in ``.env`` doesn't lure the integration test into running
    # against an invalid URL.
    if candidate is None or candidate == "":
        return None
    return candidate


# Skip decorator evaluated at collection time. We compute the resolved URL
# once and pass the bool to ``pytest.mark.skipif`` so the reason string can
# name the specific env var the developer needs to set.
_RESOLVED_URL: str | None = _resolved_database_url()


@pytest.mark.integration
@pytest.mark.skipif(
    _RESOLVED_URL is None,
    reason=(
        "Neither DATABASE_URL nor DATABASE_URL_TEST is set; skipping the "
        "real-Postgres integration test for GET /v1/db-health. To run it "
        "locally: `docker compose up -d postgres` then export "
        "DATABASE_URL_TEST=postgresql+asyncpg://<user>:<pass>@localhost:5432/<db>."
    ),
)
async def test_get_v1_db_health_returns_200_with_status_ok_and_db_ok(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``GET /v1/db-health`` → 200 ``{"status": "ok", "db": "ok"}``.

    The test:

        1. Promotes ``DATABASE_URL_TEST`` (or the existing ``DATABASE_URL``)
           into ``DATABASE_URL`` via :func:`monkeypatch.setenv` so
           :func:`api.config.env.get_database_url` resolves the test
           database URL the engine should bind to. Using ``monkeypatch``
           means the previous value is restored when the test exits.
        2. Resets the module-level engine cache so that a stale engine
           from a previous test (or pytest-xdist worker reuse) doesn't
           keep the test pinned to an outdated URL.
        3. Builds a fresh FastAPI app via :func:`api.main.create_app` and
           drives ``GET /v1/db-health`` through the ASGI transport.
        4. Asserts the status code is exactly 200 and the JSON body is
           exactly ``{"status": "ok", "db": "ok"}``.
        5. Disposes the engine on the way out so the asyncpg pool releases
           its connections cleanly (preventing a "connection still in use"
           warning at interpreter shutdown).
    """
    # Step 1 — promote the test URL into ``DATABASE_URL`` so the production
    # code path (which reads only ``DATABASE_URL``) is exercised verbatim.
    # ``_RESOLVED_URL`` is guaranteed non-None here by the ``skipif`` above,
    # but the explicit assert satisfies mypy --strict.
    assert _RESOLVED_URL is not None
    monkeypatch.setenv("DATABASE_URL", _RESOLVED_URL)

    # Step 2 — reset the engine cache so the next ``get_engine()`` call
    # rebuilds the engine against the URL we just set. Done via the
    # module's public reset hook (no private attribute access).
    from api.db import engine as engine_module

    await engine_module.reset_engine()

    # Step 3 — build the app and drive the request. ``create_app()`` is
    # called per test so dependency_overrides from any earlier test don't
    # bleed into this one (matches the precedent in test_health_endpoint.py).
    from api.main import create_app

    app = create_app()

    try:
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://testserver",
        ) as client:
            response = await client.get("/v1/db-health")

        # Step 4 — assert the exact wire shape.
        assert response.status_code == EXPECTED_STATUS_CODE, (
            f"Expected HTTP {EXPECTED_STATUS_CODE} from /v1/db-health, got "
            f"{response.status_code} with body {response.text!r}. The "
            f"common failure modes are: (a) Postgres container not running "
            f"(check `docker compose ps`), (b) DATABASE_URL points at a DB "
            f"that doesn't accept connections, or (c) the asyncpg driver "
            f"raised a SQLAlchemyError (which check_db_health swallows and "
            f"maps to 503)."
        )
        assert response.json() == EXPECTED_BODY, (
            f"Expected body {EXPECTED_BODY!r} from /v1/db-health, got "
            f"{response.json()!r}. The Phase 4.1 Seed pins the success "
            f"body to exactly these two fields; an extra field or a "
            f"drifted value indicates a contract regression."
        )
    finally:
        # Step 5 — dispose the engine so the asyncpg connection pool
        # releases its connections cleanly before the test exits. Wrapped
        # in ``try/finally`` so a failed assertion still triggers cleanup.
        await engine_module.reset_engine()
