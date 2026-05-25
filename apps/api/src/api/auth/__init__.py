"""Apple Sign In authentication boundary (Phase 4.3).

The auth package owns three responsibilities:

* :mod:`api.auth.apple_jwks` — fetches Apple's public JWKS with a
  1-hour TTL cache and a circuit breaker fallback to the last-known-good
  cache on fetch failure.
* :mod:`api.auth.apple_verifier` — validates Apple ID tokens (RS256
  signature against the cached JWKS, plus ``aud``/``iss``/``exp`` claim
  checks).
* :mod:`api.auth.backend_jwt` — issues and verifies the backend's own
  HS256 stateless session token (24h TTL, ``sub=users.id``).

The package boundary contract:

* The auth modules import ``httpx``, ``jwt`` (PyJWT), and stdlib only;
  no SQLAlchemy, no FastAPI. Routers and dependencies consume these
  helpers — never the other way round.
* Every Apple-token validation failure raises :class:`AppleTokenError`
  (defined in :mod:`api.auth.apple_verifier`) with a stable error code
  so the auth router can map the failure to an HTTP 401 with a
  non-revealing message.
* Every backend-JWT verification failure raises :class:`BackendJwtError`
  so the ``require_current_user`` dependency can map to HTTP 401.
"""

from __future__ import annotations

from api.auth.apple_jwks import AppleJwksClient, get_apple_jwks_client
from api.auth.apple_verifier import AppleTokenError, verify_apple_id_token
from api.auth.backend_jwt import (
    BackendJwtError,
    issue_backend_jwt,
    verify_backend_jwt,
)

__all__ = [
    "AppleJwksClient",
    "AppleTokenError",
    "BackendJwtError",
    "get_apple_jwks_client",
    "issue_backend_jwt",
    "verify_apple_id_token",
    "verify_backend_jwt",
]
