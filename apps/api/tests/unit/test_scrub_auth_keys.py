"""Unit tests for recursive key-based auth-secret scrubbing (Phase 7.2).

These tests exercise :func:`api.observability.scrub_auth_keys.scrub_auth_keys`
against *synthetic* Sentry-shaped event dicts only — they never construct a
Sentry client and never contact Sentry.io. They pin the auth-key contract:

    * the enumerated auth substrings — ``token`` / ``jwt`` / ``bearer`` /
      ``authorization`` / ``secret`` / ``password`` / ``api_key`` — cause the
      matching field's value to be redacted, case-insensitively, wherever it
      appears (including as a substring of a decorated key name);
    * scrubbing is recursive through nested dicts and lists;
    * the value is redacted regardless of its type (string, None, dict, …);
    * keys with no auth substring are left untouched;
    * the function is pure (input is never mutated) and never returns ``None``.
"""

from __future__ import annotations

import pytest

from api.observability.scrub_auth_keys import (
    AUTH_KEY_PATTERNS,
    REDACTED,
    scrub_auth_keys,
)


@pytest.mark.unit
def test_redacted_marker_is_legible_sentinel() -> None:
    """The redaction marker is the documented ``[redacted]`` sentinel."""
    assert REDACTED == "[redacted]"


@pytest.mark.unit
def test_auth_key_patterns_are_the_enumerated_set() -> None:
    """The canonical pattern set matches the Seed enumeration, lowercased."""
    assert set(AUTH_KEY_PATTERNS) == {
        "token",
        "jwt",
        "bearer",
        "authorization",
        "secret",
        "password",
        "api_key",
    }
    for pattern in AUTH_KEY_PATTERNS:
        assert pattern == pattern.lower()


# ---------------------------------------------------------------------------
# Each enumerated target key, used verbatim, is redacted
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize(
    "key",
    ["token", "jwt", "bearer", "authorization", "secret", "password", "api_key"],
)
def test_scrubs_each_enumerated_target_key(key: str) -> None:
    """Each target key name has its value redacted."""
    event = {key: "super-sensitive-value"}
    assert scrub_auth_keys(event) == {key: REDACTED}


# ---------------------------------------------------------------------------
# Non-matching keys are left untouched
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize(
    "key",
    ["level", "message", "region", "user_id", "count", "url", "method", "email"],
)
def test_does_not_scrub_non_matching_keys(key: str) -> None:
    """Keys with no auth substring are preserved verbatim."""
    event = {key: "plain-value"}
    assert scrub_auth_keys(event) == {key: "plain-value"}


# ---------------------------------------------------------------------------
# Case-insensitivity
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize(
    "key",
    [
        "Token",
        "TOKEN",
        "JWT",
        "Jwt",
        "Bearer",
        "BEARER",
        "Authorization",
        "AUTHORIZATION",
        "Secret",
        "SECRET",
        "Password",
        "PASSWORD",
        "API_KEY",
        "Api_Key",
    ],
)
def test_scrubs_case_insensitively(key: str) -> None:
    event = {key: "value"}
    assert scrub_auth_keys(event) == {key: REDACTED}


# ---------------------------------------------------------------------------
# Substring matching — decorated key names also match (defense-in-depth)
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize(
    "key",
    [
        "access_token",
        "refresh_token",
        "X-Authorization",
        "authorization_header",
        "jwt_payload",
        "id_jwt",
        "bearer_header",
        "db_password",
        "stripe_secret",
        "client_secret",
        "my_api_key",
        "api_key_id",
    ],
)
def test_scrubs_decorated_auth_substring_keys(key: str) -> None:
    """Keys *containing* an auth substring are redacted (substring match)."""
    event = {key: "value"}
    assert scrub_auth_keys(event) == {key: REDACTED}


# ---------------------------------------------------------------------------
# Value type independence — redact regardless of value shape
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize(
    "value",
    [
        "eyJhbGc.payload.sig",
        None,
        12345,
        {"nested": "dict"},
        ["a", "b"],
        ["abc"],
    ],
)
def test_redacts_value_regardless_of_type(value: object) -> None:
    """A matched key's value is replaced wholesale, whatever its type."""
    event = {"token": value}
    assert scrub_auth_keys(event) == {"token": REDACTED}


# ---------------------------------------------------------------------------
# Recursion through nested dicts and lists
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_scrubs_nested_dict() -> None:
    event = {
        "request": {
            "url": "/v1/diagnose",
            "headers": {"Authorization": "Bearer abc", "user-agent": "x"},
        }
    }
    assert scrub_auth_keys(event) == {
        "request": {
            "url": "/v1/diagnose",
            "headers": {"Authorization": REDACTED, "user-agent": "x"},
        }
    }


@pytest.mark.unit
def test_scrubs_list_of_dicts() -> None:
    event = {
        "breadcrumbs": [
            {"message": "login", "data": {"jwt": "eyJ.a.b"}},
            {"message": "noop", "data": {"count": 1}},
        ]
    }
    assert scrub_auth_keys(event) == {
        "breadcrumbs": [
            {"message": "login", "data": {"jwt": REDACTED}},
            {"message": "noop", "data": {"count": 1}},
        ]
    }


@pytest.mark.unit
def test_scrubs_deeply_nested_mixed_structure() -> None:
    event = {
        "extra": {
            "items": [
                {"access_token": "a.b.c"},
                {"nested": [{"client_secret": "shh"}]},
            ]
        }
    }
    scrubbed = scrub_auth_keys(event)
    assert scrubbed["extra"]["items"][0] == {"access_token": REDACTED}
    assert scrubbed["extra"]["items"][1]["nested"][0] == {"client_secret": REDACTED}


# ---------------------------------------------------------------------------
# Purity and never-None guarantees
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_input_is_not_mutated() -> None:
    """Scrubbing returns a new structure; the original is unchanged."""
    event = {"auth": {"token": "secret-abc"}}
    snapshot = {"auth": {"token": "secret-abc"}}
    _ = scrub_auth_keys(event)
    assert event == snapshot
    # The nested dict object is a fresh copy, not the same reference.
    assert scrub_auth_keys(event)["auth"] is not event["auth"]


@pytest.mark.unit
def test_returns_dict_never_none_for_dict_input() -> None:
    """A dict input always yields a dict (no event dropping)."""
    result = scrub_auth_keys({"password": "hunter2"})
    assert isinstance(result, dict)
    assert result is not None


@pytest.mark.unit
def test_empty_event_is_returned_unchanged() -> None:
    assert scrub_auth_keys({}) == {}


@pytest.mark.unit
def test_scalars_pass_through_unchanged() -> None:
    """Non-container inputs round-trip (recursion base case)."""
    assert scrub_auth_keys("plain") == "plain"
    assert scrub_auth_keys(None) is None
    assert scrub_auth_keys(42) == 42


@pytest.mark.unit
def test_tuples_are_normalized_to_lists() -> None:
    """Sequences are returned as lists, matching Sentry JSON serialization."""
    event = {"values": ({"secret": "x"}, {"id": 1})}
    assert scrub_auth_keys(event) == {"values": [{"secret": REDACTED}, {"id": 1}]}


@pytest.mark.unit
def test_non_string_keys_are_ignored() -> None:
    """Non-string keys never match and their values still recurse."""
    event = {1: {"token": "abc"}, 2: "plain"}
    assert scrub_auth_keys(event) == {1: {"token": REDACTED}, 2: "plain"}


@pytest.mark.unit
def test_realistic_sentry_exception_event_shape() -> None:
    """An end-to-end exception-event shape is scrubbed at every auth key."""
    event = {
        "level": "error",
        "request": {
            "url": "/v1/auth/apple",
            "headers": {"Authorization": "Bearer xyz", "user-agent": "x"},
        },
        "extra": {
            "payload": {"refresh_token": "r.t.k", "api_key": "ak_live_123"},
            "db_password": "pg-pass",
        },
        "contexts": {"auth": {"jwt": "eyJ.a.b"}},
    }
    scrubbed = scrub_auth_keys(event)
    assert scrubbed["request"]["headers"]["Authorization"] == REDACTED
    assert scrubbed["extra"]["payload"]["refresh_token"] == REDACTED
    assert scrubbed["extra"]["payload"]["api_key"] == REDACTED
    assert scrubbed["extra"]["db_password"] == REDACTED
    assert scrubbed["contexts"]["auth"]["jwt"] == REDACTED
    # Non-auth structure is preserved verbatim.
    assert scrubbed["level"] == "error"
    assert scrubbed["request"]["url"] == "/v1/auth/apple"
    assert scrubbed["request"]["headers"]["user-agent"] == "x"
