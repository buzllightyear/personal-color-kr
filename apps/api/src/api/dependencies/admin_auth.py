"""Admin route authentication dependency (Content Generation Phase).

All ``/admin`` routes are protected by a static bearer token stored in
the ``ADMIN_TOKEN`` environment variable. This is a minimal single-
operator guard — Phase 1 does not require multi-operator permissions or
role hierarchies.

Security model
--------------
* The client sends ``Authorization: Bearer <ADMIN_TOKEN>`` on every
  request to an ``/admin`` route.
* A missing header, wrong scheme, or token mismatch raises HTTP 403.
  (403 rather than 401 because there is no ``WWW-Authenticate`` challenge
  for a static token — the admin knows the token or they don't.)
* Constant-time comparison prevents timing attacks on the token value.

Failure mapping (Seed-pinned)
------------------------------
* No header / wrong scheme / wrong token → HTTP 403 ``{"detail": "forbidden"}``
* ADMIN_TOKEN not configured in env → HTTP 403 (fail-open for startup;
  the env-var absence is reported at request time, not app startup, so
  the user-facing API surface never breaks due to a missing admin knob).
"""

from __future__ import annotations

import hmac

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from api.config.env import get_admin_token

#: HTTPBearer scheme — extracts ``Authorization: Bearer <token>`` header.
#: ``auto_error=False`` lets the dependency handle the missing-header case
#: with a 403 (instead of the default 403 FastAPI fires from HTTPBearer
#: itself). We keep it consistent with the user-auth pattern.
_admin_bearer: HTTPBearer = HTTPBearer(
    scheme_name="admin_bearer",
    auto_error=False,
)

#: Detail string for every admin-auth failure. Kept generic so the
#: error body does not hint at whether the token is wrong vs missing.
DETAIL_FORBIDDEN: str = "forbidden"


async def require_admin(
    credentials: HTTPAuthorizationCredentials | None = Depends(_admin_bearer),
) -> None:
    """Assert that the request carries the correct ``ADMIN_TOKEN`` bearer.

    Intended as ``Depends(require_admin)`` on all ``/admin`` router endpoints.
    Returns ``None`` on success (the caller gets nothing back — the guard
    is a precondition, not a data accessor).

    Parameters
    ----------
    credentials:
        Extracted by ``HTTPBearer`` from the ``Authorization`` header.
        ``None`` when the header is absent.

    Raises
    ------
    HTTPException
        HTTP 403 ``{"detail": "forbidden"}`` when:
            * the ``Authorization`` header is absent,
            * the scheme is not ``Bearer``,
            * the token does not match ``ADMIN_TOKEN``, or
            * ``ADMIN_TOKEN`` is not configured in the environment.
    """
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=DETAIL_FORBIDDEN,
        )

    expected = get_admin_token()
    if expected is None:
        # ADMIN_TOKEN not configured — treat all admin requests as forbidden.
        # Fail-open for the user-facing surface; the admin surface is
        # unavailable until the operator sets the env var.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=DETAIL_FORBIDDEN,
        )

    # Constant-time comparison to prevent timing attacks on the token.
    if not hmac.compare_digest(credentials.credentials, expected):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=DETAIL_FORBIDDEN,
        )


__all__ = ["require_admin", "DETAIL_FORBIDDEN"]
