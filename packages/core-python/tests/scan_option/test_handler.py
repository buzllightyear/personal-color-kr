"""Unit tests for ``scan_option.handler`` (Sub-AC 5.2).

The handler is the runtime selection-state shim in front of the immutable
catalogue. These tests lock down the four state-machine transitions the
Sub-AC calls out plus the immutability boundary between handler state and
catalogue records.

Covered behaviours:

    - Initial state — ``get_selected()`` returns ``None`` until a
      ``select()`` call.
    - Valid selection — ``select(id)`` records the option and round-trips
      via ``get_selected()`` (returning the same frozen catalogue record).
    - Invalid selection — passing an id not in the catalogue raises
      ``UnknownScanOptionError`` and leaves prior state untouched.
    - Re-selection — calling ``select()`` again replaces the previous
      choice without raising.
    - Reset — ``reset()`` returns the handler to the initial state.
    - Catalogue isolation — handlers don't share state, and the catalogue
      records remain frozen after a selection round-trip.
"""

from __future__ import annotations

from dataclasses import FrozenInstanceError

import pytest

from scan_option.handler import (
    ScanOptionHandler,
    UnknownScanOptionError,
)
from scan_option.options import (
    ScanOptionId,
    ScanOptionRole,
    ScanOptionStatus,
    get_available_options,
    get_main_scan_option,
)

# ---------------------------------------------------------------------------
# Initial state
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_initial_state_has_no_selection() -> None:
    handler = ScanOptionHandler()
    assert handler.get_selected() is None


@pytest.mark.unit
def test_initial_state_reports_is_selected_false() -> None:
    handler = ScanOptionHandler()
    assert handler.is_selected() is False


# ---------------------------------------------------------------------------
# Valid selection
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_select_main_option_returns_personal_color_record() -> None:
    handler = ScanOptionHandler()
    chosen = handler.select(ScanOptionId.PERSONAL_COLOR)

    assert chosen.id is ScanOptionId.PERSONAL_COLOR
    assert chosen.role is ScanOptionRole.MAIN
    assert chosen.slot == 1
    assert chosen.status is ScanOptionStatus.AVAILABLE
    assert chosen.placeholder is False


@pytest.mark.unit
def test_get_selected_after_select_returns_same_record() -> None:
    handler = ScanOptionHandler()
    chosen = handler.select(ScanOptionId.PERSONAL_COLOR)

    retrieved = handler.get_selected()
    # Identity-stable: same frozen catalogue singleton, not a copy.
    assert retrieved is chosen
    assert retrieved is get_main_scan_option()


@pytest.mark.unit
def test_is_selected_after_select_returns_true() -> None:
    handler = ScanOptionHandler()
    handler.select(ScanOptionId.PERSONAL_COLOR)
    assert handler.is_selected() is True


@pytest.mark.unit
def test_select_accepts_raw_string_id() -> None:
    # UI layer often supplies the option id as a click-event payload string;
    # the handler coerces it to a ScanOptionId rather than forcing the caller
    # to do so.
    handler = ScanOptionHandler()
    chosen = handler.select("personal_color")
    assert chosen.id is ScanOptionId.PERSONAL_COLOR


@pytest.mark.unit
@pytest.mark.parametrize(
    "option_id",
    [
        ScanOptionId.PERSONAL_COLOR,
        ScanOptionId.SCAN_SLOT_2,
        ScanOptionId.SCAN_SLOT_3,
    ],
)
def test_select_works_for_every_catalogue_option(
    option_id: ScanOptionId,
) -> None:
    handler = ScanOptionHandler()
    chosen = handler.select(option_id)
    assert chosen.id is option_id
    assert handler.get_selected() is chosen


# ---------------------------------------------------------------------------
# Invalid selection
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_select_unknown_string_id_raises_unknown_scan_option_error() -> None:
    handler = ScanOptionHandler()
    with pytest.raises(UnknownScanOptionError) as excinfo:
        handler.select("not_a_real_scan")

    err = excinfo.value
    assert err.attempted_id == "not_a_real_scan"
    # The error advertises the catalogue ids so call sites can render a
    # debuggable "did you mean…" message.
    advertised_ids = {opt.value for opt in err.known_ids}
    assert advertised_ids == {opt.id.value for opt in get_available_options()}


@pytest.mark.unit
def test_select_unknown_id_leaves_prior_selection_untouched() -> None:
    # The handler should be transactional w.r.t. failed selections — a bad
    # call must not clobber a good earlier one.
    handler = ScanOptionHandler()
    handler.select(ScanOptionId.PERSONAL_COLOR)

    with pytest.raises(UnknownScanOptionError):
        handler.select("bogus")

    still_selected = handler.get_selected()
    assert still_selected is not None
    assert still_selected.id is ScanOptionId.PERSONAL_COLOR


@pytest.mark.unit
def test_select_unknown_id_from_initial_state_keeps_none_selection() -> None:
    handler = ScanOptionHandler()
    with pytest.raises(UnknownScanOptionError):
        handler.select("bogus")
    assert handler.get_selected() is None


@pytest.mark.unit
def test_select_non_string_non_enum_input_raises_unknown_scan_option_error() -> None:
    handler = ScanOptionHandler()
    with pytest.raises(UnknownScanOptionError):
        handler.select(123)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# Re-selection
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_reselection_replaces_previous_choice() -> None:
    handler = ScanOptionHandler()
    handler.select(ScanOptionId.PERSONAL_COLOR)
    handler.select(ScanOptionId.SCAN_SLOT_2)

    current = handler.get_selected()
    assert current is not None
    assert current.id is ScanOptionId.SCAN_SLOT_2


@pytest.mark.unit
def test_reselection_returns_newly_chosen_record() -> None:
    handler = ScanOptionHandler()
    handler.select(ScanOptionId.PERSONAL_COLOR)
    re_chosen = handler.select(ScanOptionId.SCAN_SLOT_3)

    assert re_chosen.id is ScanOptionId.SCAN_SLOT_3
    assert handler.get_selected() is re_chosen


@pytest.mark.unit
def test_reselection_to_same_option_is_idempotent() -> None:
    handler = ScanOptionHandler()
    first = handler.select(ScanOptionId.PERSONAL_COLOR)
    second = handler.select(ScanOptionId.PERSONAL_COLOR)
    # Identity-stable across repeated selects because the catalogue records
    # are singletons.
    assert first is second
    assert handler.get_selected() is first


# ---------------------------------------------------------------------------
# Reset
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_reset_from_initial_state_keeps_no_selection() -> None:
    handler = ScanOptionHandler()
    handler.reset()
    assert handler.get_selected() is None
    assert handler.is_selected() is False


@pytest.mark.unit
def test_reset_after_select_clears_selection() -> None:
    handler = ScanOptionHandler()
    handler.select(ScanOptionId.PERSONAL_COLOR)
    handler.reset()

    assert handler.get_selected() is None
    assert handler.is_selected() is False


@pytest.mark.unit
def test_reset_then_select_recovers_full_functionality() -> None:
    handler = ScanOptionHandler()
    handler.select(ScanOptionId.PERSONAL_COLOR)
    handler.reset()

    # Handler must still be usable post-reset — no permanent state damage.
    again = handler.select(ScanOptionId.SCAN_SLOT_2)
    assert again.id is ScanOptionId.SCAN_SLOT_2
    assert handler.get_selected() is again


# ---------------------------------------------------------------------------
# Isolation / immutability boundary
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_independent_handlers_do_not_share_selection_state() -> None:
    h1 = ScanOptionHandler()
    h2 = ScanOptionHandler()
    h1.select(ScanOptionId.PERSONAL_COLOR)

    assert h1.get_selected() is not None
    assert h2.get_selected() is None


@pytest.mark.unit
def test_selecting_does_not_mutate_underlying_catalogue_record() -> None:
    handler = ScanOptionHandler()
    chosen = handler.select(ScanOptionId.PERSONAL_COLOR)
    with pytest.raises(FrozenInstanceError):
        # The selection round-trip must not have downgraded the frozen
        # dataclass — catalogue records remain immutable.
        chosen.display_label_ko = "tampered"  # type: ignore[misc]


@pytest.mark.unit
def test_unknown_error_message_lists_every_catalogue_id() -> None:
    handler = ScanOptionHandler()
    with pytest.raises(UnknownScanOptionError) as excinfo:
        handler.select("definitely-not-real")

    message = str(excinfo.value)
    for opt in get_available_options():
        assert opt.id.value in message
