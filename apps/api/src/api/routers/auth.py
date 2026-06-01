"""``POST /v1/auth/sign-in-with-apple`` route handler (Phase 4.3).

The single public entry point for Apple Sign In. Receives an
``identity_token`` from the mobile client, verifies it against Apple's
JWKS, upserts the corresponding ``users`` row, and returns a
backend-issued HS256 access token plus the inline user projection.

End-to-end flow:

1. Pydantic v2 validates the request body shape.
2. :func:`api.auth.apple_verifier.verify_apple_id_token` checks the
   token's RS256 signature, ``aud``, ``iss``, and ``exp``.
3. Body-vs-token email cross-validation rejects mismatches with HTTP 400.
4. Atomic ``INSERT ... ON CONFLICT (apple_sub) DO UPDATE`` upserts the
   user row. ``email``/``email_verified``/``display_name`` follow the
   COALESCE preservation rules from the Seed.
5. :func:`api.auth.backend_jwt.issue_backend_jwt` mints the access
   token with ``sub=users.id`` and a 24h TTL.
6. Response wraps the token + inline :class:`UserPublic` projection.

Failure mapping:

* Apple token invalid → HTTP 401 (``detail="invalid_apple_token"``).
* Body email mismatches token email → HTTP 400 (``detail="email_mismatch"``).
* Apple JWKS unavailable (circuit breaker exhausted) → HTTP 503.
* DB connectivity failure → HTTP 500 (via FastAPI default handling).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status

# SQLAlchemy primitives flow through api.db.session re-exports (see
# api/db/session.py __all__) so the AC11 single-import-boundary holds.
from api.auth.apple_jwks import AppleJwksClient, get_apple_jwks_client
from api.auth.apple_verifier import AppleTokenError, verify_apple_id_token
from api.auth.backend_jwt import JWT_ACCESS_TTL_SECONDS, issue_backend_jwt
from api.config.env import require_apple_bundle_id, require_jwt_secret
from api.db.models.user import (
    UNIQUE_CONSTRAINT_APPLE_SUB,
    UNIQUE_CONSTRAINT_REFERRAL_CODE,
    User,
    generate_referral_code,
)
from api.db.repositories.events_repository import insert_referral_attributed_event
from api.db.session import (
    AsyncSession,
    IntegrityError,
    func,
    get_session,
    pg_insert,
    select,
)
from api.referrals.attribution_event import REFERRAL_ATTRIBUTED_EVENT_NAME
from api.schemas.auth import (
    SignInWithAppleRequest,
    SignInWithAppleResponse,
    UserPublic,
)

router: APIRouter = APIRouter(tags=["auth"])

# Phase 4.5 — bounded retry budget for the per-user ``referral_code`` INSERT.
# Every new user gets an 8-char ``secrets.token_urlsafe(6)`` code generated
# app-side at sign-in upsert time. The code space is 2**48 so a collision on
# the ``uq_users_referral_code`` constraint is astronomically unlikely, but
# the Seed pins a bounded retry: regenerate the code up to this many times,
# then surface HTTP 500 rather than looping unbounded. (Re-auth never trips
# this path — the ON CONFLICT (apple_sub) DO UPDATE branch leaves the existing
# code untouched, so only brand-new identities exercise the unique check.)
REFERRAL_CODE_MAX_RETRIES: int = 3

# Phase 4.5 — referee → referrer attribution at Apple Sign In.
#
# The ``referral_attributed`` event written to the append-only ``events`` table
# whenever a fresh signup is successfully attributed to the user who referred
# them is assembled by :func:`build_referral_attributed_event` (the single
# source of truth for the row's ``event_name`` + ``properties`` shape). The
# :data:`REFERRAL_ATTRIBUTED_EVENT_NAME` constant is re-exported from that
# builder module and imported above so existing call sites / tests that read it
# off this router keep working.
#
# The four mutually-exclusive outcomes of an attribution attempt (the Seed's
# ``attribution_status`` concept). Only ``ATTRIBUTION_STATUS_ATTRIBUTED`` writes
# rows; every ``skipped_*`` outcome is a silent no-op that leaves sign-in
# unaffected. ``_SKIPPED_ERROR`` is the silent-degradation catch-all: any DB
# failure during the attribution writes is rolled back and swallowed so the
# already-committed user upsert (and therefore the sign-in) still succeeds.
ATTRIBUTION_STATUS_ATTRIBUTED: str = "attributed"
ATTRIBUTION_STATUS_SKIPPED_INVALID_CODE: str = "skipped_invalid_code"
ATTRIBUTION_STATUS_SKIPPED_SELF_REFERRAL: str = "skipped_self_referral"
ATTRIBUTION_STATUS_SKIPPED_ALREADY_ATTRIBUTED: str = "skipped_already_attributed"
ATTRIBUTION_STATUS_SKIPPED_ERROR: str = "skipped_error"


def get_jwks_client_dependency() -> AppleJwksClient:
    """``Depends``-injectable singleton accessor for the JWKS client.

    Wrapping :func:`get_apple_jwks_client` behind this thin shim lets
    tests use ``app.dependency_overrides[get_jwks_client_dependency]``
    to inject a respx-mocked or stub-backed client without touching the
    module-level singleton.
    """
    return get_apple_jwks_client()


def _is_referral_code_collision(exc: IntegrityError) -> bool:
    """Return True iff ``exc`` is a ``uq_users_referral_code`` unique violation.

    The auth upsert can raise an :class:`IntegrityError` for exactly one
    recoverable reason: the freshly generated ``referral_code`` collided with
    an existing row's code. asyncpg renders the violated constraint's name in
    the wrapped ``UniqueViolationError`` text (``duplicate key value violates
    unique constraint "uq_users_referral_code"``), so a substring match against
    the constraint identifier is sufficient — and avoids reaching for the
    asyncpg-specific ``.constraint_name`` attribute, which would couple this
    boundary-respecting router to the driver. Any other integrity failure
    (which should not occur — ``apple_sub`` collisions are absorbed by the ON
    CONFLICT clause) is re-raised unchanged.
    """
    return UNIQUE_CONSTRAINT_REFERRAL_CODE in str(exc.orig)


async def _upsert_user_with_referral_code(
    *,
    session: AsyncSession,
    apple_sub: str,
    incoming_email: str | None,
    incoming_email_verified: bool,
    incoming_display_name: str | None,
) -> User:
    """Atomically upsert the ``users`` row, minting a unique ``referral_code``.

    Builds the Seed-pinned ``INSERT ... ON CONFLICT (apple_sub) DO UPDATE``
    statement, generating the row UUID and an 8-char ``referral_code``
    app-side (consistent with the ``events.id`` precedent) so the values are
    known before the round-trip. ``referral_code`` is deliberately absent
    from the conflict-target SET clause: a re-auth that collides on
    ``apple_sub`` preserves the user's original code (codes are fixed per
    user). COALESCE preserves ``display_name``/``email`` on re-auth and
    ``email_verified`` tracks the JWT's latest (monotonic false→true) value.

    On the (astronomically unlikely) ``uq_users_referral_code`` collision the
    transaction is rolled back and the INSERT retried with a fresh code, up to
    :data:`REFERRAL_CODE_MAX_RETRIES` times. Exhausting the budget surfaces
    HTTP 500 rather than looping unbounded.
    """
    now = datetime.now(timezone.utc)
    last_collision: IntegrityError | None = None

    for _attempt in range(REFERRAL_CODE_MAX_RETRIES + 1):
        insert_stmt = pg_insert(User).values(
            id=uuid.uuid4(),
            apple_sub=apple_sub,
            email=incoming_email,
            email_verified=incoming_email_verified,
            display_name=incoming_display_name,
            referral_code=generate_referral_code(),
            created_at=now,
            updated_at=now,
        )
        upsert_stmt = insert_stmt.on_conflict_do_update(
            constraint=UNIQUE_CONSTRAINT_APPLE_SUB,
            set_={
                "email": func.coalesce(insert_stmt.excluded.email, User.email),
                "email_verified": insert_stmt.excluded.email_verified,
                "display_name": func.coalesce(
                    insert_stmt.excluded.display_name, User.display_name
                ),
                # updated_at always bumped — the SET clause runs on UPDATE
                # only, so this is harmless on initial INSERT (the VALUES
                # default already set it to ``now``).
                "updated_at": func.now(),
            },
        ).returning(User)

        try:
            result = await session.execute(upsert_stmt)
            upserted = result.scalar_one()
            await session.commit()
            return upserted
        except IntegrityError as exc:
            # Roll back the aborted transaction before re-issuing the INSERT;
            # asyncpg leaves the connection in a failed-transaction state until
            # the rollback clears it.
            await session.rollback()
            if not _is_referral_code_collision(exc):
                raise
            last_collision = exc

    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="referral_code_generation_failed",
    ) from last_collision


async def _attempt_referral_attribution(
    *,
    session: AsyncSession,
    referee: User,
    referral_code: str,
) -> str:
    """Attribute ``referee`` to the user owning ``referral_code`` (best-effort).

    Phase 4.5 attribution. Invoked only when the sign-in request carried a
    deep-link-stashed ``referral_code``. The attribution is **idempotent**,
    blocks **self-referral**, ignores **invalid codes**, and is wrapped so any
    DB failure degrades silently — the user upsert is already committed, so
    sign-in succeeds regardless of the outcome here.

    The two attribution writes — setting ``referee.referrer_user_id`` and
    inserting the :data:`REFERRAL_ATTRIBUTED_EVENT_NAME` event row — happen in
    a **single transaction** committed together. If either write fails the
    whole attribution is rolled back as a unit (no orphan event, no partial
    link), and the function returns :data:`ATTRIBUTION_STATUS_SKIPPED_ERROR`.

    Returns the :data:`attribution_status`-style outcome string (useful for
    tests / future telemetry); the caller intentionally ignores the value so
    every outcome is silent to the client.
    """
    # ---- Idempotency: an already-attributed referee is silently skipped.
    # This is the canonical "write referrer_user_id exactly once" guard — a
    # re-auth (or a duplicate sign-in) of an already-linked user never
    # re-attributes and never emits a second event.
    if referee.referrer_user_id is not None:
        return ATTRIBUTION_STATUS_SKIPPED_ALREADY_ATTRIBUTED

    try:
        # ---- Validity: resolve the referrer by their fixed per-user code.
        lookup = await session.execute(
            select(User).where(User.referral_code == referral_code)
        )
        referrer = lookup.scalar_one_or_none()
        if referrer is None:
            return ATTRIBUTION_STATUS_SKIPPED_INVALID_CODE

        # ---- Self-referral guard (application-level — the self-referential
        # FK permits it at the DB layer, so the check must live here).
        if referrer.id == referee.id:
            return ATTRIBUTION_STATUS_SKIPPED_SELF_REFERRAL

        # ---- Atomic write: referrer_user_id link + referral_attributed event.
        # Both are staged in the current transaction and committed as one unit.
        # The event row is persisted through the events repository's
        # ``insert_referral_attributed_event`` boundary (single source of truth
        # for the ``referral_attributed`` row's name + properties shape).
        referee.referrer_user_id = referrer.id
        session.add(referee)
        await insert_referral_attributed_event(
            session,
            referee_id=referee.id,
            referrer_id=referrer.id,
            referral_code=referral_code,
            occurred_at=datetime.now(timezone.utc),
        )
        await session.commit()
        return ATTRIBUTION_STATUS_ATTRIBUTED
    except Exception:  # silent_degradation: attribution must never break sign-in
        # Roll back the attribution writes only; the user upsert committed in
        # ``_upsert_user_with_referral_code`` is untouched. ``rollback`` also
        # expires ``referee`` so its in-memory ``referrer_user_id`` reverts to
        # the persisted (NULL) value rather than the optimistic assignment.
        await session.rollback()
        return ATTRIBUTION_STATUS_SKIPPED_ERROR


@router.post(
    "/auth/sign-in-with-apple",
    response_model=SignInWithAppleResponse,
    status_code=status.HTTP_200_OK,
    summary="Sign in with Apple",
    description=(
        "Verifies an Apple ID token, upserts the corresponding users "
        "row, and returns a backend-issued HS256 access token with a "
        "24h TTL plus the inline UserPublic projection. Public "
        "endpoint — no Authorization header required."
    ),
)
async def sign_in_with_apple(
    payload: SignInWithAppleRequest,
    session: AsyncSession = Depends(get_session),
    jwks_client: AppleJwksClient = Depends(get_jwks_client_dependency),
) -> SignInWithAppleResponse:
    """Handle the Apple Sign In sign-in / re-auth flow."""
    # ---- 1. Verify the Apple ID token.
    try:
        verified = await verify_apple_id_token(
            identity_token=payload.identity_token,
            apple_bundle_id=require_apple_bundle_id(),
            jwks_client=jwks_client,
        )
    except AppleTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid_apple_token",
        ) from exc

    # ---- 2. Body-vs-token email cross-validation.
    # If the client supplied an email in the body AND the token carries
    # one too, they must match. This defends against a client mixing
    # tokens (sending tokenA with the email from tokenB), which would
    # otherwise let the body email silently overwrite the row.
    if (
        payload.email is not None
        and verified.email is not None
        and payload.email != verified.email
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="email_mismatch",
        )

    # ---- 3. Resolve the canonical values for the upsert.
    # email: JWT-authoritative if present, body fallback, never NULL-overwrite.
    incoming_email = verified.email if verified.email is not None else payload.email
    # display_name: body-driven (Apple doesn't ship full_name on re-auth).
    # NULLIF('', existing) ensures empty strings are treated as null,
    # preventing the client from clearing the value with an empty payload.
    incoming_display_name = payload.full_name if payload.full_name else None
    incoming_email_verified = verified.email_verified

    # ---- 4. Atomic upsert via INSERT ... ON CONFLICT (with referral_code).
    upserted = await _upsert_user_with_referral_code(
        session=session,
        apple_sub=verified.sub,
        incoming_email=incoming_email,
        incoming_email_verified=incoming_email_verified,
        incoming_display_name=incoming_display_name,
    )

    # Re-fetch in a fresh statement so the row reflects any DB-side
    # COALESCE results (the RETURNING clause is reliable but explicit
    # re-read keeps the response invariant tied to the persisted state).
    refetch = await session.execute(select(User).where(User.id == upserted.id))
    user_row = refetch.scalar_one()

    # ---- 4b. Referral attribution (Phase 4.5) — best-effort, silent on failure.
    # Only runs when the mobile client forwarded a stashed ``referral_code``.
    # The helper enforces validity / self-referral / idempotency guards and
    # writes ``referrer_user_id`` + the ``referral_attributed`` event atomically
    # in their own transaction. The return value is intentionally ignored: every
    # outcome (attributed or any skipped_*) leaves the sign-in response
    # unchanged (Seed: silent_degradation, friend-used trigger = sign-in only).
    if payload.referral_code is not None:
        await _attempt_referral_attribution(
            session=session,
            referee=user_row,
            referral_code=payload.referral_code,
        )

    # ---- 5. Issue backend JWT.
    access_token = issue_backend_jwt(
        user_id=user_row.id,
        jwt_secret=require_jwt_secret(),
    )

    # ---- 6. Build and return the response.
    return SignInWithAppleResponse(
        access_token=access_token,
        token_type="bearer",
        expires_in=JWT_ACCESS_TTL_SECONDS,
        user=UserPublic(
            id=user_row.id,
            email=user_row.email,
            display_name=user_row.display_name,
            created_at=user_row.created_at,
        ),
    )


__all__ = [
    "REFERRAL_ATTRIBUTED_EVENT_NAME",
    "get_jwks_client_dependency",
    "router",
]
