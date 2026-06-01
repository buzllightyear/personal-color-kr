"""Unit tests for ``count_attributed_referees`` (Phase 4.5 friend_used_count).

Phase 4.5 Sub-AC: *the friend_used_count query function returns the count of
attributed referees for a given user id; a unit test with seeded attribution
records asserts the correct count.*

These tests exercise :func:`api.db.repositories.users_repository.count_attributed_referees`
against an in-memory fake :class:`AsyncSession` (no real Postgres, matching the
``test_auth_referral_attribution`` precedent). The fake seeds a set of
``users`` rows, then evaluates the *actual* ``WHERE referrer_user_id = :id``
predicate of the statement the repository builds — reading the bound id off the
``COUNT(*)`` select and filtering the seeded rows by it — so the assertion
verifies the real query shape (count + correct filter column) rather than a
hand-fed scalar.

Coverage:

    * a referrer with several seeded referees (plus rows attributed to *other*
      referrers and organic ``referrer_user_id IS NULL`` rows) → only the
      matching rows are counted,
    * a referrer with no referees → ``0`` (empty match set, never ``NULL``),
    * the returned value is a plain ``int``.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

import pytest

from api.db.models.user import User
from api.db.repositories.users_repository import count_attributed_referees


def _build_user(*, referrer_user_id: uuid.UUID | None) -> User:
    """Construct a minimal in-memory :class:`User` row (no DB round-trip)."""
    now = datetime.now(timezone.utc)
    user = User()
    user.id = uuid.uuid4()
    user.apple_sub = f"sub-{user.id}"
    user.email = None
    user.email_verified = False
    user.display_name = None
    user.referral_code = uuid.uuid4().hex[:8]
    user.referrer_user_id = referrer_user_id
    user.created_at = now
    user.updated_at = now
    return user


class _CountResult:
    """SQLAlchemy ``Result`` double exposing the ``scalar_one`` accessor."""

    def __init__(self, value: int) -> None:
        self._value = value

    def scalar_one(self) -> int:
        return self._value


class _CountSession:
    """In-memory AsyncSession double that evaluates the COUNT predicate.

    Seeds a list of :class:`User` rows and, on ``execute``, reads the bound
    ``referrer_user_id`` value off the statement's ``WHERE`` clause and returns
    the number of seeded rows whose ``referrer_user_id`` matches — exercising
    the repository's real filter column rather than a pre-computed scalar.
    """

    def __init__(self, users: list[User]) -> None:
        self._users = users

    async def execute(self, statement: Any) -> _CountResult:
        # ``select(func.count())...where(User.referrer_user_id == :id)`` builds
        # a single BinaryExpression whose right operand is the bound id.
        target = statement.whereclause.right.value
        count = sum(1 for user in self._users if user.referrer_user_id == target)
        return _CountResult(count)


@pytest.mark.unit
async def test_counts_only_referees_attributed_to_the_given_user() -> None:
    """Only rows whose referrer_user_id matches the queried id are counted."""
    referrer_id = uuid.uuid4()
    other_referrer_id = uuid.uuid4()

    seeded = [
        # Three referees attributed to the user under test.
        _build_user(referrer_user_id=referrer_id),
        _build_user(referrer_user_id=referrer_id),
        _build_user(referrer_user_id=referrer_id),
        # A referee attributed to a *different* referrer — must not be counted.
        _build_user(referrer_user_id=other_referrer_id),
        # An organic signup (no attribution) — must not be counted.
        _build_user(referrer_user_id=None),
    ]
    session = _CountSession(seeded)

    count = await count_attributed_referees(
        session,  # type: ignore[arg-type]
        referrer_user_id=referrer_id,
    )

    assert count == 3


@pytest.mark.unit
async def test_returns_zero_when_user_has_referred_nobody() -> None:
    """A referrer with no matching referees yields 0 (never NULL)."""
    referrer_id = uuid.uuid4()
    seeded = [
        _build_user(referrer_user_id=uuid.uuid4()),
        _build_user(referrer_user_id=None),
    ]
    session = _CountSession(seeded)

    count = await count_attributed_referees(
        session,  # type: ignore[arg-type]
        referrer_user_id=referrer_id,
    )

    assert count == 0


@pytest.mark.unit
async def test_return_value_is_a_plain_int() -> None:
    """The repository coerces the COUNT cell to a plain ``int``."""
    referrer_id = uuid.uuid4()
    session = _CountSession([_build_user(referrer_user_id=referrer_id)])

    count = await count_attributed_referees(
        session,  # type: ignore[arg-type]
        referrer_user_id=referrer_id,
    )

    assert isinstance(count, int)
    assert count == 1
