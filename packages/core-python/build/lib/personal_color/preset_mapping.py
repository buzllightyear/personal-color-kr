"""Season → preset string mapping (Phase 0.x ↔ Phase 3.1 bridge).

A pure-Python lookup table that maps the 4-category :class:`Season` enum
produced by the diagnosis pipeline (Phase 0.x) to the preset string keys
consumed by :data:`image_edit.fal_ai_vendor_caller._PRESET_TO_PROMPT`
(Phase 3.1). The bijection is the single point of language crossing:
upstream code thinks in :class:`Season`, downstream code thinks in
preset strings.

Why a dedicated module:

  - Keeps Phase 0.x (diagnosis) and Phase 3.1 (image-edit vendor caller)
    independent of each other. Neither side imports the other; both
    import this thin mapping. Refactoring the season enum or renaming
    a preset prompt only touches this file.
  - The mapping is data, not control flow. Encoding the four pairs as
    a frozen ``Mapping`` lets the bijection test assert ``set equality``
    against ``_PRESET_TO_PROMPT.keys()`` and refuse to drift silently.
  - Pure stdlib — no Pillow, no MediaPipe, no network. Safe to import
    from any layer, including the cross-platform mobile bundle.

Bijection invariant (verified by ``test_preset_mapping.py``):

    set(_SEASON_TO_PRESET.values()) == set(_PRESET_TO_PROMPT.keys())

The four pairs are deliberately fixed:

  +-----------------+-------------------+
  | Season          | Preset string     |
  +-----------------+-------------------+
  | Season.SPRING   | "spring-warm"     |
  | Season.SUMMER   | "summer-cool"     |
  | Season.AUTUMN   | "autumn-warm"     |
  | Season.WINTER   | "winter-cool"     |
  +-----------------+-------------------+

These literal strings are the closed enum from Phase 3.1 — they are NOT
a guess, they MUST stay in lock-step with ``_PRESET_TO_PROMPT`` keys.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Final, Literal

from personal_color.season_classifier import Season

# ---------------------------------------------------------------------------
# Closed enum of preset strings — the Phase 3.1 contract.
# ---------------------------------------------------------------------------


PresetString = Literal[
    "spring-warm",
    "summer-cool",
    "autumn-warm",
    "winter-cool",
]


# ---------------------------------------------------------------------------
# Bijection table — single source of truth for the Season ↔ preset link.
# ---------------------------------------------------------------------------
#
# Frozen via ``Final`` + ``Mapping`` (the read-only Protocol). Same
# pattern as ``_PRESET_TO_PROMPT`` in fal_ai_vendor_caller — module-level
# binding so the dict has stable identity, ``Mapping[Season, str]``
# typing so callers cannot mutate it through the binding.
_SEASON_TO_PRESET: Final[Mapping[Season, PresetString]] = {
    Season.SPRING: "spring-warm",
    Season.SUMMER: "summer-cool",
    Season.AUTUMN: "autumn-warm",
    Season.WINTER: "winter-cool",
}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def season_to_preset(season: Season) -> PresetString:
    """Return the Phase 3.1 preset string for a diagnosed :class:`Season`.

    Pure function — no I/O, no logging, no fallback. The mapping is total
    over :class:`Season` (4 members → 4 preset strings), so the only
    way this raises is if a non-:class:`Season` argument sneaks past
    a caller's type checker.

    Args:
        season: A :class:`Season` enum member from the diagnosis pipeline.

    Returns:
        The preset string accepted by Phase 3.1's FalAi vendor caller —
        one of "spring-warm", "summer-cool", "autumn-warm", "winter-cool".

    Raises:
        TypeError: if ``season`` is not a :class:`Season` enum member.
    """
    if not isinstance(season, Season):
        raise TypeError(
            f"season must be a Season enum member, " f"got {type(season).__name__}",
        )
    # Total mapping — guaranteed hit. ``KeyError`` here would mean the
    # bijection test was disabled and a new Season member was added
    # without updating ``_SEASON_TO_PRESET``.
    return _SEASON_TO_PRESET[season]
