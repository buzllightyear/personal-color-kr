"""FastAPI auth dependency: ``require_current_user`` (Phase 4.3).

The single seam through which authenticated routes obtain a typed
:class:`api.db.models.user.User` row. Pulls the bearer token from the
``Authorization`` header, verifies it via the backend JWT helper, then
loads the row by ``users.id``.

Failure mapping (Seed-pinned):

* No ``Authorization`` header or wrong scheme → HTTP 401
* Token signature/claim/format invalid → HTTP 401
* Token valid but ``users.id`` row missing → HTTP 403

Detail strings stay generic ("invalid_authorization") to avoid leaking
validation hints to an attacker probing the surface.
"""

from __future__ import annotations

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from api.auth.backend_jwt import BackendJwtError, verify_backend_jwt
from api.config.env import require_jwt_secret
from api.db.models.user import User
from api.db.session import AsyncSession, get_session, select

#: HTTPBearer extracts the ``Authorization: Bearer <token>`` header and
#: rejects mismatched schemes (returning the credentials object so the
#: dependency below can decode the token). ``auto_error=True`` raises
#: HTTP 403 when the header is absent — we re-raise as HTTP 401 below
#: so callers consistently see 401 for any auth failure.
_bearer_scheme: HTTPBearer = HTTPBearer(
    bearerFormat="JWT",
    scheme_name="bearer",
    auto_error=False,
)


async def require_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
    session: AsyncSession = Depends(get_session),
) -> User:
    """Return the authenticated :class:`User` or raise an HTTP exception.

    Used as ``Depends(require_current_user)`` on every authenticated
    route. Returns the typed :class:`User` row so handler signatures get
    static type-checking benefit (vs returning a raw dict).

    Raises
    ------
    HTTPException
        * 401 with ``detail="invalid_authorization"`` when the header is
          missing, the scheme is wrong, or the JWT fails verification.
        * 403 with ``detail="user_not_found"`` when the JWT is valid but
          the ``users.id`` referenced in its ``sub`` claim is no longer
          present in the database (race: token issued, user deleted).
    """
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid_authorization",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        claims = verify_backend_jwt(
            token=credentials.credentials,
            jwt_secret=require_jwt_secret(),
        )
    except BackendJwtError as exc:
        # Log-friendly: the BackendJwtError.code is stable, but we do
        # NOT propagate it to the response body — the client gets a
        # generic 401 so an attacker cannot probe which validation rule
        # they tripped (signature vs aud vs exp vs malformed).
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid_authorization",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    result = await session.execute(select(User).where(User.id == claims.sub))
    user = result.scalar_one_or_none()
    if user is None:
        # Valid token, missing user. The 403 distinguishes "your token
        # is fine, but the resource your token references no longer
        # exists" from "your token is wrong". Useful for monitoring:
        # a spike in 403s here indicates either a deletion race or a
        # secret-rotation gap (tokens signed with the old secret would
        # 401, not 403).
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="user_not_found",
        )
    return user


__all__ = ["require_current_user"]
