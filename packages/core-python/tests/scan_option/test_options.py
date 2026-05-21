"""Unit tests for `scan_option.options` (Sub-AC 5.1).

What we lock down here:

    - ``get_available_options()`` returns the canonical 3-option catalogue
      in the canonical slot order (1, 2, 3).
    - Each option carries the exact id / role / slot / status / label /
      placeholder flag specified by the Seed (mirror of catalogue.ts).
    - The catalogue and its entries are immutable (frozen dataclass,
      tuple container) — accidental mutation must raise.
    - ``validate_catalogue`` enforces every invariant in `schema.ts` so a
      drifted Python catalogue can never reach production undetected.

Together these protect the cross-language contract: the funnel UI (TS)
and the diagnosis orchestrator (Python) must agree on the same 3 scan
options, in the same order, with the same labels.
"""

from __future__ import annotations

from dataclasses import FrozenInstanceError, replace

import pytest

from scan_option.options import (
    MAIN_SCAN_ID,
    SCAN_OPTION_COUNT,
    SCAN_OPTION_SLOTS,
    ScanOption,
    ScanOptionId,
    ScanOptionRole,
    ScanOptionStatus,
    get_available_options,
    get_main_scan_option,
    get_secondary_scan_options,
    validate_catalogue,
)

# ---------------------------------------------------------------------------
# Catalogue cardinality & ordering
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_get_available_options_returns_exactly_three_entries() -> None:
    options = get_available_options()
    assert len(options) == SCAN_OPTION_COUNT == 3


@pytest.mark.unit
def test_get_available_options_returns_a_tuple_not_a_list() -> None:
    # tuple-ness is part of the immutability contract.
    assert isinstance(get_available_options(), tuple)


@pytest.mark.unit
def test_get_available_options_is_a_stable_singleton() -> None:
    # Caller should be able to compare results across calls cheaply.
    assert get_available_options() is get_available_options()


@pytest.mark.unit
def test_options_are_ordered_by_slot_one_two_three() -> None:
    slots = tuple(opt.slot for opt in get_available_options())
    assert slots == SCAN_OPTION_SLOTS == (1, 2, 3)


# ---------------------------------------------------------------------------
# Per-option property assertions — mirror catalogue.ts exactly
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_slot_one_is_the_personal_color_main_hook() -> None:
    options = get_available_options()
    slot1 = options[0]

    assert slot1.id is ScanOptionId.PERSONAL_COLOR
    assert slot1.id.value == "personal_color"  # mirrors catalogue.ts id string
    assert slot1.role is ScanOptionRole.MAIN
    assert slot1.slot == 1
    assert slot1.status is ScanOptionStatus.AVAILABLE
    assert slot1.display_label_ko == "퍼스널 컬러 진단"
    assert slot1.placeholder is False


@pytest.mark.unit
def test_slot_two_is_the_first_secondary_placeholder() -> None:
    slot2 = get_available_options()[1]

    assert slot2.id is ScanOptionId.SCAN_SLOT_2
    assert slot2.id.value == "scan_slot_2"
    assert slot2.role is ScanOptionRole.SECONDARY
    assert slot2.slot == 2
    assert slot2.status is ScanOptionStatus.PHASE_N_TBD
    assert slot2.display_label_ko == "두번째 스캔 (곧 오픈)"
    assert slot2.placeholder is True


@pytest.mark.unit
def test_slot_three_is_the_second_secondary_placeholder() -> None:
    slot3 = get_available_options()[2]

    assert slot3.id is ScanOptionId.SCAN_SLOT_3
    assert slot3.id.value == "scan_slot_3"
    assert slot3.role is ScanOptionRole.SECONDARY
    assert slot3.slot == 3
    assert slot3.status is ScanOptionStatus.PHASE_N_TBD
    assert slot3.display_label_ko == "세번째 스캔 (곧 오픈)"
    assert slot3.placeholder is True


@pytest.mark.unit
def test_all_options_have_unique_ids() -> None:
    options = get_available_options()
    ids = [opt.id for opt in options]
    assert len(set(ids)) == len(ids) == 3


@pytest.mark.unit
def test_all_options_have_non_empty_korean_labels_with_hangul() -> None:
    for opt in get_available_options():
        assert opt.display_label_ko.strip()
        # Spot-check that at least one Hangul syllable is present —
        # mirrors the schema.ts Korean-text invariant.
        assert any(
            "가" <= ch <= "힣" for ch in opt.display_label_ko
        ), f"{opt.id.value} label has no Hangul"


# ---------------------------------------------------------------------------
# Helper getters
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_get_main_scan_option_returns_the_personal_color_hook() -> None:
    main = get_main_scan_option()
    assert main.id is MAIN_SCAN_ID is ScanOptionId.PERSONAL_COLOR
    assert main.role is ScanOptionRole.MAIN
    assert main.slot == 1


@pytest.mark.unit
def test_get_secondary_scan_options_returns_exactly_the_two_placeholders() -> None:
    secondaries = get_secondary_scan_options()

    assert len(secondaries) == 2
    assert all(opt.role is ScanOptionRole.SECONDARY for opt in secondaries)
    assert tuple(opt.id for opt in secondaries) == (
        ScanOptionId.SCAN_SLOT_2,
        ScanOptionId.SCAN_SLOT_3,
    )


# ---------------------------------------------------------------------------
# Immutability contract
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_scan_option_is_a_frozen_dataclass() -> None:
    opt = get_available_options()[0]
    with pytest.raises(FrozenInstanceError):
        # Type ignored: we *want* the static-type error; we're asserting the
        # runtime immutability check, not the type-checker's.
        opt.display_label_ko = "something else"  # type: ignore[misc]


@pytest.mark.unit
def test_catalogue_tuple_cannot_be_mutated() -> None:
    options = get_available_options()
    with pytest.raises(TypeError):
        # tuples don't support item assignment.
        options[0] = options[1]  # type: ignore[index]


# ---------------------------------------------------------------------------
# validate_catalogue — invariants must reject every drift mode
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_validate_catalogue_accepts_the_canonical_catalogue() -> None:
    # The canonical catalogue is validated at import time, but call again
    # for explicitness: no exception on the default argument.
    validate_catalogue()
    validate_catalogue(get_available_options())


@pytest.mark.unit
def test_validate_catalogue_rejects_wrong_size() -> None:
    short = get_available_options()[:2]
    with pytest.raises(ValueError, match="exactly 3"):
        validate_catalogue(short)


@pytest.mark.unit
def test_validate_catalogue_rejects_duplicate_slots() -> None:
    options = get_available_options()
    # Force a duplicate slot by replacing slot-3's slot with 2.
    drifted = (
        options[0],
        options[1],
        replace(options[2], slot=2),
    )
    with pytest.raises(ValueError, match="slot indices"):
        validate_catalogue(drifted)


@pytest.mark.unit
def test_validate_catalogue_rejects_main_in_non_first_slot() -> None:
    options = get_available_options()
    drifted = (
        replace(options[0], slot=2),
        replace(options[1], slot=1),
        options[2],
    )
    with pytest.raises(ValueError):
        validate_catalogue(drifted)


@pytest.mark.unit
def test_validate_catalogue_rejects_secondary_marked_available() -> None:
    options = get_available_options()
    drifted = (
        options[0],
        # placeholder=False to keep status/placeholder coherent, so we hit
        # the secondary-status check rather than the coherence check.
        replace(options[1], status=ScanOptionStatus.AVAILABLE, placeholder=False),
        options[2],
    )
    with pytest.raises(ValueError, match="PHASE_N_TBD"):
        validate_catalogue(drifted)


@pytest.mark.unit
def test_validate_catalogue_rejects_status_placeholder_mismatch() -> None:
    options = get_available_options()
    # A placeholder slot that *claims* not to be a placeholder while still
    # carrying PHASE_N_TBD status is an inconsistency the funnel UI would
    # render incorrectly (no "곧 오픈" ribbon).
    drifted = (
        options[0],
        replace(options[1], placeholder=False),
        options[2],
    )
    with pytest.raises(ValueError, match="placeholder flag"):
        validate_catalogue(drifted)


@pytest.mark.unit
def test_validate_catalogue_rejects_empty_label() -> None:
    options = get_available_options()
    drifted = (
        options[0],
        replace(options[1], display_label_ko="   "),
        options[2],
    )
    with pytest.raises(ValueError, match="empty display_label_ko"):
        validate_catalogue(drifted)


@pytest.mark.unit
def test_validate_catalogue_rejects_non_korean_label() -> None:
    options = get_available_options()
    drifted = (
        options[0],
        replace(options[1], display_label_ko="english only"),
        options[2],
    )
    with pytest.raises(ValueError, match="Hangul"):
        validate_catalogue(drifted)


@pytest.mark.unit
def test_validate_catalogue_rejects_duplicate_ids() -> None:
    options = get_available_options()
    # Two entries share the same id — must be rejected even when slots
    # happen to remain {1, 2, 3}.
    drifted = (
        options[0],
        replace(options[1], id=ScanOptionId.SCAN_SLOT_3),
        options[2],
    )
    with pytest.raises(ValueError, match="unique"):
        validate_catalogue(drifted)


# ---------------------------------------------------------------------------
# Construction sanity — make sure the dataclass itself accepts the values
# the catalogue feeds it (regression guard against future field renames).
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_scan_option_can_be_constructed_with_canonical_main_fields() -> None:
    opt = ScanOption(
        id=ScanOptionId.PERSONAL_COLOR,
        role=ScanOptionRole.MAIN,
        slot=1,
        status=ScanOptionStatus.AVAILABLE,
        display_label_ko="퍼스널 컬러 진단",
        placeholder=False,
    )
    assert opt == get_main_scan_option()
