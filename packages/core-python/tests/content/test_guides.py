"""Unit tests for the prebuilt guide library.

Sub-AC 11.1: 4 퍼스널 컬러 × 4 카테고리 = 총 16 guides, with a typed
data structure and loader functions.

Test taxonomy:
  - **Cardinality** — exhaustive 16-entry catalogue, 4 per season, 4 per
    category. These are the headline acceptance criteria.
  - **Uniqueness** — every (season, category) pair appears exactly once.
  - **Loader semantics** — `load_all_guides`, `load_guides_for_season`,
    `load_guide` return expected slices in canonical order.
  - **Content sanity** — non-empty title/summary/body, palette hex
    validity, Korean characters present (so the catalogue cannot
    accidentally regress to placeholder English).
  - **Immutability** — Guide is frozen, palette is a tuple, loader
    return values are tuples.
  - **Input-validation** — wrong-type arguments raise TypeError; missing
    pairs raise KeyError.

Marker: every test in this module is `@pytest.mark.unit` — the module is
pure data + pure-Python loaders, no I/O or fixture surface.
"""

from __future__ import annotations

import dataclasses

import pytest

from content.guides import (
    Guide,
    GuideCategory,
    guide_count_by_category,
    guide_count_by_season,
    load_all_guides,
    load_guide,
    load_guides_for_season,
)
from personal_color.season_classifier import Season

# ---------------------------------------------------------------------------
# Cardinality — the AC headline invariants
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_catalogue_has_exactly_16_guides() -> None:
    """The prebuilt catalogue must hold 4 seasons × 4 categories = 16."""
    assert len(load_all_guides()) == 16


@pytest.mark.unit
@pytest.mark.parametrize("season", list(Season))
def test_each_season_has_exactly_four_guides(season: Season) -> None:
    """Every Season must hold 4 guides, one per category."""
    guides = load_guides_for_season(season)
    assert len(guides) == 4
    # Sanity: they all belong to the requested season.
    assert {g.season for g in guides} == {season}


@pytest.mark.unit
@pytest.mark.parametrize("category", list(GuideCategory))
def test_each_category_has_exactly_four_guides(
    category: GuideCategory,
) -> None:
    """Every GuideCategory must appear exactly 4 times — one per season."""
    matches = [g for g in load_all_guides() if g.category is category]
    assert len(matches) == 4
    assert {g.season for g in matches} == set(Season)


@pytest.mark.unit
def test_guide_count_by_category_histogram() -> None:
    counts = guide_count_by_category()
    assert counts == {c: 4 for c in GuideCategory}


@pytest.mark.unit
def test_guide_count_by_season_histogram() -> None:
    counts = guide_count_by_season()
    assert counts == {s: 4 for s in Season}


# ---------------------------------------------------------------------------
# Uniqueness — every (season, category) pair appears exactly once
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_every_season_category_pair_is_unique() -> None:
    """16 entries must cover the 4x4 product table exactly once each."""
    seen: set[tuple[Season, GuideCategory]] = set()
    for guide in load_all_guides():
        key = (guide.season, guide.category)
        assert key not in seen, f"duplicate guide for {key}"
        seen.add(key)
    expected = {(s, c) for s in Season for c in GuideCategory}
    assert seen == expected


# ---------------------------------------------------------------------------
# Loader API semantics
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_load_all_guides_returns_tuple() -> None:
    """Loader must return an immutable tuple, not a list."""
    result = load_all_guides()
    assert isinstance(result, tuple)


@pytest.mark.unit
def test_load_guides_for_season_returns_canonical_category_order() -> None:
    """Per-season slice must be in declaration order of GuideCategory."""
    guides = load_guides_for_season(Season.SPRING)
    assert [g.category for g in guides] == list(GuideCategory)


@pytest.mark.unit
@pytest.mark.parametrize("season", list(Season))
@pytest.mark.parametrize("category", list(GuideCategory))
def test_load_guide_returns_matching_pair(
    season: Season,
    category: GuideCategory,
) -> None:
    """`load_guide` must return the single Guide for any valid pair."""
    guide = load_guide(season, category)
    assert isinstance(guide, Guide)
    assert guide.season is season
    assert guide.category is category


@pytest.mark.unit
def test_load_guide_rejects_non_season_argument() -> None:
    with pytest.raises(TypeError, match="season must be a Season enum"):
        load_guide("spring", GuideCategory.MAKEUP)  # type: ignore[arg-type]


@pytest.mark.unit
def test_load_guide_rejects_non_category_argument() -> None:
    with pytest.raises(TypeError, match="category must be a GuideCategory"):
        load_guide(Season.SPRING, "makeup")  # type: ignore[arg-type]


@pytest.mark.unit
def test_load_guides_for_season_rejects_non_season_argument() -> None:
    with pytest.raises(TypeError, match="season must be a Season enum"):
        load_guides_for_season("spring")  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# Content sanity — Korean copy is part of the contract
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_every_guide_has_non_empty_title_summary_body() -> None:
    for guide in load_all_guides():
        assert guide.title.strip(), f"empty title on {guide}"
        assert guide.summary.strip(), f"empty summary on {guide}"
        assert guide.body.strip(), f"empty body on {guide}"


@pytest.mark.unit
def test_every_guide_title_contains_hangul() -> None:
    """Voice-first Korean copy — no placeholder English titles."""
    for guide in load_all_guides():
        assert _contains_hangul(guide.title), (
            f"title without hangul on {guide.season.name}/"
            f"{guide.category.name}: {guide.title!r}"
        )


@pytest.mark.unit
def test_every_guide_body_contains_hangul() -> None:
    for guide in load_all_guides():
        assert _contains_hangul(guide.body), (
            f"body without hangul on {guide.season.name}/" f"{guide.category.name}"
        )


@pytest.mark.unit
def test_palette_entries_are_valid_hex_colors() -> None:
    """If a palette is present it must be `#RRGGBB` strings only."""
    for guide in load_all_guides():
        for hex_code in guide.palette:
            assert isinstance(hex_code, str), f"palette entry not str: {hex_code!r}"
            assert (
                hex_code.startswith("#") and len(hex_code) == 7
            ), f"palette entry malformed: {hex_code!r}"
            int(hex_code[1:], 16)  # raises ValueError if not hex


# ---------------------------------------------------------------------------
# Immutability — Guide is a frozen dataclass; palette stays hashable
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_guide_is_frozen_dataclass() -> None:
    """Mutation must raise FrozenInstanceError, never silently succeed."""
    guide = load_all_guides()[0]
    with pytest.raises(dataclasses.FrozenInstanceError):
        guide.title = "edited"  # type: ignore[misc]


@pytest.mark.unit
def test_palette_is_tuple_not_list() -> None:
    """Tuples are hashable; list palettes would break analytics keys."""
    for guide in load_all_guides():
        assert isinstance(guide.palette, tuple)


@pytest.mark.unit
def test_guide_is_hashable() -> None:
    """Frozen + tuple palette → hashable; usable as a dict key in analytics."""
    guides = load_all_guides()
    # Putting all 16 into a set must not raise and must keep all 16.
    assert len({hash(g) for g in guides}) == 16


# ---------------------------------------------------------------------------
# Guide constructor validation — defends against future content rewrites
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_guide_constructor_rejects_empty_title() -> None:
    with pytest.raises(ValueError, match="title must be a non-empty string"):
        Guide(
            season=Season.SPRING,
            category=GuideCategory.MAKEUP,
            title="",
            summary="ok",
            body="ok",
        )


@pytest.mark.unit
def test_guide_constructor_rejects_wrong_season_type() -> None:
    with pytest.raises(TypeError, match="season must be a Season enum"):
        Guide(
            season="spring",  # type: ignore[arg-type]
            category=GuideCategory.MAKEUP,
            title="t",
            summary="s",
            body="b",
        )


@pytest.mark.unit
def test_guide_constructor_rejects_wrong_category_type() -> None:
    with pytest.raises(TypeError, match="category must be a GuideCategory"):
        Guide(
            season=Season.SPRING,
            category="makeup",  # type: ignore[arg-type]
            title="t",
            summary="s",
            body="b",
        )


@pytest.mark.unit
def test_guide_constructor_rejects_invalid_palette_hex() -> None:
    with pytest.raises(ValueError, match="palette entry"):
        Guide(
            season=Season.SPRING,
            category=GuideCategory.MAKEUP,
            title="t",
            summary="s",
            body="b",
            palette=("not-a-hex",),
        )


@pytest.mark.unit
def test_guide_category_enum_metadata_is_korean() -> None:
    """Display labels must be Korean (renders directly on the grid)."""
    assert GuideCategory.MAKEUP.label == "메이크업"
    assert GuideCategory.OUTFIT.label == "코디"
    assert GuideCategory.HAIR.label == "헤어"
    assert GuideCategory.ACCESSORY.label == "액세서리"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _contains_hangul(text: str) -> bool:
    """Return True iff `text` contains at least one Hangul syllable.

    The Hangul Syllables block is U+AC00..U+D7A3 (44032..55203). That's
    a tighter check than "any CJK"; we don't want titles to satisfy the
    contract with stray Chinese/Japanese characters.
    """
    return any(0xAC00 <= ord(ch) <= 0xD7A3 for ch in text)
