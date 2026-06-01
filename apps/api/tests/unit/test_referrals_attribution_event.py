"""Unit tests for the ``referral_attributed`` event builder (Phase 4.5).

Pins the contract of
:func:`api.referrals.attribution_event.build_referral_attributed_event`:

    * Given ``referrer_id`` + ``referral_code`` it returns a record whose
      ``event_name`` is the literal ``"referral_attributed"`` and whose
      ``properties`` is exactly ``{"referrer_id": ..., "referral_code": ...}``.
    * The record is immutable (frozen) and each call yields an independent
      ``properties`` bag (no shared mutable default).
    * Blank ``referrer_id`` / ``referral_code`` fail fast with ``ValueError``
      rather than emitting a malformed event.
    * The builder's ``event_name`` matches the events schema's ``^[a-z_]+$``
      shape and the constant the auth router writes.
"""

from __future__ import annotations

import dataclasses
import re
import uuid

import pytest

from api.referrals.attribution_event import (
    REFERRAL_ATTRIBUTED_EVENT_NAME,
    REFERRAL_ATTRIBUTED_PROP_REFERRAL_CODE,
    REFERRAL_ATTRIBUTED_PROP_REFERRER_ID,
    ReferralAttributedEvent,
    build_referral_attributed_event,
)


@pytest.mark.unit
def test_event_name_constant_matches_events_schema_shape() -> None:
    """The event name is the snake_case literal the events schema accepts."""
    assert REFERRAL_ATTRIBUTED_EVENT_NAME == "referral_attributed"
    assert re.fullmatch(r"[a-z_]+", REFERRAL_ATTRIBUTED_EVENT_NAME)


@pytest.mark.unit
def test_property_key_constants_are_referrer_id_and_referral_code() -> None:
    """The two property keys are the analytics-graph identifiers."""
    assert REFERRAL_ATTRIBUTED_PROP_REFERRER_ID == "referrer_id"
    assert REFERRAL_ATTRIBUTED_PROP_REFERRAL_CODE == "referral_code"


@pytest.mark.unit
def test_builds_event_with_name_and_properties() -> None:
    """The builder returns the canonical name + the two-key properties bag."""
    referrer_id = str(uuid.uuid4())
    event = build_referral_attributed_event(
        referrer_id=referrer_id, referral_code="aB3dEf7h"
    )

    assert isinstance(event, ReferralAttributedEvent)
    assert event.event_name == REFERRAL_ATTRIBUTED_EVENT_NAME
    assert event.properties == {
        "referrer_id": referrer_id,
        "referral_code": "aB3dEf7h",
    }


@pytest.mark.unit
def test_properties_contains_exactly_the_two_keys() -> None:
    """No extra keys leak into the ``properties`` bag."""
    event = build_referral_attributed_event(
        referrer_id="ref-id", referral_code="aB3dEf7h"
    )
    assert set(event.properties) == {"referrer_id", "referral_code"}


@pytest.mark.unit
def test_record_is_frozen_immutable() -> None:
    """The record cannot be rebound after construction (frozen dataclass)."""
    event = build_referral_attributed_event(
        referrer_id="ref-id", referral_code="aB3dEf7h"
    )
    with pytest.raises(dataclasses.FrozenInstanceError):
        event.event_name = "tampered"  # type: ignore[misc]


@pytest.mark.unit
def test_each_call_yields_an_independent_properties_bag() -> None:
    """No two records share a mutable ``properties`` dict."""
    first = build_referral_attributed_event(
        referrer_id="ref-1", referral_code="aB3dEf7h"
    )
    second = build_referral_attributed_event(
        referrer_id="ref-2", referral_code="Xy9zAb2c"
    )
    assert first.properties is not second.properties
    # Mutating one does not bleed into the other.
    first.properties["referrer_id"] = "mutated"
    assert second.properties["referrer_id"] == "ref-2"


@pytest.mark.unit
@pytest.mark.parametrize("blank", ["", "   ", "\t", "\n"])
def test_blank_referrer_id_raises_value_error(blank: str) -> None:
    """A blank referrer_id is a programming error, not a malformed event."""
    with pytest.raises(ValueError):
        build_referral_attributed_event(referrer_id=blank, referral_code="aB3dEf7h")


@pytest.mark.unit
@pytest.mark.parametrize("blank", ["", "   ", "\t", "\n"])
def test_blank_referral_code_raises_value_error(blank: str) -> None:
    """A blank referral_code is a programming error, not a malformed event."""
    with pytest.raises(ValueError):
        build_referral_attributed_event(referrer_id="ref-id", referral_code=blank)
