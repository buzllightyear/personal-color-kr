"""``GET /v1/referrals/me`` route handler (Phase 4.5).

Authenticated read of the calling user's referral surface. The handler
assembles the three Seed-pinned values and projects them onto
:class:`api.schemas.referrals.ReferralMeResponse`:

    1. ``referral_code`` — the user's per-user fixed 8-char URL-safe code
       (``users.referral_code``), issued at sign-in upsert and never
       rotated. Read straight off the authenticated :class:`User` row.
    2. ``share_url`` — the *server-assembled* full share URL, built by
       :func:`api.referrals.share_url.build_share_url` from the
       ``REFERRAL_BASE_URL`` env var + the user's ``referral_code``. The
       server is the single source of truth for this string (Seed:
       single_source_of_truth); the mobile client never assembles it.
    3. ``friend_used_count`` — the live count of users whose
       ``referrer_user_id`` equals this user's id, read through the
       :func:`api.db.repositories.users_repository.count_attributed_referees`
       SQL boundary (no reward/entitlement mechanics ride on it in 4.5).

Auth contract (Seed-pinned, inherited from ``require_current_user``):

    * No / malformed bearer token → HTTP 401 ``invalid_authorization``
      (the handler body never runs; the dependency raises first).
    * Valid token, missing ``users.id`` row → HTTP 403 ``user_not_found``.
    * Valid token, live user → HTTP 200 with the assembled response body.

No ``sqlalchemy*`` import here: the only DB access flows through the
users repository, which lives inside the ``api.db`` import boundary. The
:class:`User` import is for the dependency-return type annotation only
(matching the established ``events`` / ``metrics`` router pattern).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, status

from api.db.models.user import User
from api.db.repositories.users_repository import count_attributed_referees
from api.db.session import AsyncSession, get_session
from api.dependencies.auth import require_current_user
from api.referrals.share_url import build_share_url
from api.schemas.referrals import ReferralMeResponse

#: Router hosting ``GET /v1/referrals/me``. The ``/v1`` prefix is applied
#: by ``api.main.create_app``.
router: APIRouter = APIRouter(tags=["referrals"])


@router.get(
    "/referrals/me",
    response_model=ReferralMeResponse,
    status_code=status.HTTP_200_OK,
    summary="Return the authenticated user's referral code, share URL, and friend count",
    description=(
        "Returns the calling user's per-user fixed referral code, the "
        "server-assembled share URL (REFERRAL_BASE_URL + code — the server "
        "is the single source of truth), and the live count of friends who "
        "signed in through this user's referral. Requires a valid backend JWT."
    ),
)
async def get_referrals_me(
    current_user: User = Depends(require_current_user),
    session: AsyncSession = Depends(get_session),
) -> ReferralMeResponse:
    """Assemble and return the authenticated user's referral surface.

    Parameters
    ----------
    current_user:
        The authenticated :class:`User` from ``require_current_user``.
        Source of both the fixed ``referral_code`` and the id used to
        count attributed referees.
    session:
        Per-request :class:`AsyncSession` used to count referees.

    Returns
    -------
    ReferralMeResponse
        HTTP 200 body carrying ``referral_code``, the server-assembled
        ``share_url``, and the live ``friend_used_count``.
    """
    friend_used_count = await count_attributed_referees(
        session,
        referrer_user_id=current_user.id,
    )
    share_url = build_share_url(current_user.referral_code)
    return ReferralMeResponse(
        referral_code=current_user.referral_code,
        share_url=share_url,
        friend_used_count=friend_used_count,
    )


__all__ = ["router"]
