"""Unit tests for recursive key-based email scrubbing (Phase 7.2, AC-7).

These tests exercise :func:`api.observability.scrub_email_keys.scrub_email_keys`
against *synthetic* Sentry-shaped event dicts only — they never construct a
Sentry client and never contact Sentry.io. They pin the AC-7 contract:

    * the three enumerated email field names — ``email`` / ``user_email`` /
      ``userEmail`` — are redacted, case-insensitively, wherever they appear;
    * scrubbing is recursive through nested dicts and lists;
    * the value is redacted regardless of its type (string, None, dict, …);
    * substring look-alike keys (``email_verified``, ``emails``) are NOT touched;
    * the function is pure (input is never mutated) and never returns ``None``.
"""

from __future__ import annotations

import pytest

from api.observability.scrub_email_keys import (
    EMAIL_KEY_NAMES,
    REDACTED,
    scrub_email_keys,
)


@pytest.mark.unit
def test_redacted_marker_is_legible_sentinel() -> None:
    """The redaction marker is the documented ``[redacted]`` sentinel."""
    assert REDACTED == "[redacted]"


@pytest.mark.unit
def test_email_key_names_are_normalized_lowercase() -> None:
    """The canonical name set is pre-lowercased for case-insensitive match."""
    assert EMAIL_KEY_NAMES == frozenset({"email", "user_email", "useremail"})
    for name in EMAIL_KEY_NAMES:
        assert name == name.lower()


# ---------------------------------------------------------------------------
# Top-level key matching for each enumerated name
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_scrubs_top_level_email_key() -> None:
    event = {"email": "alice@example.com"}
    assert scrub_email_keys(event) == {"email": REDACTED}


@pytest.mark.unit
def test_scrubs_top_level_user_email_key() -> None:
    event = {"user_email": "bob@example.com"}
    assert scrub_email_keys(event) == {"user_email": REDACTED}


@pytest.mark.unit
def test_scrubs_top_level_camel_case_user_email_key() -> None:
    event = {"userEmail": "carol@example.com"}
    assert scrub_email_keys(event) == {"userEmail": REDACTED}


# ---------------------------------------------------------------------------
# Case-insensitivity
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize(
    "key",
    ["Email", "EMAIL", "eMaIl", "User_Email", "USER_EMAIL", "UserEmail", "USEREMAIL"],
)
def test_scrubs_case_insensitively(key: str) -> None:
    event = {key: "dave@example.com"}
    assert scrub_email_keys(event) == {key: REDACTED}


# ---------------------------------------------------------------------------
# Value type independence — redact regardless of value shape
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize(
    "value",
    [
        "erin@example.com",
        None,
        12345,
        {"nested": "dict"},
        ["a", "b"],
        ["frank@example.com"],
    ],
)
def test_redacts_value_regardless_of_type(value: object) -> None:
    """A matched key's value is replaced wholesale, whatever its type."""
    event = {"email": value}
    assert scrub_email_keys(event) == {"email": REDACTED}


# ---------------------------------------------------------------------------
# Recursion through nested dicts and lists
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_scrubs_nested_dict() -> None:
    event = {
        "user": {
            "id": "u_123",
            "email": "grace@example.com",
            "profile": {"userEmail": "grace.alt@example.com"},
        }
    }
    assert scrub_email_keys(event) == {
        "user": {
            "id": "u_123",
            "email": REDACTED,
            "profile": {"userEmail": REDACTED},
        }
    }


@pytest.mark.unit
def test_scrubs_list_of_dicts() -> None:
    event = {
        "breadcrumbs": [
            {"message": "login", "data": {"email": "heidi@example.com"}},
            {"message": "noop", "data": {"count": 1}},
        ]
    }
    assert scrub_email_keys(event) == {
        "breadcrumbs": [
            {"message": "login", "data": {"email": REDACTED}},
            {"message": "noop", "data": {"count": 1}},
        ]
    }


@pytest.mark.unit
def test_scrubs_deeply_nested_mixed_structure() -> None:
    event = {
        "extra": {
            "items": [
                {"user_email": "ivan@example.com"},
                {"nested": [{"userEmail": "judy@example.com"}]},
            ]
        }
    }
    scrubbed = scrub_email_keys(event)
    assert scrubbed["extra"]["items"][0] == {"user_email": REDACTED}
    assert scrubbed["extra"]["items"][1]["nested"][0] == {"userEmail": REDACTED}


# ---------------------------------------------------------------------------
# Substring look-alikes are NOT scrubbed (whole-key match only)
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize(
    "lookalike_key",
    ["email_verified", "emails", "email_count", "primary_email_id", "mail"],
)
def test_does_not_scrub_substring_lookalike_keys(lookalike_key: str) -> None:
    """Keys that merely contain ``email`` are left untouched."""
    event = {lookalike_key: True}
    assert scrub_email_keys(event) == {lookalike_key: True}


@pytest.mark.unit
def test_non_email_keys_are_preserved() -> None:
    event = {"level": "error", "message": "boom", "tags": {"region": "kr"}}
    assert scrub_email_keys(event) == event


# ---------------------------------------------------------------------------
# Purity and never-None guarantees
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_input_is_not_mutated() -> None:
    """Scrubbing returns a new structure; the original is unchanged."""
    event = {"user": {"email": "kate@example.com"}}
    snapshot = {"user": {"email": "kate@example.com"}}
    _ = scrub_email_keys(event)
    assert event == snapshot
    # The nested dict object is a fresh copy, not the same reference.
    assert scrub_email_keys(event)["user"] is not event["user"]


@pytest.mark.unit
def test_returns_dict_never_none_for_dict_input() -> None:
    """A dict input always yields a dict (no event dropping)."""
    result = scrub_email_keys({"email": "leo@example.com"})
    assert isinstance(result, dict)
    assert result is not None


@pytest.mark.unit
def test_empty_event_is_returned_unchanged() -> None:
    assert scrub_email_keys({}) == {}


@pytest.mark.unit
def test_scalars_pass_through_unchanged() -> None:
    """Non-container inputs round-trip (recursion base case)."""
    assert scrub_email_keys("plain") == "plain"
    assert scrub_email_keys(None) is None
    assert scrub_email_keys(42) == 42


@pytest.mark.unit
def test_tuples_are_normalized_to_lists() -> None:
    """Sequences are returned as lists, matching Sentry JSON serialization."""
    event = {"values": ({"email": "mia@example.com"}, {"id": 1})}
    assert scrub_email_keys(event) == {"values": [{"email": REDACTED}, {"id": 1}]}


@pytest.mark.unit
def test_realistic_sentry_exception_event_shape() -> None:
    """An end-to-end exception-event shape is scrubbed at every email key."""
    event = {
        "level": "error",
        "request": {"url": "/v1/diagnose", "headers": {"user-agent": "x"}},
        "user": {"id": "u_9", "email": "nina@example.com"},
        "contexts": {"account": {"userEmail": "nina.alt@example.com"}},
        "extra": {"payload": {"user_email": "nina.work@example.com"}},
    }
    scrubbed = scrub_email_keys(event)
    assert scrubbed["user"]["email"] == REDACTED
    assert scrubbed["contexts"]["account"]["userEmail"] == REDACTED
    assert scrubbed["extra"]["payload"]["user_email"] == REDACTED
    # Non-PII structure is preserved verbatim.
    assert scrubbed["level"] == "error"
    assert scrubbed["request"]["url"] == "/v1/diagnose"
    assert scrubbed["user"]["id"] == "u_9"
