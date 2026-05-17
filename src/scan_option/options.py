"""ScanOption catalogue (Sub-AC 5.1) — Python mirror of `catalogue.ts`.

Ontology concept (Seed): ``scan_option`` — Step 6 (`scan_option_select`) of
the 12-step funnel renders exactly 3 scan-option CTAs. The catalogue is the
single source of truth for *which* 3 options exist, in which slot order,
with which Korean label, and at which availability status.

Why this Python module exists alongside ``src/scan_option/catalogue.ts``:

    - The funnel UI (Step 6 renderer) reads the TS catalogue.
    - The diagnosis orchestrator (`src/personal_color/diagnosis_orchestrator.py`)
      is Python; it needs the main-scan id ("personal_color") and its Korean
      display label to attach to diagnosis results without crossing a
      language boundary or shelling out to JS.
    - Keeping a *parallel* Python catalogue with identical ids/slots/roles
      means both runtimes agree on the canonical 3 options. Drift is caught
      by ``validate_catalogue`` (invariants identical to ``schema.ts``).

Seed constraints honoured here (mirror the TS comments):

    - 퍼스널 컬러 진단 = hook only ⇒ exactly one ``main`` role, and it must
      be the ``personal_color`` scan in slot 1.
    - AR 메이크업 try-on 보류 ⇒ no placeholder may claim an AR-makeup id.
    - The catalogue is fixed at 3 options. Never 2, never 4.

Immutability:

    - ``ScanOption`` is a ``@dataclass(frozen=True)`` — once constructed,
      attributes cannot be reassigned. The Seed bans mutation of these
      records.
    - The module-level catalogue is a ``tuple[...]`` (immutable sequence)
      assembled once at import time. ``get_available_options()`` returns the
      same tuple object on every call (no allocation, no copy).
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Final


# ---------------------------------------------------------------------------
# Enumerations — mirror the TS string literal unions in `types.ts`
# ---------------------------------------------------------------------------


class ScanOptionId(str, Enum):
    """Stable identifier for each of the 3 scan options.

    Mirrors ``ScanOptionId`` in ``src/scan_option/types.ts``.

    ``PERSONAL_COLOR`` is the canonical entry hook and must occupy the main
    slot. ``SCAN_SLOT_2`` / ``SCAN_SLOT_3`` are deliberately generic
    placeholders (post-seed/build-phase decision).
    """

    PERSONAL_COLOR = "personal_color"
    SCAN_SLOT_2 = "scan_slot_2"
    SCAN_SLOT_3 = "scan_slot_3"


class ScanOptionRole(str, Enum):
    """Role of a scan option in the catalogue.

    ``MAIN``      — primary CTA on Step 6, drives the whole 12-step funnel.
    ``SECONDARY`` — placeholder slot reserved for Phase-N expansion.
    """

    MAIN = "main"
    SECONDARY = "secondary"


class ScanOptionStatus(str, Enum):
    """Availability status of a scan option.

    ``AVAILABLE``   — fully built, usable today.
    ``PHASE_N_TBD`` — placeholder, decision deferred to a later phase.
    """

    AVAILABLE = "available"
    PHASE_N_TBD = "phase_n_tbd"


# ---------------------------------------------------------------------------
# Compile-time constants
# ---------------------------------------------------------------------------


#: Fixed total option count for Step 6 — never 2 or 4, always 3.
SCAN_OPTION_COUNT: Final[int] = 3

#: Allowed slot indices, in canonical CTA-render order (slot 1 → 2 → 3).
SCAN_OPTION_SLOTS: Final[tuple[int, ...]] = (1, 2, 3)

#: The single canonical main-scan id (Seed: 퍼스널 컬러 진단 = hook only).
MAIN_SCAN_ID: Final[ScanOptionId] = ScanOptionId.PERSONAL_COLOR


# ---------------------------------------------------------------------------
# ScanOption record
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ScanOption:
    """One scan option entry — frozen, immutable.

    Field invariants (validated by ``validate_catalogue``):

        - ``id == ScanOptionId.PERSONAL_COLOR``  ⇒
            ``role == MAIN``, ``slot == 1``, ``status == AVAILABLE``,
            ``placeholder is False``.
        - ``id != ScanOptionId.PERSONAL_COLOR``  ⇒
            ``role == SECONDARY``, ``slot in {2, 3}``,
            ``status == PHASE_N_TBD``, ``placeholder is True``.
        - ``display_label_ko`` is non-empty and contains at least one
          Hangul codepoint (U+AC00..U+D7A3).

    Attributes:
        id: Stable identifier for this scan option.
        role: Whether this is the main hook or a secondary placeholder.
        slot: Visual ordering on Step 6 (1, 2, or 3).
        status: Availability flag — drives the "곧 오픈" badge on
            placeholders.
        display_label_ko: User-facing Korean CTA label.
        placeholder: Convenience flag mirrored from ``status`` for fast
            UI branching ("show coming-soon ribbon?"). Must be ``True`` iff
            ``status == PHASE_N_TBD``.
    """

    id: ScanOptionId
    role: ScanOptionRole
    slot: int
    status: ScanOptionStatus
    display_label_ko: str
    placeholder: bool


# ---------------------------------------------------------------------------
# Catalogue assembly
# ---------------------------------------------------------------------------


# Korean labels match catalogue.ts so the funnel UI (TS) and the diagnosis
# orchestrator (Python) attach the *same* user-facing string to the same
# scan option. If you edit a label here, edit catalogue.ts in lock-step.
_SCAN_OPTION_CATALOGUE: Final[tuple[ScanOption, ...]] = (
    ScanOption(
        id=ScanOptionId.PERSONAL_COLOR,
        role=ScanOptionRole.MAIN,
        slot=1,
        status=ScanOptionStatus.AVAILABLE,
        display_label_ko="퍼스널 컬러 진단",
        placeholder=False,
    ),
    ScanOption(
        id=ScanOptionId.SCAN_SLOT_2,
        role=ScanOptionRole.SECONDARY,
        slot=2,
        status=ScanOptionStatus.PHASE_N_TBD,
        display_label_ko="두번째 스캔 (곧 오픈)",
        placeholder=True,
    ),
    ScanOption(
        id=ScanOptionId.SCAN_SLOT_3,
        role=ScanOptionRole.SECONDARY,
        slot=3,
        status=ScanOptionStatus.PHASE_N_TBD,
        display_label_ko="세번째 스캔 (곧 오픈)",
        placeholder=True,
    ),
)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def get_available_options() -> tuple[ScanOption, ...]:
    """Return the canonical 3-option scan catalogue, in slot order.

    "Available" here means "presented to the user on Step 6" — that is, the
    full catalogue. The per-option ``status`` field distinguishes options
    that are *usable today* (``AVAILABLE``) from those that render as
    "곧 오픈" placeholders (``PHASE_N_TBD``); UI code can filter on
    ``status`` when it needs to.

    The returned tuple is the module-level singleton — identical (``is``)
    on every call. Callers must not attempt to mutate it; tuples are
    immutable and ``ScanOption`` is frozen.

    Returns:
        A 3-element tuple of ``ScanOption`` in slot order (1, 2, 3).
    """
    return _SCAN_OPTION_CATALOGUE


def get_main_scan_option() -> ScanOption:
    """Return the single main scan option (퍼스널 컬러 진단).

    Raises:
        RuntimeError: if the catalogue is malformed and contains no ``MAIN``
            entry. This is a Seed-violation that should never survive code
            review; the check is defence-in-depth.
    """
    for option in _SCAN_OPTION_CATALOGUE:
        if option.role is ScanOptionRole.MAIN:
            return option
    raise RuntimeError(
        "SCAN_OPTION catalogue is missing a MAIN entry — Seed violation.",
    )


def get_secondary_scan_options() -> tuple[ScanOption, ...]:
    """Return the secondary (placeholder) scan options, in slot order."""
    return tuple(
        opt for opt in _SCAN_OPTION_CATALOGUE if opt.role is ScanOptionRole.SECONDARY
    )


# ---------------------------------------------------------------------------
# Catalogue validator — invariants mirror `schema.ts`
# ---------------------------------------------------------------------------


def _contains_hangul(text: str) -> bool:
    """True if ``text`` contains at least one Hangul syllable (U+AC00..U+D7A3)."""
    return any("가" <= ch <= "힣" for ch in text)


def validate_catalogue(
    catalogue: tuple[ScanOption, ...] = _SCAN_OPTION_CATALOGUE,
) -> None:
    """Validate the catalogue against the Seed-level invariants.

    Defaults to the module-level catalogue, but accepts an override so test
    fixtures can construct deliberately-broken catalogues and assert that
    the validator rejects them.

    Raises:
        ValueError: if any invariant is violated.
    """
    if len(catalogue) != SCAN_OPTION_COUNT:
        raise ValueError(
            f"catalogue must contain exactly {SCAN_OPTION_COUNT} options, "
            f"got {len(catalogue)}",
        )

    # Slots must be {1, 2, 3} each exactly once.
    slots = sorted(opt.slot for opt in catalogue)
    if slots != list(SCAN_OPTION_SLOTS):
        raise ValueError(
            f"slot indices must be {list(SCAN_OPTION_SLOTS)} (each once), "
            f"got {slots}",
        )

    # IDs must be unique.
    ids = [opt.id for opt in catalogue]
    if len(set(ids)) != len(ids):
        raise ValueError(f"scan option ids must be unique, got {ids}")

    # Exactly one MAIN role; it must be PERSONAL_COLOR in slot 1.
    main_options = [opt for opt in catalogue if opt.role is ScanOptionRole.MAIN]
    if len(main_options) != 1:
        raise ValueError(
            f"catalogue must contain exactly one MAIN option, got {len(main_options)}",
        )
    main = main_options[0]
    if main.id is not ScanOptionId.PERSONAL_COLOR:
        raise ValueError(
            "MAIN scan option must be PERSONAL_COLOR (Seed: 퍼스널 컬러 진단 = hook only)",
        )
    if main.slot != 1:
        raise ValueError(
            f"MAIN scan option must occupy slot 1, got slot {main.slot}",
        )
    if main.status is not ScanOptionStatus.AVAILABLE:
        raise ValueError(
            f"MAIN scan option must have status AVAILABLE, got {main.status}",
        )
    if main.placeholder:
        raise ValueError("MAIN scan option must not be a placeholder")

    # Per-option invariants for every entry.
    for opt in catalogue:
        if opt.slot not in SCAN_OPTION_SLOTS:
            raise ValueError(
                f"option {opt.id.value!r} has invalid slot {opt.slot}; "
                f"must be one of {list(SCAN_OPTION_SLOTS)}",
            )
        if not opt.display_label_ko.strip():
            raise ValueError(
                f"option {opt.id.value!r} has empty display_label_ko",
            )
        if not _contains_hangul(opt.display_label_ko):
            raise ValueError(
                f"option {opt.id.value!r} display_label_ko must contain "
                f"at least one Hangul codepoint",
            )
        # status/placeholder coherence
        expected_placeholder = opt.status is ScanOptionStatus.PHASE_N_TBD
        if opt.placeholder is not expected_placeholder:
            raise ValueError(
                f"option {opt.id.value!r} placeholder flag {opt.placeholder} "
                f"does not match status {opt.status}",
            )
        # secondary-role invariants
        if opt.role is ScanOptionRole.SECONDARY:
            if opt.id is ScanOptionId.PERSONAL_COLOR:
                raise ValueError(
                    "PERSONAL_COLOR cannot occupy a SECONDARY slot",
                )
            if opt.slot == 1:
                raise ValueError(
                    f"SECONDARY option {opt.id.value!r} cannot occupy slot 1",
                )
            if opt.status is not ScanOptionStatus.PHASE_N_TBD:
                raise ValueError(
                    f"SECONDARY option {opt.id.value!r} must have status "
                    f"PHASE_N_TBD, got {opt.status}",
                )


# Validate the canonical catalogue at import time. A broken catalogue is a
# Seed-violation that should fail loud and immediately, not silently
# percolate through to the funnel UI or the diagnosis orchestrator.
validate_catalogue()
