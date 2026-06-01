"""Unit tests for referee → referrer attribution at Apple Sign In (Phase 4.5).

Phase 4.5 AC: *a fresh signup with a valid ``referral_code`` atomically writes
``referrer_user_id`` + a ``referral_attributed`` events row in the same
transaction.* These tests exercise the auth router's
``_attempt_referral_attribution`` helper directly with an in-memory fake
session (no real Postgres), plus a route-level smoke that drives the full
``POST /v1/auth/sign-in-with-apple`` flow with a forwarded ``referral_code``.

Coverage:

    * happy path — valid, non-self, un-attributed referee links to the
      referrer and emits exactly one ``referral_attributed`` event, committed
      together (atomic),
    * invalid code — unknown ``referral_code`` is silently skipped (no writes),
    * self-referral — a code that resolves to the referee itself is skipped,
    * already-attributed — a referee with a non-null ``referrer_user_id`` is
      idempotently skipped before any lookup,
    * silent degradation — a DB failure during the attribution writes is rolled
      back and swallowed (the helper returns the skipped-error status),
    * route smoke — sign-in with a ``referral_code`` still returns HTTP 200 and
      persists the attribution end-to-end.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient

from api.auth.apple_verifier import VerifiedAppleToken
from api.db.models.event import Event
from api.db.models.user import User
from api.db.session import get_session
from api.main import create_app
from api.routers.auth import (
    ATTRIBUTION_STATUS_ATTRIBUTED,
    ATTRIBUTION_STATUS_SKIPPED_ALREADY_ATTRIBUTED,
    ATTRIBUTION_STATUS_SKIPPED_ERROR,
    ATTRIBUTION_STATUS_SKIPPED_INVALID_CODE,
    ATTRIBUTION_STATUS_SKIPPED_SELF_REFERRAL,
    REFERRAL_ATTRIBUTED_EVENT_NAME,
    _attempt_referral_attribution,
    get_jwks_client_dependency,
)


def _build_user(
    *, referral_code: str, referrer_user_id: uuid.UUID | None = None
) -> User:
    """Construct a minimal in-memory :class:`User` row (no DB round-trip)."""
    now = datetime.now(timezone.utc)
    user = User()
    user.id = uuid.uuid4()
    user.apple_sub = f"sub-{user.id}"
    user.email = "user@example.com"
    user.email_verified = True
    user.display_name = "Tester"
    user.referral_code = referral_code
    user.referrer_user_id = referrer_user_id
    user.created_at = now
    user.updated_at = now
    return user


class _ScalarResult:
    """SQLAlchemy ``Result`` double exposing the two scalar accessors."""

    def __init__(self, value: Any) -> None:
        self._value = value

    def scalar_one(self) -> Any:
        return self._value

    def scalar_one_or_none(self) -> Any:
        return self._value


class _AttributionSession:
    """In-memory AsyncSession double for the attribution helper.

    The referrer lookup ``execute`` returns the configured ``referrer`` (or
    ``None`` to model an invalid code). ``add``/``flush`` capture the staged
    event row; ``commit``/``rollback`` are counted. ``fail_on`` injects a DB
    failure at the named step to exercise the silent-degradation path.
    """

    def __init__(
        self, *, referrer: User | None = None, fail_on: str | None = None
    ) -> None:
        self._referrer = referrer
        self._fail_on = fail_on
        self.added: list[Any] = []
        self.commits = 0
        self.rollbacks = 0
        self.flushes = 0
        self.execute_calls = 0

    async def execute(self, statement: Any) -> _ScalarResult:
        self.execute_calls += 1
        return _ScalarResult(self._referrer)

    def add(self, obj: Any) -> None:
        self.added.append(obj)

    async def flush(self) -> None:
        self.flushes += 1
        if self._fail_on == "flush":
            raise RuntimeError("simulated flush failure")

    async def commit(self) -> None:
        if self._fail_on == "commit":
            raise RuntimeError("simulated commit failure")
        self.commits += 1

    async def rollback(self) -> None:
        self.rollbacks += 1

    @property
    def events(self) -> list[Event]:
        return [obj for obj in self.added if isinstance(obj, Event)]


@pytest.mark.unit
async def test_attribution_success_writes_link_and_event_atomically() -> None:
    """Valid, non-self, un-attributed referee → link + one event, committed."""
    referrer = _build_user(referral_code="REFERER1")
    referee = _build_user(referral_code="REFEREE1")
    session = _AttributionSession(referrer=referrer)

    status_ = await _attempt_referral_attribution(
        session=session,  # type: ignore[arg-type]
        referee=referee,
        referral_code="REFERER1",
    )

    assert status_ == ATTRIBUTION_STATUS_ATTRIBUTED
    # referrer_user_id link written.
    assert referee.referrer_user_id == referrer.id
    # Exactly one referral_attributed event with the referrer/code properties.
    assert len(session.events) == 1
    event = session.events[0]
    assert event.event_name == REFERRAL_ATTRIBUTED_EVENT_NAME
    assert event.user_id == referee.id
    assert event.properties == {
        "referrer_id": str(referrer.id),
        "referral_code": "REFERER1",
    }
    # Both writes committed together; no rollback.
    assert session.commits == 1
    assert session.rollbacks == 0


@pytest.mark.unit
async def test_attribution_invalid_code_is_silently_skipped() -> None:
    """An unknown referral_code resolves to no referrer → no writes."""
    referee = _build_user(referral_code="REFEREE1")
    session = _AttributionSession(referrer=None)

    status_ = await _attempt_referral_attribution(
        session=session,  # type: ignore[arg-type]
        referee=referee,
        referral_code="GHOST000",
    )

    assert status_ == ATTRIBUTION_STATUS_SKIPPED_INVALID_CODE
    assert referee.referrer_user_id is None
    assert session.events == []
    assert session.commits == 0


@pytest.mark.unit
async def test_attribution_self_referral_is_blocked() -> None:
    """A code that resolves to the referee itself is skipped (no self-link)."""
    referee = _build_user(referral_code="SELFCODE")
    session = _AttributionSession(referrer=referee)

    status_ = await _attempt_referral_attribution(
        session=session,  # type: ignore[arg-type]
        referee=referee,
        referral_code="SELFCODE",
    )

    assert status_ == ATTRIBUTION_STATUS_SKIPPED_SELF_REFERRAL
    assert referee.referrer_user_id is None
    assert session.events == []
    assert session.commits == 0


@pytest.mark.unit
async def test_attribution_already_attributed_is_idempotent() -> None:
    """A referee with an existing referrer_user_id is skipped before lookup."""
    existing_referrer_id = uuid.uuid4()
    referee = _build_user(
        referral_code="REFEREE1", referrer_user_id=existing_referrer_id
    )
    session = _AttributionSession(referrer=_build_user(referral_code="REFERER1"))

    status_ = await _attempt_referral_attribution(
        session=session,  # type: ignore[arg-type]
        referee=referee,
        referral_code="REFERER1",
    )

    assert status_ == ATTRIBUTION_STATUS_SKIPPED_ALREADY_ATTRIBUTED
    # Idempotent: the original link is untouched and no lookup was issued.
    assert referee.referrer_user_id == existing_referrer_id
    assert session.execute_calls == 0
    assert session.events == []
    assert session.commits == 0


@pytest.mark.unit
async def test_attribution_db_failure_degrades_silently() -> None:
    """A DB failure during the writes rolls back and is swallowed."""
    referrer = _build_user(referral_code="REFERER1")
    referee = _build_user(referral_code="REFEREE1")
    session = _AttributionSession(referrer=referrer, fail_on="flush")

    status_ = await _attempt_referral_attribution(
        session=session,  # type: ignore[arg-type]
        referee=referee,
        referral_code="REFERER1",
    )

    assert status_ == ATTRIBUTION_STATUS_SKIPPED_ERROR
    assert session.commits == 0
    assert session.rollbacks == 1


# --------------------------------------------------------------------------- #
# Route-level smoke: sign-in with a referral_code still returns HTTP 200 and
# persists the attribution end-to-end.
# --------------------------------------------------------------------------- #


class _StubJwksClient:
    """No-op JWKS client — the verifier is stubbed so this is never called."""

    async def get_keys(self) -> dict[str, object]:  # pragma: no cover
        return {}


class _RouteSession:
    """Route-level AsyncSession double for the full sign-in + attribution flow.

    Statement routing:
        * the ``INSERT ... ON CONFLICT`` upsert builds + persists the referee,
        * the first follow-up ``SELECT`` is the refetch-by-id (``scalar_one``),
        * the second follow-up ``SELECT`` is the referrer lookup-by-code
          (``scalar_one_or_none``) and returns the configured referrer.
    """

    def __init__(
        self,
        *,
        referrer: User | None,
        referral_code: str,
        referrer_is_self: bool = False,
        persisted_referrer_user_id: uuid.UUID | None = None,
    ) -> None:
        self._referrer = referrer
        self._referral_code = referral_code
        # When True the referrer lookup resolves to the freshly persisted
        # referee itself, modelling the self-referral skip path end-to-end.
        self._referrer_is_self = referrer_is_self
        # When set the upserted row already carries a referrer_user_id,
        # modelling a re-auth of an already-attributed referee (idempotent
        # skip — the helper returns before issuing the lookup).
        self._persisted_referrer_user_id = persisted_referrer_user_id
        self.persisted: User | None = None
        self.added: list[Any] = []
        self.commits = 0
        self.rollbacks = 0
        self._select_calls = 0

    async def execute(self, statement: Any) -> _ScalarResult:
        if "Insert" in type(statement).__name__:
            self.persisted = _build_user(
                referral_code=self._referral_code,
                referrer_user_id=self._persisted_referrer_user_id,
            )
            return _ScalarResult(self.persisted)
        self._select_calls += 1
        if self._select_calls == 1:
            return _ScalarResult(self.persisted)
        if self._referrer_is_self:
            return _ScalarResult(self.persisted)
        return _ScalarResult(self._referrer)

    def add(self, obj: Any) -> None:
        self.added.append(obj)

    async def flush(self) -> None:
        return None

    async def commit(self) -> None:
        self.commits += 1

    async def rollback(self) -> None:
        self.rollbacks += 1

    @property
    def events(self) -> list[Event]:
        return [obj for obj in self.added if isinstance(obj, Event)]


def _build_app(monkeypatch: pytest.MonkeyPatch, *, fake: _RouteSession) -> Any:
    monkeypatch.setenv("JWT_SECRET", "unit-test-secret-padded-to-32+bytes-long")
    monkeypatch.setenv("APPLE_BUNDLE_ID", "com.personalcolorkr.app.test")

    async def _stub_verify(
        *, identity_token: str, apple_bundle_id: str, jwks_client: Any
    ) -> VerifiedAppleToken:
        return VerifiedAppleToken(
            sub="sub-route-attribution",
            email="user@example.com",
            email_verified=True,
        )

    monkeypatch.setattr("api.routers.auth.verify_apple_id_token", _stub_verify)
    monkeypatch.setattr("api.routers.auth.generate_referral_code", lambda: "REFEREE1")

    app = create_app()

    async def _override_session() -> AsyncIterator[_RouteSession]:
        yield fake

    app.dependency_overrides[get_session] = _override_session
    app.dependency_overrides[get_jwks_client_dependency] = lambda: _StubJwksClient()
    return app


@pytest.mark.unit
async def test_route_sign_in_with_referral_code_attributes_and_returns_200(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """End-to-end: sign-in forwarding a valid code links + emits the event."""
    referrer = _build_user(referral_code="REFERER1")
    fake = _RouteSession(referrer=referrer, referral_code="REFEREE1")
    app = _build_app(monkeypatch, fake=fake)

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        response = await client.post(
            "/v1/auth/sign-in-with-apple",
            json={
                "identity_token": "stubbed-by-monkeypatch",
                "full_name": "Tester",
                "email": "user@example.com",
                "referral_code": "REFERER1",
            },
        )

    assert response.status_code == 200, response.text
    assert fake.persisted is not None
    assert fake.persisted.referrer_user_id == referrer.id
    assert len(fake.events) == 1
    assert fake.events[0].event_name == REFERRAL_ATTRIBUTED_EVENT_NAME
    # Upsert commit (1) + attribution commit (1).
    assert fake.commits == 2


@pytest.mark.unit
async def test_route_sign_in_with_invalid_code_still_succeeds(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Sign-in with an unknown referral_code skips attribution but returns 200."""
    fake = _RouteSession(referrer=None, referral_code="REFEREE1")
    app = _build_app(monkeypatch, fake=fake)

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        response = await client.post(
            "/v1/auth/sign-in-with-apple",
            json={
                "identity_token": "stubbed-by-monkeypatch",
                "referral_code": "GHOST000",
            },
        )

    assert response.status_code == 200, response.text
    assert fake.persisted is not None
    assert fake.persisted.referrer_user_id is None
    assert fake.events == []
    # Only the upsert commit; attribution skipped (invalid code).
    assert fake.commits == 1


@pytest.mark.unit
async def test_route_sign_in_with_self_referral_still_succeeds(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A code resolving to the signer itself skips attribution but returns 200."""
    # ``referrer_is_self`` makes the referrer lookup resolve to the freshly
    # persisted referee, so the application-level self-referral guard trips.
    fake = _RouteSession(referrer=None, referral_code="REFEREE1", referrer_is_self=True)
    app = _build_app(monkeypatch, fake=fake)

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        response = await client.post(
            "/v1/auth/sign-in-with-apple",
            json={
                "identity_token": "stubbed-by-monkeypatch",
                "referral_code": "REFEREE1",
            },
        )

    assert response.status_code == 200, response.text
    assert fake.persisted is not None
    # No self-link written, no event emitted.
    assert fake.persisted.referrer_user_id is None
    assert fake.events == []
    # Only the upsert commit; attribution skipped (self-referral).
    assert fake.commits == 1


@pytest.mark.unit
async def test_route_sign_in_with_already_attributed_still_succeeds(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Re-auth of an already-attributed referee skips re-attribution, returns 200."""
    existing_referrer_id = uuid.uuid4()
    referrer = _build_user(referral_code="REFERER1")
    # ``persisted_referrer_user_id`` models the upserted row already carrying a
    # referrer link (a prior sign-in attributed it), so the idempotency guard
    # short-circuits before any lookup or write.
    fake = _RouteSession(
        referrer=referrer,
        referral_code="REFEREE1",
        persisted_referrer_user_id=existing_referrer_id,
    )
    app = _build_app(monkeypatch, fake=fake)

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        response = await client.post(
            "/v1/auth/sign-in-with-apple",
            json={
                "identity_token": "stubbed-by-monkeypatch",
                "referral_code": "REFERER1",
            },
        )

    assert response.status_code == 200, response.text
    assert fake.persisted is not None
    # The original link is untouched; no second event emitted.
    assert fake.persisted.referrer_user_id == existing_referrer_id
    assert fake.events == []
    # Only the upsert commit; attribution idempotently skipped.
    assert fake.commits == 1
