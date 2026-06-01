"""SQL access boundary for ``users``-table referral reads (Phase 4.5).

This repository is the sanctioned read surface for the referral-attribution
columns the Phase 4.5 Seed added to the ``users`` table
(``referrer_user_id``). It exists so the ``GET /v1/referrals/me`` handler can
project a user's **friend-used count** without importing the :class:`User`
ORM model directly — the model docstring pins the rule that only the auth
router may import :class:`User` among the ``api.routers`` modules. Routes and
services depend on this typed function surface instead.

# Why a repository (vs. inline ORM in the referrals router)?

The same rationale the events repository documents applies here: the
``friend_used_count`` query shape lives in exactly one file, so a schema or
semantics change (e.g. excluding soft-deleted referees in a later phase) has a
single call site to audit. The referrals router stays DB-ignorant — it calls
:func:`count_attributed_referees` and renders the integer.

# SQLAlchemy import boundary (AC11)

This file lives under ``apps/api/src/api/db/`` (inside the boundary) and sources
every SQL primitive (``select``, ``func``) from the :mod:`api.db.session`
re-export surface rather than importing ``sqlalchemy`` directly.

# friend_used_count semantics (Seed ontology)

``friend_used_count`` is the count of users whose ``referrer_user_id`` equals
the queried user's id — i.e. how many friends signed in through this user's
referral. Attribution is written exactly once at Apple Sign In completion
(``api.routers.auth._attempt_referral_attribution``); this read is a pure
``COUNT(*)`` over that column with no reward/entitlement mechanics riding on the
number (deferred to Phase 5+). A user who has referred nobody yields ``0``
(never ``NULL`` — ``COUNT`` of an empty match set is zero).
"""

from __future__ import annotations

import uuid

from api.db.models.user import User
from api.db.session import AsyncSession, func, select


async def count_attributed_referees(
    session: AsyncSession,
    *,
    referrer_user_id: uuid.UUID,
) -> int:
    """Return the ``friend_used_count`` for ``referrer_user_id``.

    Counts every ``users`` row whose ``referrer_user_id`` equals the given id
    — the set of friends attributed to this user at their Apple Sign In. The
    query is a single ``SELECT COUNT(*) FROM users WHERE referrer_user_id = :id``
    issued through the ORM column expression so the predicate cannot drift from
    the model definition.

    Parameters
    ----------
    session:
        The per-request :class:`AsyncSession` from
        :func:`api.db.session.get_session`.
    referrer_user_id:
        The authenticated user's id. Counts the users this user referred.

    Returns
    -------
    int
        The number of attributed referees. ``0`` when the user has referred
        nobody (an empty match set, never ``NULL``).
    """
    stmt = (
        select(func.count())
        .select_from(User)
        .where(User.referrer_user_id == referrer_user_id)
    )
    result = await session.execute(stmt)
    # ``scalar_one`` returns the single ``COUNT(*)`` cell; coerce to ``int`` so
    # the typed return contract holds under mypy --strict (the driver hands the
    # value back as ``Any``).
    return int(result.scalar_one())


__all__ = ["count_attributed_referees"]
