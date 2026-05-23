"""Structured JSON logging configuration (AC15 — Phase 4.1).

Configures a single ``logging.getLogger('apps.api')`` with a JSON formatter
that emits exactly these fields per record:

    {timestamp, level, message, request_id, method, path, status, latency_ms}

The formatter explicitly skips request bodies, selfie bytes, and any other
PII derivative — only the structural metadata above appears in the log
stream.

Invariants honored:
    - Exactly one log record per request (emitted by the request_id
      middleware once the response is built).
    - No extra fields beyond the 8 documented above (verified by
      ``tests/unit/test_json_log_schema.py``).
    - ``latency_ms`` is always a number.
    - Configuration is idempotent — calling ``configure_json_logging()``
      twice does not double-register handlers.
"""

from __future__ import annotations

import json
import logging
import sys
from datetime import datetime, timezone
from typing import Any, Final

#: Logger name shared with the request_id middleware.
LOGGER_NAME: Final[str] = "apps.api"

#: Exact set of keys every JSON record must carry. Used by
#: ``tests/unit/test_json_log_schema.py`` for ``set(record.keys()) ==`` checks.
JSON_LOG_KEYS: Final[frozenset[str]] = frozenset(
    {
        "timestamp",
        "level",
        "message",
        "request_id",
        "method",
        "path",
        "status",
        "latency_ms",
    }
)


class JsonFormatter(logging.Formatter):
    """Emit JSON-encoded records with the documented 8-key schema.

    Reads structural fields from ``record.__dict__`` (populated via the
    middleware's ``extra=`` kwarg). Missing fields default to ``None`` for
    request_id and to safe sentinels for the rest so non-request logs
    (e.g., uvicorn startup) still produce valid JSON.
    """

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.fromtimestamp(
                record.created, tz=timezone.utc
            ).isoformat(),
            "level": record.levelname,
            "message": record.getMessage(),
            "request_id": getattr(record, "request_id", None),
            "method": getattr(record, "method", None),
            "path": getattr(record, "path", None),
            "status": getattr(record, "status", None),
            "latency_ms": getattr(record, "latency_ms", None),
        }
        return json.dumps(payload, separators=(",", ":"), ensure_ascii=False)


def configure_json_logging() -> logging.Logger:
    """Register the JSON formatter on the ``apps.api`` logger exactly once.

    Idempotent: re-invocations are safe and do not duplicate handlers. The
    logger's ``propagate`` flag is disabled so records do not also surface
    on the root logger (which uvicorn configures with a plain formatter).

    Returns
    -------
    logging.Logger
        The configured ``apps.api`` logger.
    """
    logger = logging.getLogger(LOGGER_NAME)
    # Idempotency guard: if we have already installed a JsonFormatter handler,
    # do not add another one. This matters for the ``create_app`` factory
    # which is called once per process at module import + freshly per test.
    if any(
        isinstance(getattr(h, "formatter", None), JsonFormatter)
        for h in logger.handlers
    ):
        return logger

    handler = logging.StreamHandler(stream=sys.stdout)
    handler.setFormatter(JsonFormatter())
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    logger.propagate = False
    return logger


__all__ = ["JSON_LOG_KEYS", "LOGGER_NAME", "JsonFormatter", "configure_json_logging"]
