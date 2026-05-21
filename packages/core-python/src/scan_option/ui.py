"""Step 6 scan-option UI renderer (Sub-AC 5.3).

Ontology concept (Seed): ``scan_option_ui`` — Step 6 (`scan_option_select`)
renders exactly 3 scan-option CTAs. This module is the framework-agnostic
view-model used by the Python diagnosis orchestrator and server-side
preview/analytics pipelines: given a handler's current selection state,
it answers "what would Step 6 look like right now?" without crossing a
language boundary. The ``scan-option-<slot>`` test ids stay aligned with
any future TS-side renderer.

Design:

    - The catalogue (``options.py``) is the immutable source of truth for
      *which* options exist. This module never invents new options.
    - The handler (``handler.py``) owns the runtime *selection state*.
      The renderer reads from it but never mutates it.
    - The renderer is a **pure function** of ``handler`` and the
      module-level catalogue singleton: given the same handler state, the
      same view-model is produced (field-equal). It is *not* identity-
      stable across calls because each call materialises a fresh frozen
      record so callers can compare snapshots over time.

Seed constraints honoured:

    - The view-model is fixed-length 3, in slot order (1, 2, 3).
    - Exactly one ``main`` option (퍼스널 컬러 진단, slot 1).
    - Placeholders (slots 2, 3) are surfaced via ``is_placeholder`` so UI
      code can render the "곧 오픈" badge without re-deriving from status.
    - The renderer does *not* itself perform a selection — it only
      reflects what the handler reports. That separation keeps the read
      path (rendering) and the write path (``handler.select``) cleanly
      partitioned.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from .handler import ScanOptionHandler
from .options import (
    MAIN_SCAN_ID,
    SCAN_OPTION_COUNT,
    ScanOption,
    ScanOptionId,
    ScanOptionRole,
    ScanOptionStatus,
    get_available_options,
)

# ---------------------------------------------------------------------------
# View-model records
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ScanOptionItemView:
    """One rendered scan-option, with selection state baked in.

    Every field is
    precomputed so the UI layer never has to re-derive anything at render
    time (no branching on role, no status-to-placeholder mapping).

    Attributes:
        id: Catalogue id of this option.
        slot: 1-based slot ordering on Step 6 (1, 2, or 3).
        label: User-facing Korean CTA label (from the catalogue).
        is_main: ``True`` iff this is the canonical main hook
            (퍼스널 컬러 진단). Convenience mirror of ``role == MAIN``.
        is_placeholder: ``True`` iff the option is a Phase-N placeholder
            (renders the "곧 오픈" badge). Mirror of
            ``status == PHASE_N_TBD``.
        is_selected: ``True`` iff the handler currently has this option
            selected. Reflects the handler at render time only.
        status: Availability status from the catalogue.
        test_id: Stable, deterministic selector
            (``scan-option-<slot>``) used by E2E tests and a11y tools.
    """

    id: ScanOptionId
    slot: int
    label: str
    is_main: bool
    is_placeholder: bool
    is_selected: bool
    status: ScanOptionStatus
    test_id: str


@dataclass(frozen=True)
class ScanOptionsView:
    """Top-level Step-6 view-model.

    ``options`` is always length 3, in slot order 1 → 2 → 3. ``main_option``
    is a convenience alias for the entry with ``is_main is True`` (i.e.
    퍼스널 컬러 진단). Callers should treat the tuple as immutable; the
    dataclass is frozen and the inner items are frozen too.

    Attributes:
        step_id: Always ``"scan_option_select"`` — pins the funnel step.
        step_number: Always 6.
        option_count: Always equal to ``SCAN_OPTION_COUNT`` (3). Surfaced
            so UI code can branch on a single source instead of importing
            the constant.
        options: 3-tuple of ``ScanOptionItemView``, in slot order.
        main_option: The single main entry (perfect convenience for the
            "primary CTA" rendering path).
        selected_id: The handler's current selection, or ``None``. Mirrored
            from ``handler.get_selected().id`` at render time.
        has_selection: ``True`` iff ``selected_id is not None``. Convenient
            for the "enable 다음 button?" branch.
    """

    step_id: str
    step_number: int
    option_count: int
    options: tuple[ScanOptionItemView, ...]
    main_option: ScanOptionItemView
    selected_id: Optional[ScanOptionId]
    has_selection: bool


# ---------------------------------------------------------------------------
# Internal builders
# ---------------------------------------------------------------------------


def _build_item(
    option: ScanOption,
    selected_id: Optional[ScanOptionId],
) -> ScanOptionItemView:
    """Materialise a single ``ScanOptionItemView`` from a catalogue entry."""
    return ScanOptionItemView(
        id=option.id,
        slot=option.slot,
        label=option.display_label_ko,
        is_main=option.role is ScanOptionRole.MAIN,
        is_placeholder=option.placeholder,
        is_selected=(selected_id is option.id),
        status=option.status,
        test_id=f"scan-option-{option.slot}",
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def render_scan_options(handler: ScanOptionHandler) -> ScanOptionsView:
    """Return the Step-6 view-model reflecting the handler's selection.

    The renderer is a pure read-only function — it never mutates the
    handler or the catalogue. Calling it twice in a row with the same
    handler state produces field-equal view-models, but *not* the same
    instance (so callers can hold prior snapshots for diffing).

    Args:
        handler: The selection-state handler for the current user session.
            ``handler.get_selected()`` is consulted exactly once.

    Returns:
        A frozen ``ScanOptionsView`` with 3 frozen items in slot order.

    Raises:
        RuntimeError: if the catalogue is malformed and contains no main
            entry. This is a defence-in-depth check; the catalogue's
            import-time ``validate_catalogue()`` should already have
            crashed loud on a broken catalogue.
    """
    selected = handler.get_selected()
    selected_id = selected.id if selected is not None else None

    items = tuple(
        _build_item(option, selected_id) for option in get_available_options()
    )

    main_option: Optional[ScanOptionItemView] = next(
        (it for it in items if it.is_main), None
    )
    if main_option is None:
        # Defence-in-depth — validate_catalogue() should never let this happen.
        raise RuntimeError(
            "rendered view-model has no main scan option — Seed violation; "
            f"expected id {MAIN_SCAN_ID.value!r} at slot 1",
        )

    return ScanOptionsView(
        step_id="scan_option_select",
        step_number=6,
        option_count=SCAN_OPTION_COUNT,
        options=items,
        main_option=main_option,
        selected_id=selected_id,
        has_selection=selected_id is not None,
    )
