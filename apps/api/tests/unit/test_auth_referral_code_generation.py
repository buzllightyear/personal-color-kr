"""Unit tests for ``referral_code`` minting at the Apple Sign In upsert.

Phase 4.5 AC: *every authenticated user has a ``referral_code`` generated at
sign-in upsert time.* These tests exercise the auth router's
``_upsert_user_with_referral_code`` helper through the public
``POST /v1/auth/sign-in-with-apple`` route with an in-memory fake session
(no real Postgres), covering:

    * the happy path — a brand-new sign-in persists a generated code,
    * the bounded collision-retry — a ``uq_users_referral_code`` unique
      violation is caught, the transaction rolled back, and the INSERT retried
      with a fresh code,
    * retry exhaustion — more collisions than the budget surfaces HTTP 500,
    * a non-referral integrity error is re-raised (not swallowed).

The Apple verifier is monkeypatched so no real Apple ID token is needed, and
``generate_referral_code`` is monkeypatched with a deterministic recorder so
the persisted code is assertable.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator, Iterable
from datetime import datetime, timezone
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.exc import IntegrityError

from api.auth.apple_verifier import VerifiedAppleToken
from api.db.models.user import User
from api.db.session import get_session
from api.main import create_app
from api.routers.auth import (
    REFERRAL_CODE_MAX_RETRIES,
    _upsert_user_with_referral_code,
    get_jwks_client_dependency,
)


class _CodeRecorder:
    """Deterministic stand-in for ``generate_referral_code``.

    Yields codes from a fixed sequence and records every code it issued so a
    test can assert which code was ultimately persisted.
    """

    def __init__(self, codes: Iterable[str]) -> None:
        self._codes = iter(codes)
        self.issued: list[str] = []

    def __call__(self) -> str:
        code = next(self._codes)
        self.issued.append(code)
        return code


class _StubJwksClient:
    """No-op JWKS client — the verifier is stubbed so this is never called."""

    async def get_keys(self) -> dict[str, object]:  # pragma: no cover
        return {}


class _FakeResult:
    """Minimal SQLAlchemy ``Result`` stand-in exposing ``scalar_one``."""

    def __init__(self, row: User) -> None:
        self._row = row

    def scalar_one(self) -> User:
        return self._row


def _referral_collision_error() -> IntegrityError:
    """Build an IntegrityError that mimics an asyncpg unique violation.

    asyncpg renders the violated constraint name in the wrapped exception
    text; the router's collision detector matches on that substring.
    """
    return IntegrityError(
        statement="INSERT INTO users ...",
        params=None,
        orig=Exception(
            "duplicate key value violates unique constraint " '"uq_users_referral_code"'
        ),
    )


class _FakeSession:
    """In-memory AsyncSession double recording upsert / commit / rollback.

    The upsert ``execute`` raises a referral-code collision for the first
    ``fail_times`` calls, then succeeds — building a :class:`User` row stamped
    with the most recently issued code. The refetch ``SELECT`` returns that
    same row.
    """

    def __init__(self, *, recorder: _CodeRecorder, fail_times: int = 0) -> None:
        self._recorder = recorder
        self._fail_times = fail_times
        self.upsert_calls = 0
        self.commits = 0
        self.rollbacks = 0
        self.persisted: User | None = None

    async def execute(self, statement: Any) -> _FakeResult:
        if "Insert" in type(statement).__name__:
            self.upsert_calls += 1
            if self.upsert_calls <= self._fail_times:
                raise _referral_collision_error()
            self.persisted = self._build_user(self._recorder.issued[-1])
            return _FakeResult(self.persisted)
        # The refetch SELECT — return the row persisted by the upsert.
        assert self.persisted is not None
        return _FakeResult(self.persisted)

    async def commit(self) -> None:
        self.commits += 1

    async def rollback(self) -> None:
        self.rollbacks += 1

    @staticmethod
    def _build_user(referral_code: str) -> User:
        now = datetime.now(timezone.utc)
        user = User()
        user.id = uuid.uuid4()
        user.apple_sub = "sub-referral-test"
        user.email = "user@example.com"
        user.email_verified = True
        user.display_name = "Tester"
        user.referral_code = referral_code
        user.created_at = now
        user.updated_at = now
        return user


def _build_app(
    monkeypatch: pytest.MonkeyPatch,
    *,
    recorder: _CodeRecorder,
    fake: _FakeSession,
) -> Any:
    monkeypatch.setenv("JWT_SECRET", "unit-test-secret-padded-to-32+bytes-long")
    monkeypatch.setenv("APPLE_BUNDLE_ID", "com.personalcolorkr.app.test")

    async def _stub_verify(
        *, identity_token: str, apple_bundle_id: str, jwks_client: Any
    ) -> VerifiedAppleToken:
        return VerifiedAppleToken(
            sub="sub-referral-test",
            email="user@example.com",
            email_verified=True,
        )

    monkeypatch.setattr("api.routers.auth.verify_apple_id_token", _stub_verify)
    monkeypatch.setattr("api.routers.auth.generate_referral_code", recorder)

    app = create_app()

    async def _override_session() -> AsyncIterator[_FakeSession]:
        yield fake

    app.dependency_overrides[get_session] = _override_session
    app.dependency_overrides[get_jwks_client_dependency] = lambda: _StubJwksClient()
    return app


async def _sign_in(app: Any) -> Any:
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        return await client.post(
            "/v1/auth/sign-in-with-apple",
            json={
                "identity_token": "stubbed-by-monkeypatch",
                "full_name": "Tester",
                "email": "user@example.com",
            },
        )


@pytest.mark.unit
async def test_sign_in_generates_referral_code_at_upsert(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A brand-new sign-in persists an app-generated referral_code (1 INSERT)."""
    recorder = _CodeRecorder(["CODE0001"])
    fake = _FakeSession(recorder=recorder)
    app = _build_app(monkeypatch, recorder=recorder, fake=fake)

    response = await _sign_in(app)

    assert response.status_code == 200, response.text
    assert fake.upsert_calls == 1
    assert fake.commits == 1
    assert fake.rollbacks == 0
    assert recorder.issued == ["CODE0001"]
    assert fake.persisted is not None
    assert fake.persisted.referral_code == "CODE0001"


@pytest.mark.unit
async def test_sign_in_retries_referral_code_collision_then_succeeds(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Two collisions roll back and retry; the third fresh code is persisted."""
    codes = ["DUPE0001", "DUPE0002", "UNIQ0003"]
    recorder = _CodeRecorder(codes)
    fake = _FakeSession(recorder=recorder, fail_times=2)
    app = _build_app(monkeypatch, recorder=recorder, fake=fake)

    response = await _sign_in(app)

    assert response.status_code == 200, response.text
    assert fake.upsert_calls == 3
    assert fake.rollbacks == 2
    assert fake.commits == 1
    assert recorder.issued == codes
    assert fake.persisted is not None
    assert fake.persisted.referral_code == "UNIQ0003"


@pytest.mark.unit
async def test_sign_in_exhausts_referral_code_retries_returns_500(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """More collisions than the bounded budget surfaces HTTP 500."""
    # One more colliding code than the total attempt budget so every attempt
    # fails and the loop exhausts.
    total_attempts = REFERRAL_CODE_MAX_RETRIES + 1
    codes = [f"DUPE{n:04d}" for n in range(total_attempts)]
    recorder = _CodeRecorder(codes)
    fake = _FakeSession(recorder=recorder, fail_times=total_attempts)
    app = _build_app(monkeypatch, recorder=recorder, fake=fake)

    response = await _sign_in(app)

    assert response.status_code == 500, response.text
    assert response.json()["detail"] == "referral_code_generation_failed"
    assert fake.upsert_calls == total_attempts
    assert fake.rollbacks == total_attempts
    assert fake.commits == 0


@pytest.mark.unit
async def test_upsert_reraises_non_referral_integrity_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A non-referral integrity error is not swallowed by the retry loop.

    Exercises the helper directly: a NOT-NULL violation (a constraint other
    than ``uq_users_referral_code``) must propagate after a single rollback
    rather than being absorbed by the bounded collision retry.
    """

    class _OtherErrorSession(_FakeSession):
        async def execute(self, statement: Any) -> _FakeResult:
            if "Insert" in type(statement).__name__:
                self.upsert_calls += 1
                raise IntegrityError(
                    statement="INSERT INTO users ...",
                    params=None,
                    orig=Exception(
                        'null value in column "apple_sub" violates not-null '
                        "constraint"
                    ),
                )
            raise AssertionError("refetch should not be reached")  # pragma: no cover

    recorder = _CodeRecorder(["CODE0001", "CODE0002"])
    fake = _OtherErrorSession(recorder=recorder)
    monkeypatch.setattr("api.routers.auth.generate_referral_code", recorder)

    with pytest.raises(IntegrityError):
        await _upsert_user_with_referral_code(
            session=fake,  # type: ignore[arg-type]
            apple_sub="sub-referral-test",
            incoming_email="user@example.com",
            incoming_email_verified=True,
            incoming_display_name="Tester",
        )

    # Exactly one attempt — the non-referral error short-circuits the retry.
    assert fake.upsert_calls == 1
    assert fake.rollbacks == 1
    assert fake.commits == 0
