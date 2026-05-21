"""Unit tests for the Season ↔ preset string bijection (AC 2).

The :func:`season_to_preset` helper is the single point of language
crossing between the Phase 0.x diagnosis pipeline (which thinks in
:class:`Season` enum members) and the Phase 3.1 Fal.ai vendor caller
(which thinks in preset strings consumed by ``_PRESET_TO_PROMPT``).

These tests pin the Seed Contract invariant:

    set(_SEASON_TO_PRESET.values()) == set(_PRESET_TO_PROMPT.keys())

i.e. the four ``Season`` members map one-to-one onto the four preset
strings, with zero drift permitted. The tests are pure stdlib — no
Pillow, no MediaPipe, no native deps — so they run in the Phase 0.x
base CI lane without integration markers.

Coverage:

  1. Each of the four ``Season`` members maps to the exact preset
     string the Seed Contract specifies (SPRING → "spring-warm",
     SUMMER → "summer-cool", AUTUMN → "autumn-warm",
     WINTER → "winter-cool").
  2. The mapping is total: every ``Season`` member produces a string
     (no ``KeyError``, no ``None``).
  3. The mapping is injective: no two seasons share a preset string.
  4. The mapping's value set equals ``_PRESET_TO_PROMPT.keys()`` —
     bijection enforced against the downstream Phase 3.1 contract.
  5. Non-``Season`` input raises ``TypeError`` (not a silent fallback).
"""

from __future__ import annotations

import pytest

from image_edit.fal_ai_vendor_caller import _PRESET_TO_PROMPT
from personal_color.preset_mapping import season_to_preset
from personal_color.season_classifier import Season

# ---------------------------------------------------------------------------
# AC 2 — the exact four pairs the Seed Contract requires.
# ---------------------------------------------------------------------------
#
# This table is duplicated from ``preset_mapping._SEASON_TO_PRESET`` on
# purpose — the duplication is the test. If anyone edits the production
# mapping, the parametrized assertion below catches the drift, and if
# anyone edits the test table to "match" a wrong production value the
# bijection / set-equality tests further down still catch it.
_EXPECTED_PAIRS: tuple[tuple[Season, str], ...] = (
    (Season.SPRING, "spring-warm"),
    (Season.SUMMER, "summer-cool"),
    (Season.AUTUMN, "autumn-warm"),
    (Season.WINTER, "winter-cool"),
)


@pytest.mark.parametrize("season,expected_preset", _EXPECTED_PAIRS)
def test_season_to_preset_maps_each_season_to_exact_string(
    season: Season,
    expected_preset: str,
) -> None:
    """Each of the 4 Season members yields the Seed-Contract preset string."""

    assert season_to_preset(season) == expected_preset


def test_season_to_preset_is_total_over_season_enum() -> None:
    """Every Season member produces a non-empty string — no gaps."""

    for season in Season:
        result = season_to_preset(season)
        assert isinstance(result, str)
        assert result, f"Season.{season.name} mapped to empty string"


def test_season_to_preset_is_injective() -> None:
    """No two distinct Season members share a preset string."""

    preset_strings = [season_to_preset(season) for season in Season]
    assert len(preset_strings) == len(set(preset_strings)), (
        "season_to_preset must be injective — every season maps to a "
        "distinct preset string"
    )


def test_season_to_preset_bijection_against_phase_3_1_prompt_keys() -> None:
    """Bijection invariant: the four mapped values equal the four
    ``_PRESET_TO_PROMPT`` keys, as a *set*.

    This is the single drift-0 guard the Seed Contract requires. Adding
    a new ``Season`` member without extending ``_PRESET_TO_PROMPT`` (or
    vice versa) makes this test fail loudly.
    """

    mapped_presets = {season_to_preset(season) for season in Season}
    prompt_keys = set(_PRESET_TO_PROMPT.keys())

    assert mapped_presets == prompt_keys, (
        "Season ↔ _PRESET_TO_PROMPT bijection drifted: "
        f"season_to_preset values={sorted(mapped_presets)} vs "
        f"_PRESET_TO_PROMPT keys={sorted(prompt_keys)}"
    )


def test_season_to_preset_covers_all_four_seasons() -> None:
    """Cardinality sanity check — exactly 4 seasons, 4 preset strings."""

    assert len(list(Season)) == 4
    assert len({season_to_preset(season) for season in Season}) == 4
    assert len(_PRESET_TO_PROMPT) == 4


def test_season_to_preset_rejects_non_season_input() -> None:
    """Type guard — a non-Season argument raises ``TypeError``.

    The helper is typed as ``(Season) -> PresetString``, but at the
    untyped HTTP/JSON boundary a stray string can sneak in. We want a
    loud ``TypeError`` rather than a silent ``KeyError`` so the
    Phase 4 server can map the failure to a 400.
    """

    with pytest.raises(TypeError):
        season_to_preset("spring")  # type: ignore[arg-type]

    with pytest.raises(TypeError):
        season_to_preset(None)  # type: ignore[arg-type]

    with pytest.raises(TypeError):
        season_to_preset(0)  # type: ignore[arg-type]
