"""Unit tests for regex-based JWT-shaped-string scrubbing (Phase 7.2).

The JWT rule: ``before_send`` scrubs JSON Web Tokens embedded in *string
values* via a regex matching the JWT shape (three base64url segments separated
by dots, anchored on the ``eyJ`` header prefix), replacing each with
``[redacted-jwt]``. These tests pin:

    * the :data:`JWT_REGEX` match / no-match contract (no false negatives on
      real-looking tokens; no false positives on dotted triples, semver, URLs,
      or arbitrary prose),
    * the atomic :func:`scrub_jwt_string` primitive (single string),
    * the recursive :func:`scrub_jwt_strings` walker over Sentry-event-shaped
      structures (dicts, lists, tuples, nested),
    * purity (no input mutation) and the never-``None`` / never-raise guarantee.
"""

from __future__ import annotations

import json
from typing import Any

import pytest

from api.observability.scrub_jwt_strings import (
    JWT_REGEX,
    REDACTED_JWT,
    scrub_jwt_string,
    scrub_jwt_strings,
)

pytestmark = pytest.mark.unit


# A realistic, syntactically valid JWT (HS256). header.payload.signature, each
# segment base64url. Used across the suite as the canonical "real token".
REAL_JWT = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
    ".eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkphbmUifQ"
    ".SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
)


def _contains_jwt(value: Any) -> bool:
    """Return ``True`` if any JWT-shaped substring survives anywhere."""
    return JWT_REGEX.search(json.dumps(value)) is not None


# ---------------------------------------------------------------------------
# JWT_REGEX — match contract (no false negatives)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "token",
    [
        REAL_JWT,
        # Minimal three-segment token: eyJ header + one-char payload + sig.
        "eyJa.b.c",
        # base64url alphabet includes '-' and '_'.
        "eyJhbGci_-.payLOAD-_09.sig-_AZ",
        # Long opaque segments (typical RS256 signature length).
        "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJhY2N0In0."
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-",
        # Digits in header tail.
        "eyJ123.456.789",
    ],
)
def test_regex_matches_jwt_shaped_strings(token: str) -> None:
    match = JWT_REGEX.search(token)
    assert match is not None
    assert match.group(0) == token


def test_regex_finds_jwt_embedded_in_text() -> None:
    text = f"Authorization: Bearer {REAL_JWT} (expired)"
    match = JWT_REGEX.search(text)
    assert match is not None
    assert match.group(0) == REAL_JWT


# ---------------------------------------------------------------------------
# JWT_REGEX — no-match contract (no false positives)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "text",
    [
        "not-a-token",
        "a.b.c",  # dotted triple, but no eyJ header prefix
        "1.2.3",  # semantic version
        "package.module.Class",  # dotted identifier path
        "http://example.com/a/b",  # URL, no dotted base64url triple
        "eyJonly.twosegments",  # only two segments
        "eyJheaderonly",  # one segment, no dots
        "plain prose with no token at all",
        "",  # empty string
        "eyJ..",  # eyJ but empty segments
        "eyJheader.payloadonly",  # eyJ header but only two segments
    ],
)
def test_regex_rejects_non_jwt_strings(text: str) -> None:
    assert JWT_REGEX.search(text) is None


def test_regex_is_aggressive_no_word_boundary() -> None:
    # By design (over-redaction is safe, under-redaction leaks a credential):
    # an embedded ``eyJ…`` triple is matched even mid-word. We never anchor on
    # a word boundary, which could otherwise cause a token to slip through.
    assert JWT_REGEX.search("prefixeyJa.b.c") is not None


# ---------------------------------------------------------------------------
# scrub_jwt_string — atomic primitive
# ---------------------------------------------------------------------------


def test_scrub_string_replaces_bare_token() -> None:
    assert scrub_jwt_string(REAL_JWT) == REDACTED_JWT


def test_scrub_string_preserves_surrounding_text() -> None:
    out = scrub_jwt_string(f"Bearer {REAL_JWT} rejected")
    assert out == f"Bearer {REDACTED_JWT} rejected"
    assert REAL_JWT not in out


def test_scrub_string_replaces_all_occurrences() -> None:
    out = scrub_jwt_string(f"a={REAL_JWT} b=eyJa.b.c")
    assert out == f"a={REDACTED_JWT} b={REDACTED_JWT}"
    assert not _contains_jwt(out)


def test_scrub_string_leaves_clean_text_untouched() -> None:
    text = "version 1.2.3 deployed for package.module.Func"
    assert scrub_jwt_string(text) == text


def test_scrub_string_handles_empty_string() -> None:
    assert scrub_jwt_string("") == ""


# ---------------------------------------------------------------------------
# scrub_jwt_strings — recursive walker
# ---------------------------------------------------------------------------


def test_scrub_jwt_in_exception_message_value() -> None:
    event = {
        "exception": {
            "values": [
                {
                    "type": "AuthError",
                    "value": f"invalid token {REAL_JWT} for request",
                }
            ]
        }
    }
    scrubbed = scrub_jwt_strings(event)
    msg = scrubbed["exception"]["values"][0]["value"]
    assert msg == f"invalid token {REDACTED_JWT} for request"
    assert not _contains_jwt(scrubbed)


def test_scrub_jwt_in_nested_dict_value() -> None:
    event = {"extra": {"headers": {"authorization": f"Bearer {REAL_JWT}"}}}
    scrubbed = scrub_jwt_strings(event)
    assert scrubbed["extra"]["headers"]["authorization"] == f"Bearer {REDACTED_JWT}"


def test_scrub_jwt_in_list_of_strings() -> None:
    event = {"breadcrumbs": ["login", f"issued {REAL_JWT}", "done"]}
    scrubbed = scrub_jwt_strings(event)
    assert scrubbed["breadcrumbs"] == ["login", f"issued {REDACTED_JWT}", "done"]


def test_scrub_jwt_in_deeply_nested_structure() -> None:
    event = {
        "level": "error",
        "tags": [{"k": "auth", "v": f"token={REAL_JWT}"}],
    }
    scrubbed = scrub_jwt_strings(event)
    assert scrubbed["tags"][0]["v"] == f"token={REDACTED_JWT}"
    assert not _contains_jwt(scrubbed)


def test_non_jwt_strings_left_intact_in_structure() -> None:
    event = {"message": "deploy 1.2.3 ok", "path": "a.b.c", "count": 5}
    scrubbed = scrub_jwt_strings(event)
    assert scrubbed == event


def test_tuples_are_normalized_to_lists() -> None:
    scrubbed = scrub_jwt_strings((REAL_JWT, "plain"))
    assert scrubbed == [REDACTED_JWT, "plain"]
    assert isinstance(scrubbed, list)


@pytest.mark.parametrize("scalar", [42, 3.14, None, True, False])
def test_non_string_scalars_pass_through(scalar: Any) -> None:
    assert scrub_jwt_strings(scalar) == scalar


def test_dict_keys_are_not_modified() -> None:
    # Keys are structural; the rule scopes to string *values* only.
    event = {REAL_JWT: f"value {REAL_JWT}"}
    scrubbed = scrub_jwt_strings(event)
    assert REAL_JWT in scrubbed  # key preserved verbatim
    assert scrubbed[REAL_JWT] == f"value {REDACTED_JWT}"


def test_clean_event_returned_equal() -> None:
    event = {"message": "all good", "count": 3, "ok": True}
    assert scrub_jwt_strings(event) == event


def test_empty_containers() -> None:
    assert scrub_jwt_strings({}) == {}
    assert scrub_jwt_strings([]) == []


# ---------------------------------------------------------------------------
# Invariants: purity, never-None, never-raise
# ---------------------------------------------------------------------------


def test_input_is_not_mutated() -> None:
    event = {"msg": f"tok {REAL_JWT}", "nested": {"x": [REAL_JWT]}}
    original = json.loads(json.dumps(event))  # deep snapshot
    scrub_jwt_strings(event)
    assert event == original  # input untouched


def test_dict_input_returns_dict_never_none() -> None:
    # No-event-dropping invariant: a dict in -> a dict out, never ``None``.
    result = scrub_jwt_strings({"a": REAL_JWT})
    assert isinstance(result, dict)
    assert result is not None


def test_realistic_sentry_event_fully_scrubbed() -> None:
    event = {
        "event_id": "abc123",
        "level": "error",
        "message": f"auth failed presenting {REAL_JWT}",
        "exception": {
            "values": [
                {
                    "type": "JWTError",
                    "value": f"signature mismatch on eyJa.b.c and {REAL_JWT}",
                }
            ]
        },
        "breadcrumbs": {
            "values": [
                {"message": f"refreshed to {REAL_JWT}", "level": "info"},
                {"message": "no token here, just 1.2.3", "level": "info"},
            ]
        },
        "extra": {"attempts": 2, "version": "1.2.3"},
    }
    scrubbed = scrub_jwt_strings(event)

    # Structure preserved.
    assert scrubbed["event_id"] == "abc123"
    assert scrubbed["extra"]["attempts"] == 2
    assert scrubbed["extra"]["version"] == "1.2.3"  # semver untouched
    # Every token gone, redaction sentinel present.
    assert not _contains_jwt(scrubbed)
    assert scrubbed["message"] == f"auth failed presenting {REDACTED_JWT}"
    assert REDACTED_JWT in scrubbed["exception"]["values"][0]["value"]
