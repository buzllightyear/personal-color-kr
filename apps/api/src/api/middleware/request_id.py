"""Request-ID middleware (AC16 — Phase 4.1).

Generates a fresh ``uuid4()`` per request, attaches it to
``request.state.request_id``, and adds an ``X-Request-ID`` response header.
The middleware is the *single* source of request_id — handlers never
generate their own. The JSON logger consumes the same value to correlate
per-request log records.

Invariants honored:
    - The middleware emits a UUID4 that matches the regex
      ``^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$``
      (verified by ``tests/unit/test_request_id_middleware.py``).
    - Every response — 200, 4xx, 5xx — carries the header.
    - The middleware never logs or persists the request body or any other
      PII derived from the request.
"""

from __future__ import annotations

import logging
import time
from typing import Awaitable, Callable
from uuid import uuid4

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

#: Response header name carrying the per-request UUID4.
REQUEST_ID_HEADER: str = "X-Request-ID"

#: Logger name shared with ``api.config.logging`` so JSON records emit
#: under a single root.
_LOGGER_NAME: str = "apps.api"


class RequestIdMiddleware(BaseHTTPMiddleware):
    """Attach a UUID4 request_id to every request + response.

    The middleware is intentionally framework-agnostic at the dispatch
    layer (subclassing ``BaseHTTPMiddleware``) so it works for both the
    health probes and the ``POST /v1/diagnose`` endpoint without any
    handler-side awareness.
    """

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        request_id = uuid4().hex
        # Format as canonical UUID4 string (8-4-4-4-12) for header parity.
        request_id_str = (
            f"{request_id[0:8]}-{request_id[8:12]}-{request_id[12:16]}"
            f"-{request_id[16:20]}-{request_id[20:32]}"
        )
        request.state.request_id = request_id_str

        start_ns = time.perf_counter_ns()
        try:
            response = await call_next(request)
        except Exception:  # noqa: BLE001 — emit log + re-raise
            duration_ms = (time.perf_counter_ns() - start_ns) / 1_000_000
            logging.getLogger(_LOGGER_NAME).exception(
                "request_failed",
                extra={
                    "request_id": request_id_str,
                    "method": request.method,
                    "path": request.url.path,
                    "status": 500,
                    "latency_ms": round(duration_ms, 3),
                },
            )
            raise

        duration_ms = (time.perf_counter_ns() - start_ns) / 1_000_000
        response.headers[REQUEST_ID_HEADER] = request_id_str
        logging.getLogger(_LOGGER_NAME).info(
            "request_completed",
            extra={
                "request_id": request_id_str,
                "method": request.method,
                "path": request.url.path,
                "status": response.status_code,
                "latency_ms": round(duration_ms, 3),
            },
        )
        return response


__all__ = ["REQUEST_ID_HEADER", "RequestIdMiddleware"]
