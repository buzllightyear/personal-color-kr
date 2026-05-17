"""Unit tests for ``scan_option.ui`` (Sub-AC 5.3).

The renderer is the read-only bridge between the immutable catalogue and
the runtime handler. These tests lock down:

    - Rendering structure: exactly 3 items, in slot order 1 → 2 → 3,
      each with the catalogue's id / slot / label / role / placeholder
      flag.
    - Step-6 metadata: ``step_id``, ``step_number``, ``option_count`` are
      pinned to the Seed-mandated constants.
    - Selection-state reflection: the view's ``is_selected`` flag tracks
      the handler — ``None`` initially, exactly one ``True`` after a
      ``select()``, and back to all-``False`` after ``reset()``.
    - Re-selection: the prior selection's ``is_selected`` flips to
      ``False`` when a different option becomes the active choice.
    - Read-only contract: rendering never mutates the handler, and the
      returned view-model is frozen (cannot be assigned to).
"""

from __future__ import annotations

from dataclasses import FrozenInstanceError

import pytest

from scan_option.handler import ScanOptionHandler
from scan_option.options import (
    MAIN_SCAN_ID,
    SCAN_OPTION_COUNT,
    SCAN_OPTION_SLOTS,
    ScanOptionId,
    ScanOptionRole,
    ScanOptionStatus,
    get_available_options,
)
from scan_option.ui import (
    ScanOptionItemView,
    ScanOptionsView,
    render_scan_options,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _ids_of(view: ScanOptionsView) -> tuple[ScanOptionId, ...]:
    return tuple(item.id for item in view.options)


def _selected_items(view: ScanOptionsView) -> list[ScanOptionItemView]:
    return [item for item in view.options if item.is_selected]


# ---------------------------------------------------------------------------
# Rendering structure
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_renders_exactly_three_items() -> None:
    handler = ScanOptionHandler()
    view = render_scan_options(handler)
    assert len(view.options) == SCAN_OPTION_COUNT == 3
    assert view.option_count == 3


@pytest.mark.unit
def test_options_are_ordered_by_slot() -> None:
    handler = ScanOptionHandler()
    view = render_scan_options(handler)
    slots = tuple(item.slot for item in view.options)
    assert slots == SCAN_OPTION_SLOTS == (1, 2, 3)


@pytest.mark.unit
def test_step_metadata_is_pinned() -> None:
    handler = ScanOptionHandler()
    view = render_scan_options(handler)
    assert view.step_id == "scan_option_select"
    assert view.step_number == 6


@pytest.mark.unit
def test_rendered_ids_match_catalogue() -> None:
    handler = ScanOptionHandler()
    view = render_scan_options(handler)
    catalogue_ids = tuple(opt.id for opt in get_available_options())
    assert _ids_of(view) == catalogue_ids


@pytest.mark.unit
def test_rendered_labels_match_catalogue_labels() -> None:
    handler = ScanOptionHandler()
    view = render_scan_options(handler)
    catalogue_labels = tuple(opt.display_label_ko for opt in get_available_options())
    rendered_labels = tuple(item.label for item in view.options)
    assert rendered_labels == catalogue_labels


@pytest.mark.unit
def test_main_option_is_personal_color_in_slot_one() -> None:
    handler = ScanOptionHandler()
    view = render_scan_options(handler)

    assert view.main_option.id is MAIN_SCAN_ID
    assert view.main_option.slot == 1
    assert view.main_option.is_main is True
    assert view.main_option.is_placeholder is False
    assert view.main_option.status is ScanOptionStatus.AVAILABLE


@pytest.mark.unit
def test_exactly_one_main_option_in_rendered_view() -> None:
    handler = ScanOptionHandler()
    view = render_scan_options(handler)
    mains = [item for item in view.options if item.is_main]
    assert len(mains) == 1
    assert mains[0].id is MAIN_SCAN_ID


@pytest.mark.unit
def test_secondary_options_marked_as_placeholders() -> None:
    handler = ScanOptionHandler()
    view = render_scan_options(handler)
    secondaries = [item for item in view.options if not item.is_main]
    assert len(secondaries) == 2
    for item in secondaries:
        assert item.is_placeholder is True
        assert item.status is ScanOptionStatus.PHASE_N_TBD


@pytest.mark.unit
def test_test_ids_are_deterministic_and_unique_per_slot() -> None:
    handler = ScanOptionHandler()
    view = render_scan_options(handler)
    test_ids = tuple(item.test_id for item in view.options)
    assert test_ids == ("scan-option-1", "scan-option-2", "scan-option-3")
    assert len(set(test_ids)) == len(test_ids)


# ---------------------------------------------------------------------------
# Selection-state reflection
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_initial_view_has_no_selection() -> None:
    handler = ScanOptionHandler()
    view = render_scan_options(handler)

    assert view.selected_id is None
    assert view.has_selection is False
    assert _selected_items(view) == []
    for item in view.options:
        assert item.is_selected is False


@pytest.mark.unit
def test_view_after_selecting_main_flags_only_personal_color() -> None:
    handler = ScanOptionHandler()
    handler.select(ScanOptionId.PERSONAL_COLOR)
    view = render_scan_options(handler)

    assert view.selected_id is ScanOptionId.PERSONAL_COLOR
    assert view.has_selection is True

    selected = _selected_items(view)
    assert len(selected) == 1
    assert selected[0].id is ScanOptionId.PERSONAL_COLOR
    assert selected[0].slot == 1


@pytest.mark.unit
@pytest.mark.parametrize(
    "option_id",
    [
        ScanOptionId.PERSONAL_COLOR,
        ScanOptionId.SCAN_SLOT_2,
        ScanOptionId.SCAN_SLOT_3,
    ],
)
def test_selection_state_isolated_to_chosen_option(
    option_id: ScanOptionId,
) -> None:
    handler = ScanOptionHandler()
    handler.select(option_id)
    view = render_scan_options(handler)

    for item in view.options:
        if item.id is option_id:
            assert item.is_selected is True
        else:
            assert item.is_selected is False

    assert view.selected_id is option_id
    assert view.has_selection is True


@pytest.mark.unit
def test_reselection_flips_previous_selection_off_and_new_on() -> None:
    handler = ScanOptionHandler()
    handler.select(ScanOptionId.PERSONAL_COLOR)
    handler.select(ScanOptionId.SCAN_SLOT_3)
    view = render_scan_options(handler)

    selected = _selected_items(view)
    assert len(selected) == 1
    assert selected[0].id is ScanOptionId.SCAN_SLOT_3
    assert view.selected_id is ScanOptionId.SCAN_SLOT_3


@pytest.mark.unit
def test_view_after_reset_has_no_selection() -> None:
    handler = ScanOptionHandler()
    handler.select(ScanOptionId.SCAN_SLOT_2)
    handler.reset()
    view = render_scan_options(handler)

    assert view.selected_id is None
    assert view.has_selection is False
    for item in view.options:
        assert item.is_selected is False


@pytest.mark.unit
def test_separate_handlers_produce_independent_views() -> None:
    h1 = ScanOptionHandler()
    h2 = ScanOptionHandler()
    h1.select(ScanOptionId.PERSONAL_COLOR)

    v1 = render_scan_options(h1)
    v2 = render_scan_options(h2)

    assert v1.selected_id is ScanOptionId.PERSONAL_COLOR
    assert v2.selected_id is None
    assert v1.has_selection is True
    assert v2.has_selection is False


# ---------------------------------------------------------------------------
# Pure / read-only contract
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_render_does_not_mutate_handler() -> None:
    handler = ScanOptionHandler()
    handler.select(ScanOptionId.PERSONAL_COLOR)
    before = handler.get_selected()

    render_scan_options(handler)
    after = handler.get_selected()

    # The handler must still point at the same frozen record post-render.
    assert after is before


@pytest.mark.unit
def test_render_called_twice_gives_field_equal_views_with_unchanged_state() -> None:
    handler = ScanOptionHandler()
    handler.select(ScanOptionId.PERSONAL_COLOR)

    first = render_scan_options(handler)
    second = render_scan_options(handler)

    assert first == second
    # We deliberately do *not* assert ``first is second`` — each render
    # materialises a fresh frozen snapshot so callers can hold a prior
    # snapshot for diffing without it being mutated under them.


@pytest.mark.unit
def test_view_is_frozen_top_level() -> None:
    handler = ScanOptionHandler()
    view = render_scan_options(handler)
    with pytest.raises(FrozenInstanceError):
        view.selected_id = ScanOptionId.PERSONAL_COLOR  # type: ignore[misc]


@pytest.mark.unit
def test_item_view_is_frozen() -> None:
    handler = ScanOptionHandler()
    view = render_scan_options(handler)
    item = view.options[0]
    with pytest.raises(FrozenInstanceError):
        item.is_selected = True  # type: ignore[misc]


@pytest.mark.unit
def test_view_options_is_tuple_not_mutable_sequence() -> None:
    handler = ScanOptionHandler()
    view = render_scan_options(handler)
    # Tuples are immutable — guarantees no caller can append/replace items.
    assert isinstance(view.options, tuple)


@pytest.mark.unit
def test_main_option_alias_matches_first_main_in_options() -> None:
    handler = ScanOptionHandler()
    view = render_scan_options(handler)
    main_from_iter = next(item for item in view.options if item.is_main)
    assert view.main_option == main_from_iter
