"""Unit tests for auth-path request-body dropping (Phase 7.2, AC-11).

These tests exercise
:func:`api.observability.scrub_auth_paths.scrub_auth_path_request_body` against
*synthetic* Sentry-shaped event dicts only — they never construct a Sentry
client and never contact Sentry.io. They pin the AC-11 contract:

    * when the event's ``request.url`` matches ``/v1/auth/`` (bare path or
      absolute URL, case-insensitively), the request ``data`` (body) is set to
      ``None``;
    * every other field — the request ``url`` / ``method`` / ``headers`` /
      ``query_string`` and all other top-level event fields — is preserved;
    * non-auth routes (and events with no/blank request section) are left
      content-unchanged;
    * the rule operates on the top-level ``request`` only (it is not recursive);
    * the function is pure (input is never mutated) and never returns ``None``
      for a dict input — the event is kept, only its body is dropped.
"""

from __future__ import annotations

import pytest

from api.observability.scrub_auth_paths import (
    AUTH_PATH_PATTERN,
    scrub_auth_path_request_body,
)

# ---------------------------------------------------------------------------
# The canonical pattern
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_pattern_matches_auth_path_substring() -> None:
    """The pattern matches the ``/v1/auth/`` URL family."""
    assert AUTH_PATH_PATTERN.search("/v1/auth/apple") is not None
    assert AUTH_PATH_PATTERN.search("/v1/referrals/me") is None


# ---------------------------------------------------------------------------
# Auth-route events: body is dropped
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize(
    "url",
    [
        "/v1/auth/apple",
        "/v1/auth/refresh",
        "/v1/auth/logout",
        "https://api.example.com/v1/auth/apple",
        "https://api.example.com/v1/auth/refresh?next=1",
        "/V1/AUTH/APPLE",  # case-insensitive
    ],
)
def test_drops_body_for_auth_urls(url: str) -> None:
    """A matching auth URL causes ``request.data`` to be nulled."""
    event = {
        "request": {
            "url": url,
            "method": "POST",
            "data": {"identity_token": "eyJ.secret.payload", "code": "abc"},
        }
    }
    scrubbed = scrub_auth_path_request_body(event)
    assert scrubbed["request"]["data"] is None


@pytest.mark.unit
def test_drops_raw_string_body() -> None:
    """A raw-string request body is dropped just like a structured one."""
    event = {"request": {"url": "/v1/auth/apple", "data": "raw=token&code=xyz"}}
    assert scrub_auth_path_request_body(event)["request"]["data"] is None


# ---------------------------------------------------------------------------
# Non-body request fields and other event fields are preserved
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_preserves_other_request_and_event_fields() -> None:
    """Only the body is dropped; url/method/headers/etc. survive."""
    event = {
        "level": "error",
        "request": {
            "url": "https://api.example.com/v1/auth/apple",
            "method": "POST",
            "headers": {"User-Agent": "pcaf/1.0"},
            "query_string": "x=1",
            "data": {"identity_token": "eyJ.secret"},
        },
        "extra": {"trace": "boom"},
    }
    scrubbed = scrub_auth_path_request_body(event)
    assert scrubbed["request"]["data"] is None
    assert scrubbed["request"]["url"] == "https://api.example.com/v1/auth/apple"
    assert scrubbed["request"]["method"] == "POST"
    assert scrubbed["request"]["headers"] == {"User-Agent": "pcaf/1.0"}
    assert scrubbed["request"]["query_string"] == "x=1"
    assert scrubbed["level"] == "error"
    assert scrubbed["extra"] == {"trace": "boom"}


# ---------------------------------------------------------------------------
# Non-auth routes are left content-unchanged
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize(
    "url",
    [
        "/v1/referrals/me",
        "/v1/diagnose",
        "/v1/events",
        "/v1/health",
        "/v1/auth",  # no trailing slash -> not the /v1/auth/ family
        "/v2/auth/apple",  # different version prefix
        "https://api.example.com/v1/users/auth_log",  # substring, not the path
    ],
)
def test_preserves_body_for_non_auth_urls(url: str) -> None:
    """A non-auth URL leaves the captured body intact."""
    body = {"selfie_id": "123", "consent": True}
    event = {"request": {"url": url, "method": "POST", "data": body}}
    scrubbed = scrub_auth_path_request_body(event)
    assert scrubbed["request"]["data"] == body


# ---------------------------------------------------------------------------
# Defensive / edge cases — never raises
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_event_without_request_is_unchanged() -> None:
    event = {"level": "error", "message": "boom"}
    assert scrub_auth_path_request_body(event) == event


@pytest.mark.unit
def test_request_without_url_is_unchanged() -> None:
    event = {"request": {"method": "POST", "data": {"x": 1}}}
    assert scrub_auth_path_request_body(event) == event


@pytest.mark.unit
@pytest.mark.parametrize("url", [None, 123, ["/v1/auth/apple"], {"u": "x"}])
def test_non_string_url_does_not_match_and_does_not_raise(url: object) -> None:
    event = {"request": {"url": url, "data": {"x": 1}}}
    scrubbed = scrub_auth_path_request_body(event)
    assert scrubbed["request"]["data"] == {"x": 1}


@pytest.mark.unit
@pytest.mark.parametrize("request_value", [None, "not-a-dict", 42, ["x"]])
def test_non_dict_request_is_unchanged(request_value: object) -> None:
    event = {"request": request_value}
    assert scrub_auth_path_request_body(event) == event


@pytest.mark.unit
def test_auth_event_without_data_key_gets_none_data() -> None:
    """A matching auth event with no captured body gains an explicit ``data=None``."""
    event = {"request": {"url": "/v1/auth/apple", "method": "POST"}}
    scrubbed = scrub_auth_path_request_body(event)
    assert scrubbed["request"]["data"] is None
    assert scrubbed["request"]["method"] == "POST"


@pytest.mark.unit
@pytest.mark.parametrize("value", ["plain", None, 42, ["a", "b"], True])
def test_non_dict_event_passes_through(value: object) -> None:
    """Only a whole event (dict) carries a request section."""
    assert scrub_auth_path_request_body(value) == value


# ---------------------------------------------------------------------------
# Purity and never-None guarantees
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_input_is_not_mutated() -> None:
    """Scrubbing returns a new structure; the original is unchanged."""
    event = {"request": {"url": "/v1/auth/apple", "data": {"token": "secret"}}}
    snapshot = {"request": {"url": "/v1/auth/apple", "data": {"token": "secret"}}}
    result = scrub_auth_path_request_body(event)
    assert event == snapshot
    assert result["request"] is not event["request"]


@pytest.mark.unit
def test_returns_dict_never_none_for_dict_input() -> None:
    """A dict input always yields a dict (the event is never dropped)."""
    result = scrub_auth_path_request_body(
        {"request": {"url": "/v1/auth/apple", "data": {"t": "x"}}}
    )
    assert isinstance(result, dict)
    assert result is not None


@pytest.mark.unit
def test_empty_event_is_returned_unchanged() -> None:
    assert scrub_auth_path_request_body({}) == {}


@pytest.mark.unit
def test_realistic_sentry_exception_event_shape() -> None:
    """An end-to-end auth exception-event shape drops only the request body."""
    event = {
        "level": "error",
        "exception": {"values": [{"type": "ValueError", "value": "bad token"}]},
        "request": {
            "url": "https://api.example.com/v1/auth/apple",
            "method": "POST",
            "data": {"identity_token": "eyJhbG. payload .sig"},
            "headers": {"Content-Type": "application/json"},
        },
        "tags": {"request_id": "11111111-1111-4111-8111-111111111111"},
    }
    scrubbed = scrub_auth_path_request_body(event)
    assert scrubbed["request"]["data"] is None
    # Everything else is preserved for incident triage.
    assert scrubbed["request"]["url"].endswith("/v1/auth/apple")
    assert scrubbed["request"]["headers"] == {"Content-Type": "application/json"}
    assert scrubbed["exception"]["values"][0]["value"] == "bad token"
    assert scrubbed["tags"]["request_id"] == "11111111-1111-4111-8111-111111111111"
