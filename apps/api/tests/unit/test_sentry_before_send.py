"""Unit tests for the composed Sentry ``before_send`` hook (Phase 7.2).

Sub-AC 3 contract: ``before_send`` composes the **key-scrubber**
(:func:`~api.observability.scrub_auth_keys.scrub_auth_keys`) and the
**JWT-scrubber** (:func:`~api.observability.scrub_jwt_strings.scrub_jwt_strings`)
over a Sentry event and returns the *fully scrubbed* event. These tests pin:

    * the headline composition: a representative event carrying **both** an
      auth-shaped *key* and an embedded *JWT string* has **both** redactions
      applied in the returned event,
    * each rule still fires when only one applies (no regression from
      composing),
    * ordering independence / idempotence of the pipeline,
    * the Seed invariants: never ``None`` (no event dropping), never raises,
      input is not mutated.

No Sentry SDK is initialized and nothing contacts Sentry.io — these are pure
function tests over synthetic event dicts.
"""

from __future__ import annotations

import json
from typing import Any

import pytest

from api.observability.scrub_auth_keys import REDACTED
from api.observability.scrub_jwt_strings import JWT_REGEX, REDACTED_JWT
from api.observability.sentry import _scrub_event, before_send

pytestmark = pytest.mark.unit


# A realistic, syntactically valid JWT (HS256): header.payload.signature, each
# segment base64url. Mirrors the canonical token used by the JWT-scrubber tests.
REAL_JWT = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
    ".eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkphbmUifQ"
    ".SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
)


def _contains_jwt(value: Any) -> bool:
    """Return ``True`` if any JWT-shaped substring survives anywhere."""
    return JWT_REGEX.search(json.dumps(value)) is not None


# ---------------------------------------------------------------------------
# Headline: both redactions applied to one representative event
# ---------------------------------------------------------------------------


def _representative_event() -> dict[str, Any]:
    """A Sentry-event-shaped dict carrying BOTH a matching key and a JWT string.

    * ``request.headers.Authorization`` — an auth-shaped *key* (key-scrubber
      should redact its value outright).
    * ``access_token`` in ``extra`` — another auth-shaped key.
    * the exception ``value`` — a free-form *string* with an embedded JWT
      (JWT-scrubber should redact the token, preserving surrounding prose).
    * a breadcrumb message — a JWT embedded mid-sentence (JWT-scrubber).
    """
    return {
        "event_id": "deadbeef",
        "level": "error",
        "request": {
            "url": "/v1/diagnose",
            "headers": {"Authorization": f"Bearer {REAL_JWT}"},
        },
        "exception": {
            "values": [
                {
                    "type": "AuthError",
                    "value": f"rejected token {REAL_JWT} during verify",
                }
            ]
        },
        "breadcrumbs": {
            "values": [
                {"message": f"issued {REAL_JWT}", "level": "info"},
                {"message": "no token here, just 1.2.3", "level": "info"},
            ]
        },
        "extra": {"access_token": REAL_JWT, "attempts": 3, "version": "1.2.3"},
    }


def test_before_send_applies_both_redactions() -> None:
    event = _representative_event()
    scrubbed = before_send(event, hint=None)

    # --- key-scrubber fired: auth-shaped KEYS have their values redacted ---
    assert scrubbed["request"]["headers"]["Authorization"] == REDACTED
    assert scrubbed["extra"]["access_token"] == REDACTED

    # --- JWT-scrubber fired: tokens embedded in STRING VALUES are redacted ---
    assert scrubbed["exception"]["values"][0]["value"] == (
        f"rejected token {REDACTED_JWT} during verify"
    )
    assert scrubbed["breadcrumbs"]["values"][0]["message"] == f"issued {REDACTED_JWT}"

    # --- the headline guarantee: NO raw token survives anywhere ---
    assert REAL_JWT not in json.dumps(scrubbed)
    assert not _contains_jwt(scrubbed)

    # --- non-sensitive structure preserved verbatim ---
    assert scrubbed["event_id"] == "deadbeef"
    assert scrubbed["extra"]["attempts"] == 3
    assert scrubbed["extra"]["version"] == "1.2.3"  # semver untouched
    assert (
        scrubbed["breadcrumbs"]["values"][1]["message"] == "no token here, just 1.2.3"
    )


def test_scrub_event_applies_both_redactions() -> None:
    # ``_scrub_event`` is the pure core ``before_send`` adapts; same guarantee.
    scrubbed = _scrub_event(_representative_event())
    assert scrubbed["extra"]["access_token"] == REDACTED
    assert REDACTED_JWT in scrubbed["exception"]["values"][0]["value"]
    assert not _contains_jwt(scrubbed)


# ---------------------------------------------------------------------------
# Each rule still fires in isolation (no regression from composition)
# ---------------------------------------------------------------------------


def test_key_rule_fires_when_no_jwt_present() -> None:
    event = {"extra": {"password": "hunter2", "note": "ok"}}
    scrubbed = before_send(event)
    assert scrubbed["extra"]["password"] == REDACTED
    assert scrubbed["extra"]["note"] == "ok"


def test_jwt_rule_fires_when_no_auth_key_present() -> None:
    # JWT embedded under a NON-auth key name => only the JWT-scrubber can catch
    # it (the key-scrubber leaves the value, the JWT regex rewrites the token).
    event = {"message": f"trace contained {REAL_JWT} unexpectedly"}
    scrubbed = before_send(event)
    assert scrubbed["message"] == f"trace contained {REDACTED_JWT} unexpectedly"
    assert not _contains_jwt(scrubbed)


def test_jwt_under_non_auth_key_is_redacted_by_value_rule() -> None:
    # 'detail' is not auth-shaped, so the key-scrubber passes the value through;
    # the JWT-scrubber must still strip the embedded token.
    event = {"detail": f"login failed with {REAL_JWT}"}
    scrubbed = before_send(event)
    assert scrubbed["detail"] == f"login failed with {REDACTED_JWT}"


# ---------------------------------------------------------------------------
# Pipeline properties: idempotence, clean-event passthrough
# ---------------------------------------------------------------------------


def test_before_send_is_idempotent() -> None:
    once = before_send(_representative_event())
    twice = before_send(once)
    assert once == twice
    assert not _contains_jwt(twice)


def test_clean_event_passes_through_unchanged() -> None:
    event = {
        "event_id": "abc",
        "level": "info",
        "message": "deploy 1.2.3 ok for package.module.Func",
        "extra": {"attempts": 1, "ok": True},
    }
    assert before_send(event) == event


def test_empty_event_returns_empty_dict() -> None:
    assert before_send({}) == {}


# ---------------------------------------------------------------------------
# Seed invariants: never-None, never-raise, purity, hint tolerance
# ---------------------------------------------------------------------------


def test_before_send_never_returns_none() -> None:
    # No-event-dropping invariant: an event in -> an event out, never ``None``.
    result = before_send(_representative_event())
    assert result is not None
    assert isinstance(result, dict)


def test_before_send_never_drops_even_fully_sensitive_event() -> None:
    # Every field sensitive: still returns a (scrubbed) event, never None.
    event = {"authorization": f"Bearer {REAL_JWT}", "secret": "s"}
    result = before_send(event)
    assert result is not None
    assert result["authorization"] == REDACTED
    assert result["secret"] == REDACTED


def test_hint_argument_is_optional_and_ignored() -> None:
    event = {"extra": {"token": REAL_JWT}}
    # Callable with and without hint; hint payloads must not change the result.
    assert before_send(event) == before_send(
        event, hint={"exc_info": (None, None, None)}
    )


def test_input_is_not_mutated() -> None:
    event = _representative_event()
    snapshot = json.loads(json.dumps(event))  # deep copy
    before_send(event)
    assert event == snapshot  # input untouched


def test_input_is_not_mutated_by_scrub_event() -> None:
    event = _representative_event()
    snapshot = json.loads(json.dumps(event))
    _scrub_event(event)
    assert event == snapshot
