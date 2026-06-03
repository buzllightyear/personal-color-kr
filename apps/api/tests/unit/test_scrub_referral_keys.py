"""Unit tests for recursive key-based referral-code scrubbing (Phase 7.2, AC-10).

These tests exercise
:func:`api.observability.scrub_referral_keys.scrub_referral_keys` against
*synthetic* Sentry-shaped event dicts only — they never construct a Sentry
client and never contact Sentry.io. They pin the AC-10 contract:

    * the enumerated referral-code field names — ``referral_code`` /
      ``referralCode`` — cause the matching field's value to be redacted,
      case-insensitively, wherever they appear;
    * matching is on the *whole* key name (not a substring), so neighbouring
      fields like ``code`` / ``referral_count`` / ``referrer_id`` are preserved;
    * **no value-pattern regex** is applied — a referral-code-shaped *value*
      under a non-referral key is left untouched;
    * scrubbing is recursive through nested dicts and lists;
    * the value is redacted regardless of its type (string, None, dict, …);
    * the function is pure (input is never mutated) and never returns ``None``.
"""

from __future__ import annotations

import pytest

from api.observability.scrub_referral_keys import (
    REDACTED,
    REFERRAL_CODE_KEY_NAMES,
    scrub_referral_keys,
)


@pytest.mark.unit
def test_redacted_marker_is_legible_sentinel() -> None:
    """The redaction marker is the documented ``[redacted]`` sentinel."""
    assert REDACTED == "[redacted]"


@pytest.mark.unit
def test_referral_code_key_names_are_the_enumerated_set() -> None:
    """The canonical key set matches the Seed enumeration, normalized."""
    assert set(REFERRAL_CODE_KEY_NAMES) == {"referral_code", "referralcode"}
    for name in REFERRAL_CODE_KEY_NAMES:
        assert name == name.lower()


# ---------------------------------------------------------------------------
# Each enumerated target key, used verbatim, is redacted
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize("key", ["referral_code", "referralCode"])
def test_scrubs_each_enumerated_target_key(key: str) -> None:
    """Each target key name has its value redacted."""
    event = {key: "ABC123"}
    assert scrub_referral_keys(event) == {key: REDACTED}


# ---------------------------------------------------------------------------
# Case-insensitivity (whole-key match)
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize(
    "key",
    [
        "referral_code",
        "REFERRAL_CODE",
        "Referral_Code",
        "referralCode",
        "REFERRALCODE",
        "ReferralCode",
        "referralcode",
    ],
)
def test_scrubs_case_insensitively(key: str) -> None:
    event = {key: "XYZ789"}
    assert scrub_referral_keys(event) == {key: REDACTED}


# ---------------------------------------------------------------------------
# Whole-key match only — neighbouring / decorated keys are NOT scrubbed
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize(
    "key",
    [
        "code",
        "referral_count",
        "referrer_id",
        "referral",
        "referral_url",
        "my_referral_code",  # substring, but not a whole-key match
        "referral_code_id",  # substring, but not a whole-key match
        "user_id",
        "message",
    ],
)
def test_does_not_scrub_non_matching_keys(key: str) -> None:
    """Only the exact referral-code field names match (no substring match)."""
    event = {key: "plain-value"}
    assert scrub_referral_keys(event) == {key: "plain-value"}


# ---------------------------------------------------------------------------
# No value-pattern regex — referral-code-shaped values under other keys survive
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_no_value_pattern_regex_referral_shaped_value_under_other_key() -> None:
    """A referral-code-looking value is preserved unless its key matches."""
    event = {"message": "user redeemed ABC123", "code": "ABC123"}
    assert scrub_referral_keys(event) == {
        "message": "user redeemed ABC123",
        "code": "ABC123",
    }


# ---------------------------------------------------------------------------
# Value type independence — redact regardless of value shape
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize(
    "value",
    ["ABC123", None, 12345, {"nested": "dict"}, ["a", "b"], True],
)
def test_redacts_value_regardless_of_type(value: object) -> None:
    """A matched key's value is replaced wholesale, whatever its type."""
    event = {"referral_code": value}
    assert scrub_referral_keys(event) == {"referral_code": REDACTED}


# ---------------------------------------------------------------------------
# Recursion through nested dicts and lists
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_scrubs_nested_dict() -> None:
    event = {
        "extra": {
            "referral_code": "ABC123",
            "campaign": "spring",
        }
    }
    assert scrub_referral_keys(event) == {
        "extra": {
            "referral_code": REDACTED,
            "campaign": "spring",
        }
    }


@pytest.mark.unit
def test_scrubs_list_of_dicts() -> None:
    event = {
        "breadcrumbs": [
            {"message": "redeem", "data": {"referralCode": "ZZZ999"}},
            {"message": "noop", "data": {"count": 1}},
        ]
    }
    assert scrub_referral_keys(event) == {
        "breadcrumbs": [
            {"message": "redeem", "data": {"referralCode": REDACTED}},
            {"message": "noop", "data": {"count": 1}},
        ]
    }


@pytest.mark.unit
def test_scrubs_deeply_nested_mixed_structure() -> None:
    event = {
        "contexts": {
            "items": [
                {"referral_code": "a1"},
                {"nested": [{"referralCode": "b2"}]},
            ]
        }
    }
    scrubbed = scrub_referral_keys(event)
    assert scrubbed["contexts"]["items"][0] == {"referral_code": REDACTED}
    assert scrubbed["contexts"]["items"][1]["nested"][0] == {"referralCode": REDACTED}


# ---------------------------------------------------------------------------
# Purity and never-None guarantees
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_input_is_not_mutated() -> None:
    """Scrubbing returns a new structure; the original is unchanged."""
    event = {"extra": {"referral_code": "ABC123"}}
    snapshot = {"extra": {"referral_code": "ABC123"}}
    _ = scrub_referral_keys(event)
    assert event == snapshot
    # The nested dict object is a fresh copy, not the same reference.
    assert scrub_referral_keys(event)["extra"] is not event["extra"]


@pytest.mark.unit
def test_returns_dict_never_none_for_dict_input() -> None:
    """A dict input always yields a dict (no event dropping)."""
    result = scrub_referral_keys({"referral_code": "ABC123"})
    assert isinstance(result, dict)
    assert result is not None


@pytest.mark.unit
def test_empty_event_is_returned_unchanged() -> None:
    assert scrub_referral_keys({}) == {}


@pytest.mark.unit
def test_scalars_pass_through_unchanged() -> None:
    """Non-container inputs round-trip (recursion base case)."""
    assert scrub_referral_keys("plain") == "plain"
    assert scrub_referral_keys(None) is None
    assert scrub_referral_keys(42) == 42


@pytest.mark.unit
def test_tuples_are_normalized_to_lists() -> None:
    """Sequences are returned as lists, matching Sentry JSON serialization."""
    event = {"values": ({"referral_code": "x"}, {"id": 1})}
    assert scrub_referral_keys(event) == {
        "values": [{"referral_code": REDACTED}, {"id": 1}]
    }


@pytest.mark.unit
def test_non_string_keys_are_ignored() -> None:
    """Non-string keys never match and their values still recurse."""
    event = {1: {"referral_code": "abc"}, 2: "plain"}
    assert scrub_referral_keys(event) == {
        1: {"referral_code": REDACTED},
        2: "plain",
    }


@pytest.mark.unit
def test_realistic_sentry_exception_event_shape() -> None:
    """An end-to-end exception-event shape is scrubbed at every referral key."""
    event = {
        "level": "error",
        "request": {"url": "/v1/referrals/me"},
        "extra": {
            "payload": {"referral_code": "ABC123", "referralCode": "XYZ789"},
            "referral_count": 4,
        },
        "contexts": {"invite": {"referral_code": "DEF456"}},
    }
    scrubbed = scrub_referral_keys(event)
    assert scrubbed["extra"]["payload"]["referral_code"] == REDACTED
    assert scrubbed["extra"]["payload"]["referralCode"] == REDACTED
    assert scrubbed["contexts"]["invite"]["referral_code"] == REDACTED
    # Non-referral-code structure is preserved verbatim.
    assert scrubbed["level"] == "error"
    assert scrubbed["request"]["url"] == "/v1/referrals/me"
    assert scrubbed["extra"]["referral_count"] == 4
