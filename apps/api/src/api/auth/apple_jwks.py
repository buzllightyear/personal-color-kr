"""Apple Sign In JWKS fetch + cache + circuit breaker (Phase 4.3).

Apple's public signing keys (used to verify Sign In with Apple ID tokens)
are published at ``https://appleid.apple.com/auth/keys`` as a JWKS
document. This module fetches that document, caches it in-process for
1 hour, and serves the last-known-good cache as a circuit-breaker
fallback when a refresh fetch fails — so an Apple outage cannot cascade
into the auth boundary as long as the cache has any prior content.

Design invariants:

* In-process cache (one ``AppleJwksClient`` instance per FastAPI app).
  No external cache (Redis/Memcached); the Phase 4.3 Seed pins a stateless
  HS256 backend with no shared cache layer.
* 1-hour TTL between successful fetches. Apple rotates keys every few
  months and ships new ``kid`` values during a long transition window so
  a cache lag of an hour is operationally safe.
* Circuit breaker: if the refresh fetch raises (network, 5xx, parse
  error), serve the last cached value instead. Only when the cache is
  empty AND the fetch fails do we raise.
* Concurrency: a single :class:`asyncio.Lock` guards the refresh path so
  a burst of concurrent sign-ins only fires one HTTP request.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any

import httpx

#: Apple's public JWKS endpoint. The URL is documented at
#: https://developer.apple.com/documentation/sign_in_with_apple/
#: fetch_apple_s_public_key_for_verifying_token_signature
APPLE_JWKS_URL: str = "https://appleid.apple.com/auth/keys"

#: TTL (seconds) for a successfully-fetched JWKS cache entry before the
#: next call triggers a background refresh.
JWKS_CACHE_TTL_SECONDS: int = 3600

#: Hard timeout (seconds) for the JWKS HTTP fetch. Apple's endpoint is
#: globally CDN-fronted and responds in <500ms in steady state; a generous
#: 5s ceiling lets a transient connection burst recover without falling
#: through to the circuit breaker on every slow handshake.
JWKS_FETCH_TIMEOUT_SECONDS: float = 5.0


@dataclass
class _JwksCacheEntry:
    """In-process cache slot for the Apple JWKS document."""

    keys: dict[str, Any] = field(default_factory=dict)
    fetched_at_monotonic: float = 0.0


class AppleJwksClient:
    """Async client that fetches + caches Apple's public JWKS document.

    The client is intended to live as a module-level singleton (returned
    by :func:`get_apple_jwks_client`) so a single process holds at most
    one cache. The :meth:`get_keys` method is the public entry point;
    it returns a dict keyed by ``kid`` for direct lookup during signature
    verification.

    Concurrency:
        :meth:`get_keys` acquires :attr:`_refresh_lock` only when a
        refresh is needed (cache empty or TTL expired). Cache reads on
        the hot path are lock-free.

    Test seam:
        The constructor accepts an optional ``http_client_factory`` so
        unit tests can inject a respx-mocked or stub-backed ``httpx.AsyncClient``
        without touching the real Apple endpoint.
    """

    def __init__(
        self,
        *,
        jwks_url: str = APPLE_JWKS_URL,
        ttl_seconds: int = JWKS_CACHE_TTL_SECONDS,
        timeout_seconds: float = JWKS_FETCH_TIMEOUT_SECONDS,
        http_client_factory: Any = None,
    ) -> None:
        self._jwks_url = jwks_url
        self._ttl_seconds = ttl_seconds
        self._timeout_seconds = timeout_seconds
        self._http_client_factory = http_client_factory
        self._cache: _JwksCacheEntry = _JwksCacheEntry()
        self._refresh_lock: asyncio.Lock = asyncio.Lock()

    async def get_keys(self) -> dict[str, Any]:
        """Return the cached JWKS keys dict (``{kid: jwk_dict}``).

        Refresh logic:

        1. If the cache has content and the entry is younger than TTL,
           return the cached dict (lock-free hot path).
        2. Otherwise, acquire the refresh lock, re-check (another waiter
           may have refreshed while we waited), then attempt a fetch.
        3. On fetch success, replace the cache and return the new dict.
        4. On fetch failure with a non-empty cache, serve the stale cache
           (circuit-breaker fallback) and swallow the error.
        5. On fetch failure with an empty cache, re-raise the error so
           the auth router can surface HTTP 503 to the client.
        """
        if self._cache.keys and self._is_fresh():
            return self._cache.keys

        async with self._refresh_lock:
            # Re-check inside the lock — another waiter may have refreshed.
            if self._cache.keys and self._is_fresh():
                return self._cache.keys
            try:
                fresh_keys = await self._fetch_keys()
            except Exception:
                if self._cache.keys:
                    # Circuit breaker: serve stale cache when refresh fails.
                    return self._cache.keys
                raise
            self._cache = _JwksCacheEntry(
                keys=fresh_keys,
                fetched_at_monotonic=time.monotonic(),
            )
            return self._cache.keys

    def _is_fresh(self) -> bool:
        """Return True when the cache entry is younger than TTL."""
        age_seconds = time.monotonic() - self._cache.fetched_at_monotonic
        return age_seconds < self._ttl_seconds

    async def _fetch_keys(self) -> dict[str, Any]:
        """Fetch the JWKS document and return a ``{kid: jwk_dict}`` dict.

        Apple's JWKS is shaped ``{"keys": [{"kid": "...", ...}, ...]}``.
        Reshape into a dict keyed by ``kid`` so signature verification
        does a single O(1) lookup per token instead of an O(n) scan.
        """
        client: httpx.AsyncClient
        if self._http_client_factory is not None:
            client = self._http_client_factory()
        else:
            client = httpx.AsyncClient(timeout=self._timeout_seconds)
        try:
            response = await client.get(self._jwks_url)
            response.raise_for_status()
            document = response.json()
        finally:
            await client.aclose()
        keys_list = document.get("keys")
        if not isinstance(keys_list, list):
            raise ValueError("Apple JWKS response did not contain a 'keys' list")
        result: dict[str, Any] = {}
        for jwk in keys_list:
            if not isinstance(jwk, dict):
                continue
            kid = jwk.get("kid")
            if isinstance(kid, str):
                result[kid] = jwk
        if not result:
            raise ValueError("Apple JWKS response contained no valid keys")
        return result


_singleton: AppleJwksClient | None = None


def get_apple_jwks_client() -> AppleJwksClient:
    """Return the process-wide :class:`AppleJwksClient` singleton.

    The singleton is constructed lazily on first call so importing this
    module does not start any background work or attempt an HTTP fetch.
    Tests that need a fresh client can call :func:`reset_apple_jwks_client`
    (e.g., from a fixture teardown).
    """
    global _singleton
    if _singleton is None:
        _singleton = AppleJwksClient()
    return _singleton


def reset_apple_jwks_client() -> None:
    """Reset the singleton (test hook only)."""
    global _singleton
    _singleton = None


__all__ = [
    "APPLE_JWKS_URL",
    "AppleJwksClient",
    "JWKS_CACHE_TTL_SECONDS",
    "JWKS_FETCH_TIMEOUT_SECONDS",
    "get_apple_jwks_client",
    "reset_apple_jwks_client",
]
