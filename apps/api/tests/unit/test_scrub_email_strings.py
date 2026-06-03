"""Unit tests for regex-based email-in-string scrubbing (Phase 7.2, AC-8).

AC-8: ``before_send`` scrubs emails embedded in *string values* via a regex
matching the standard email pattern, replacing them with the redaction
sentinel. These tests pin:

    * the atomic :func:`scrub_email_string` primitive (single string),
    * the recursive :func:`scrub_email_strings` walker over Sentry-event-shaped
      structures (dicts, lists, tuples, nested),
    * the :data:`EMAIL_REGEX` match / no-match contract (no false negatives on
      plus-addressing, dotted local parts, multi-label domains, mixed case;
      no false positives on non-email text),
    * purity (no input mutation) and the never-``None`` / never-raise guarantee.
"""

from __future__ import annotations

import json
from typing import Any

import pytest

from api.observability.scrub_email_strings import (
    EMAIL_REGEX,
    REDACTED,
    scrub_email_string,
    scrub_email_strings,
)

pytestmark = pytest.mark.unit


def _contains_email(value: Any) -> bool:
    """Return ``True`` if any email-shaped substring survives anywhere."""
    return EMAIL_REGEX.search(json.dumps(value)) is not None


# ---------------------------------------------------------------------------
# EMAIL_REGEX — match / no-match contract (no false negatives or positives)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "address",
    [
        "alice@example.com",
        "alice.doe@example.com",
        "alice+tag@example.com",
        "alice_doe@example.co.uk",
        "a@mail.corp.example.co.uk",
        "ALICE@EXAMPLE.COM",
        "Alice.Doe@Sub.Example.Org",
        "user123@host-name.io",
        "x@y.io",
        "name%percent@example.com",
    ],
)
def test_regex_matches_valid_emails(address: str) -> None:
    match = EMAIL_REGEX.search(address)
    assert match is not None
    assert match.group(0) == address


@pytest.mark.parametrize(
    "text",
    [
        "not-an-email",
        "@handle",
        "plain text with no address",
        "a@b",  # no dotted TLD
        "missing.domain@",
        "user at example dot com",
        "price is $5 @ 2pm",
        "http://example.com/path",  # URL, no '@' local part
    ],
)
def test_regex_rejects_non_emails(text: str) -> None:
    assert EMAIL_REGEX.search(text) is None


# ---------------------------------------------------------------------------
# scrub_email_string — atomic primitive
# ---------------------------------------------------------------------------


def test_scrub_string_replaces_bare_address() -> None:
    assert scrub_email_string("alice@example.com") == REDACTED


def test_scrub_string_preserves_surrounding_text() -> None:
    out = scrub_email_string("User alice@example.com not found")
    assert out == f"User {REDACTED} not found"
    assert "alice@example.com" not in out


def test_scrub_string_replaces_all_occurrences() -> None:
    out = scrub_email_string("from a@x.io to b@y.org cc c@z.net")
    assert out == f"from {REDACTED} to {REDACTED} cc {REDACTED}"
    assert not _contains_email(out)


def test_scrub_string_is_case_insensitive() -> None:
    assert scrub_email_string("ALICE@EXAMPLE.COM") == REDACTED


def test_scrub_string_leaves_clean_text_untouched() -> None:
    text = "nothing to scrub here"
    assert scrub_email_string(text) == text


def test_scrub_string_handles_empty_string() -> None:
    assert scrub_email_string("") == ""


# ---------------------------------------------------------------------------
# scrub_email_strings — recursive walker
# ---------------------------------------------------------------------------


def test_scrub_email_in_exception_message_value() -> None:
    event = {
        "exception": {
            "values": [
                {"type": "ValueError", "value": "lookup failed for bob@corp.com"}
            ]
        }
    }
    scrubbed = scrub_email_strings(event)
    msg = scrubbed["exception"]["values"][0]["value"]
    assert msg == f"lookup failed for {REDACTED}"
    assert not _contains_email(scrubbed)


def test_scrub_email_in_nested_dict_value() -> None:
    event = {"extra": {"context": {"note": "ping alice@example.com"}}}
    scrubbed = scrub_email_strings(event)
    assert scrubbed["extra"]["context"]["note"] == f"ping {REDACTED}"


def test_scrub_email_in_list_of_strings() -> None:
    event = {"breadcrumbs": ["start", "mailed dev@team.io", "done"]}
    scrubbed = scrub_email_strings(event)
    assert scrubbed["breadcrumbs"] == ["start", f"mailed {REDACTED}", "done"]


def test_scrub_email_in_deeply_nested_structure() -> None:
    event = {
        "level": "error",
        "tags": [{"k": "owner", "v": "reach ceo@startup.co.uk now"}],
    }
    scrubbed = scrub_email_strings(event)
    assert scrubbed["tags"][0]["v"] == f"reach {REDACTED} now"
    assert not _contains_email(scrubbed)


def test_dict_keys_are_not_modified() -> None:
    # Keys are structural; the rule scopes to string *values* only. An
    # email-shaped key is preserved verbatim while its value is scrubbed.
    event = {"alice@example.com": "contact bob@corp.com"}
    scrubbed = scrub_email_strings(event)
    assert "alice@example.com" in scrubbed
    assert scrubbed["alice@example.com"] == f"contact {REDACTED}"


def test_tuples_are_normalized_to_lists() -> None:
    scrubbed = scrub_email_strings(("a@x.io", "plain"))
    assert scrubbed == [REDACTED, "plain"]
    assert isinstance(scrubbed, list)


@pytest.mark.parametrize("scalar", [42, 3.14, None, True, False])
def test_non_string_scalars_pass_through(scalar: Any) -> None:
    assert scrub_email_strings(scalar) == scalar


def test_clean_event_returned_equal() -> None:
    event = {"message": "all good", "count": 3, "ok": True}
    assert scrub_email_strings(event) == event


def test_empty_containers() -> None:
    assert scrub_email_strings({}) == {}
    assert scrub_email_strings([]) == []


# ---------------------------------------------------------------------------
# Invariants: purity, never-None, never-raise
# ---------------------------------------------------------------------------


def test_input_is_not_mutated() -> None:
    event = {"msg": "hi alice@example.com", "nested": {"x": ["y@z.io"]}}
    original = json.loads(json.dumps(event))  # deep snapshot
    scrub_email_strings(event)
    assert event == original  # input untouched


def test_dict_input_returns_dict_never_none() -> None:
    # No-event-dropping invariant: a dict in -> a dict out, never ``None``.
    result = scrub_email_strings({"a": "alice@example.com"})
    assert isinstance(result, dict)
    assert result is not None


def test_realistic_sentry_event_fully_scrubbed() -> None:
    event = {
        "event_id": "abc123",
        "level": "error",
        "message": "failed to email customer alice@example.com",
        "exception": {
            "values": [
                {
                    "type": "SMTPError",
                    "value": "recipient bob+billing@mail.example.co.uk rejected",
                }
            ]
        },
        "breadcrumbs": {
            "values": [
                {"message": "queued for carol@partner.org", "level": "info"},
                {"message": "no pii here", "level": "info"},
            ]
        },
        "extra": {"attempts": 2, "last_target": "dave@vendor.net"},
    }
    scrubbed = scrub_email_strings(event)

    # Structure preserved.
    assert scrubbed["event_id"] == "abc123"
    assert scrubbed["extra"]["attempts"] == 2
    # Every email gone, redaction sentinel present.
    assert not _contains_email(scrubbed)
    assert scrubbed["message"] == f"failed to email customer {REDACTED}"
    assert scrubbed["extra"]["last_target"] == REDACTED
