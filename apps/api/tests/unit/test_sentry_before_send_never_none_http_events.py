"""AC-18: ``before_send`` always returns a dict, never ``None`` (Phase 7.2).

The Seed's **no-event-dropping** invariant requires that the Sentry
``before_send`` hook scrub every event but *never* suppress one: an event in
must yield an event out — always a ``dict``, never ``None``. ``before_send`` is
a transformation layer, not a sampling/filtering hook.

These tests pin that invariant against **synthetic, realistic Sentry events**
shaped like the three HTTP error classes the API emits in production:

    * **500** — an unhandled server exception (``RuntimeError``) on a protected
      route, carrying an ``Authorization`` header and a leaked token in the
      exception value.
    * **422** — a FastAPI request-validation error on ``/v1/auth/apple`` with
      an email in the request body and validation breadcrumbs.
    * **401** — an authentication failure on a protected route with a bearer
      JWT in the request headers.

For every event we assert:

    * ``before_send(event)`` is **not ``None``** and is a ``dict``,
    * the same holds when a ``hint`` is supplied (SDK calls it with one),
    * the pure core :func:`_scrub_event` upholds the same guarantee,
    * the no-drop guarantee survives even when *every* field is sensitive,
    * non-sensitive structure (the ``status_code`` that identifies the event
      class, the ``request_id`` tag) is preserved through scrubbing — i.e. the
      event is returned *scrubbed*, not emptied.

No Sentry SDK is initialized and nothing contacts Sentry.io — these are pure
function tests over synthetic event dicts.
"""

from __future__ import annotations

import json
from typing import Any, Callable

import pytest

from api.observability.sentry import _scrub_event, before_send

pytestmark = pytest.mark.unit


# A realistic, syntactically valid JWT (HS256): header.payload.signature, each
# segment base64url. Mirrors the canonical token used by the JWT-scrubber tests.
REAL_JWT = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
    ".eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkphbmUifQ"
    ".SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
)

# A synthetic per-request UUID4 (the value RequestIdMiddleware sets as the
# ``request_id`` Sentry tag). Non-sensitive: must survive scrubbing so Sentry
# events can be cross-referenced against the JSON logs.
REQUEST_ID = "f47ac10b-58cc-4372-a567-0e02b2c3d479"


def _event_500() -> dict[str, Any]:
    """Synthetic Sentry event for an unhandled 500 on a protected route."""
    return {
        "event_id": "00000000000000000000000000000500",
        "level": "error",
        "request": {
            "url": "https://api.example.com/v1/diagnose",
            "method": "POST",
            "headers": {"Authorization": f"Bearer {REAL_JWT}"},
        },
        "exception": {
            "values": [
                {
                    "type": "RuntimeError",
                    "value": f"downstream call failed with token {REAL_JWT}",
                }
            ]
        },
        "contexts": {"response": {"status_code": 500}},
        "tags": {"request_id": REQUEST_ID},
        "extra": {"access_token": REAL_JWT, "attempts": 3},
    }


def _event_422() -> dict[str, Any]:
    """Synthetic Sentry event for a 422 request-validation error."""
    return {
        "event_id": "00000000000000000000000000000422",
        "level": "warning",
        "request": {
            "url": "https://api.example.com/v1/auth/apple",
            "method": "POST",
            "data": {"email": "user@example.com", "identity_token": REAL_JWT},
        },
        "exception": {
            "values": [
                {
                    "type": "RequestValidationError",
                    "value": "1 validation error for AppleAuthRequest",
                }
            ]
        },
        "breadcrumbs": {
            "values": [
                {"message": "validating apple auth body", "level": "info"},
            ]
        },
        "contexts": {"response": {"status_code": 422}},
        "tags": {"request_id": REQUEST_ID},
    }


def _event_401() -> dict[str, Any]:
    """Synthetic Sentry event for a 401 authentication failure."""
    return {
        "event_id": "00000000000000000000000000000401",
        "level": "warning",
        "request": {
            "url": "https://api.example.com/v1/referrals/me",
            "method": "GET",
            "headers": {"authorization": f"Bearer {REAL_JWT}"},
        },
        "exception": {
            "values": [
                {
                    "type": "HTTPException",
                    "value": "401: Could not validate credentials",
                }
            ]
        },
        "contexts": {"response": {"status_code": 401}},
        "tags": {"request_id": REQUEST_ID},
    }


# (label, factory, expected status_code) for the three HTTP error classes.
HTTP_EVENT_CASES: tuple[tuple[str, Callable[[], dict[str, Any]], int], ...] = (
    ("500_unhandled_exception", _event_500, 500),
    ("422_validation_error", _event_422, 422),
    ("401_unauthorized", _event_401, 401),
)

_PARAMS = [
    pytest.param(factory, status, id=label)
    for label, factory, status in HTTP_EVENT_CASES
]


# ---------------------------------------------------------------------------
# AC-18 headline: never None for synthetic 500 / 422 / 401 events
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(("factory", "status_code"), _PARAMS)
def test_before_send_returns_non_none_dict(
    factory: Callable[[], dict[str, Any]], status_code: int
) -> None:
    """``before_send`` returns a non-``None`` ``dict`` for each error class."""
    result = before_send(factory())
    assert result is not None
    assert isinstance(result, dict)


@pytest.mark.parametrize(("factory", "status_code"), _PARAMS)
def test_before_send_with_hint_returns_non_none_dict(
    factory: Callable[[], dict[str, Any]], status_code: int
) -> None:
    """The SDK calls ``before_send(event, hint)``; a hint never yields ``None``."""
    hint = {"exc_info": (RuntimeError, RuntimeError("boom"), None)}
    result = before_send(factory(), hint=hint)
    assert result is not None
    assert isinstance(result, dict)


@pytest.mark.parametrize(("factory", "status_code"), _PARAMS)
def test_scrub_event_core_returns_non_none_dict(
    factory: Callable[[], dict[str, Any]], status_code: int
) -> None:
    """The pure core ``_scrub_event`` upholds the same never-``None`` guarantee."""
    result = _scrub_event(factory())
    assert result is not None
    assert isinstance(result, dict)


# ---------------------------------------------------------------------------
# Returned event is scrubbed, not emptied: identifying structure survives
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(("factory", "status_code"), _PARAMS)
def test_status_code_and_request_id_preserved(
    factory: Callable[[], dict[str, Any]], status_code: int
) -> None:
    """Non-sensitive structure (status_code, request_id tag) survives scrubbing.

    This proves the event is returned *scrubbed*, not dropped or blanked — the
    fields needed to triage and cross-reference the incident remain intact.
    """
    result = before_send(factory())
    assert result["contexts"]["response"]["status_code"] == status_code
    assert result["tags"]["request_id"] == REQUEST_ID
    assert result["event_id"] == factory()["event_id"]


@pytest.mark.parametrize(("factory", "status_code"), _PARAMS)
def test_no_raw_jwt_survives_in_returned_event(
    factory: Callable[[], dict[str, Any]], status_code: int
) -> None:
    """The never-drop guarantee does not weaken scrubbing: no raw token leaks."""
    result = before_send(factory())
    assert REAL_JWT not in json.dumps(result)


# ---------------------------------------------------------------------------
# Edge cases for the never-None invariant
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(("factory", "status_code"), _PARAMS)
def test_fully_sensitive_event_is_never_dropped(
    factory: Callable[[], dict[str, Any]], status_code: int
) -> None:
    """Even an event whose every leaf is sensitive returns a (scrubbed) dict."""
    event = {
        "authorization": f"Bearer {REAL_JWT}",
        "password": "hunter2",
        "secret": "shhh",
        "contexts": {"response": {"status_code": status_code}},
    }
    result = before_send(event)
    assert result is not None
    assert isinstance(result, dict)
    # Sensitive leaves redacted, identifying status_code preserved.
    assert result["contexts"]["response"]["status_code"] == status_code


def test_empty_event_returns_non_none_empty_dict() -> None:
    """The degenerate empty event still returns a dict, never ``None``."""
    result = before_send({})
    assert result is not None
    assert result == {}
