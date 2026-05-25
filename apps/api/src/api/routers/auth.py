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
from api.db.models.user import User
from api.db.session import AsyncSession, func, get_session, pg_insert, select
from api.schemas.auth import (
    SignInWithAppleRequest,
    SignInWithAppleResponse,
    UserPublic,
)

router: APIRouter = APIRouter(tags=["auth"])


def get_jwks_client_dependency() -> AppleJwksClient:
    """``Depends``-injectable singleton accessor for the JWKS client.

    Wrapping :func:`get_apple_jwks_client` behind this thin shim lets
    tests use ``app.dependency_overrides[get_jwks_client_dependency]``
    to inject a respx-mocked or stub-backed client without touching the
    module-level singleton.
    """
    return get_apple_jwks_client()


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

    # ---- 4. Atomic upsert via INSERT ... ON CONFLICT.
    # Generate the row's UUID app-side (consistent with the events.id
    # pattern) so the row identity is known before the round-trip.
    new_user_id = uuid.uuid4()
    now = datetime.now(timezone.utc)

    insert_stmt = pg_insert(User).values(
        id=new_user_id,
        apple_sub=verified.sub,
        email=incoming_email,
        email_verified=incoming_email_verified,
        display_name=incoming_display_name,
        created_at=now,
        updated_at=now,
    )
    # COALESCE preserves the existing display_name when the incoming
    # payload omits full_name (re-auth case). email falls back to the
    # existing row only when both jwt and body are null. email_verified
    # takes the JWT's latest value (monotonic false→true per Apple).
    upsert_stmt = insert_stmt.on_conflict_do_update(
        constraint="uq_users_apple_sub",
        set_={
            "email": func.coalesce(insert_stmt.excluded.email, User.email),
            "email_verified": insert_stmt.excluded.email_verified,
            "display_name": func.coalesce(
                insert_stmt.excluded.display_name, User.display_name
            ),
            # updated_at always bumped — the SET clause runs on UPDATE only,
            # so this is harmless on initial INSERT (the VALUES default
            # already set it to ``now``).
            "updated_at": func.now(),
        },
    ).returning(User)

    result = await session.execute(upsert_stmt)
    upserted = result.scalar_one()
    await session.commit()

    # Re-fetch in a fresh statement so the row reflects any DB-side
    # COALESCE results (the RETURNING clause is reliable but explicit
    # re-read keeps the response invariant tied to the persisted state).
    refetch = await session.execute(select(User).where(User.id == upserted.id))
    user_row = refetch.scalar_one()

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


__all__ = ["router", "get_jwks_client_dependency"]
