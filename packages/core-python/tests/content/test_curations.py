"""Unit tests for the prebuilt first-curation catalogue (Sub-AC 3.1).

The first-curation catalogue is the 4-package post-payment welcome
surface — one package keyed to each Korean personal-color season
(봄·여름·가을·겨울). These tests cover the AC headline guarantees:

  - **All 4 colors present.** Exactly one package per Season, every
    season covered, no duplicates.
  - **Required fields populated.** `headline`, `editor_signature`,
    `mood_keywords`, `cover_palette`, and 4 items present and non-empty,
    with Korean copy (rejects placeholder English regressions).
  - **Lookup function semantics.** `get_curation_by_color(color)` works
    for the `Season` enum, the lowercase slug, and the Korean label,
    and raises sensibly on garbage input.
  - **Item invariants.** Each package holds 4 items spanning all 4
    `CurationItemKind`s and mixing all 4 `WordingTone`s (the Seed's
    "wording 톤 혼합" guarantee).
  - **Immutability.** Frozen dataclasses, tuple collections — funnel
    analytics needs hashable, non-mutable content.

Marker: every test is `@pytest.mark.unit` — pure data, no I/O.
"""

from __future__ import annotations

import dataclasses

import pytest

from content.curations import (
    CurationItem,
    CurationItemKind,
    FirstCuration,
    WordingTone,
    first_curation_count_by_season,
    get_curation_by_color,
    load_all_first_curations,
    load_first_curation_for_season,
)
from personal_color.season_classifier import Season


# ---------------------------------------------------------------------------
# All 4 colors present — the AC headline invariant
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_catalogue_has_exactly_four_packages() -> None:
    """The catalogue must hold exactly 4 packages — one per Season."""
    assert len(load_all_first_curations()) == 4


@pytest.mark.unit
def test_every_season_has_exactly_one_package() -> None:
    """Every Season member must appear in the catalogue exactly once."""
    seasons = [c.season for c in load_all_first_curations()]
    assert sorted(s.name for s in seasons) == sorted(s.name for s in Season)
    assert len(set(seasons)) == 4  # no duplicates


@pytest.mark.unit
def test_first_curation_count_by_season_histogram() -> None:
    """`first_curation_count_by_season` must report 1 per season."""
    counts = first_curation_count_by_season()
    assert counts == {s: 1 for s in Season}


@pytest.mark.unit
def test_canonical_season_order() -> None:
    """Order is canonical: 봄 → 여름 → 가을 → 겨울."""
    seasons = [c.season for c in load_all_first_curations()]
    assert seasons == [Season.SPRING, Season.SUMMER, Season.AUTUMN, Season.WINTER]


# ---------------------------------------------------------------------------
# Required field validation — Korean signature copy is part of the contract
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_every_package_has_non_empty_headline_and_signature() -> None:
    for curation in load_all_first_curations():
        assert curation.headline.strip(), f"empty headline on {curation.season}"
        assert curation.editor_signature.strip(), (
            f"empty editor_signature on {curation.season}"
        )


@pytest.mark.unit
def test_every_package_headline_contains_hangul() -> None:
    """No placeholder English headlines — creator-signature voice required."""
    for curation in load_all_first_curations():
        assert _contains_hangul(curation.headline), (
            f"headline without hangul on {curation.season.name}: "
            f"{curation.headline!r}"
        )


@pytest.mark.unit
def test_every_package_editor_signature_contains_hangul() -> None:
    for curation in load_all_first_curations():
        assert _contains_hangul(curation.editor_signature), (
            f"editor_signature without hangul on {curation.season.name}"
        )


@pytest.mark.unit
def test_every_package_has_at_least_one_mood_keyword() -> None:
    for curation in load_all_first_curations():
        assert len(curation.mood_keywords) >= 1
        for keyword in curation.mood_keywords:
            assert isinstance(keyword, str)
            assert keyword.strip(), (
                f"empty mood keyword on {curation.season.name}"
            )


@pytest.mark.unit
def test_every_package_has_non_empty_cover_palette_with_valid_hex() -> None:
    for curation in load_all_first_curations():
        assert len(curation.cover_palette) >= 1
        for hex_code in curation.cover_palette:
            assert isinstance(hex_code, str)
            assert hex_code.startswith("#") and len(hex_code) == 7
            int(hex_code[1:], 16)  # raises ValueError if not valid hex


# ---------------------------------------------------------------------------
# Item invariants — 4 items × 4 kinds × 4 tones, all mixed
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_every_package_has_exactly_four_items() -> None:
    for curation in load_all_first_curations():
        assert len(curation.items) == 4, (
            f"{curation.season.name} package must have 4 items"
        )


@pytest.mark.unit
def test_every_package_spans_all_curation_item_kinds() -> None:
    for curation in load_all_first_curations():
        kinds = {item.kind for item in curation.items}
        assert kinds == set(CurationItemKind), (
            f"{curation.season.name} missing kinds: "
            f"{set(CurationItemKind) - kinds}"
        )


@pytest.mark.unit
def test_every_package_mixes_all_wording_tones() -> None:
    """Seed contract: 4종 — wording 톤 혼합. Every tone present once."""
    for curation in load_all_first_curations():
        tones = {item.tone for item in curation.items}
        assert tones == set(WordingTone), (
            f"{curation.season.name} missing tones: "
            f"{set(WordingTone) - tones}"
        )


@pytest.mark.unit
def test_every_item_has_non_empty_title_and_blurb() -> None:
    for curation in load_all_first_curations():
        for item in curation.items:
            assert item.title.strip(), (
                f"empty title on {curation.season.name}/{item.kind.name}"
            )
            assert item.blurb.strip(), (
                f"empty blurb on {curation.season.name}/{item.kind.name}"
            )


@pytest.mark.unit
def test_every_item_title_contains_hangul() -> None:
    for curation in load_all_first_curations():
        for item in curation.items:
            assert _contains_hangul(item.title), (
                f"item title without hangul: {curation.season.name}/"
                f"{item.kind.name}: {item.title!r}"
            )


@pytest.mark.unit
def test_every_item_blurb_contains_hangul() -> None:
    for curation in load_all_first_curations():
        for item in curation.items:
            assert _contains_hangul(item.blurb), (
                f"item blurb without hangul: {curation.season.name}/"
                f"{item.kind.name}"
            )


# ---------------------------------------------------------------------------
# Lookup API — get_curation_by_color (the AC-named function)
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize("season", list(Season))
def test_get_curation_by_color_accepts_season_enum(season: Season) -> None:
    curation = get_curation_by_color(season)
    assert isinstance(curation, FirstCuration)
    assert curation.season is season


@pytest.mark.unit
@pytest.mark.parametrize(
    "slug,expected",
    [
        ("spring", Season.SPRING),
        ("summer", Season.SUMMER),
        ("autumn", Season.AUTUMN),
        ("winter", Season.WINTER),
    ],
)
def test_get_curation_by_color_accepts_english_slug(
    slug: str, expected: Season,
) -> None:
    curation = get_curation_by_color(slug)
    assert curation.season is expected


@pytest.mark.unit
@pytest.mark.parametrize(
    "slug,expected",
    [
        ("SPRING", Season.SPRING),
        ("Summer", Season.SUMMER),
        ("  autumn  ", Season.AUTUMN),
    ],
)
def test_get_curation_by_color_slug_is_case_and_whitespace_tolerant(
    slug: str, expected: Season,
) -> None:
    assert get_curation_by_color(slug).season is expected


@pytest.mark.unit
@pytest.mark.parametrize(
    "label,expected",
    [
        ("봄", Season.SPRING),
        ("여름", Season.SUMMER),
        ("가을", Season.AUTUMN),
        ("겨울", Season.WINTER),
    ],
)
def test_get_curation_by_color_accepts_korean_label(
    label: str, expected: Season,
) -> None:
    assert get_curation_by_color(label).season is expected


@pytest.mark.unit
def test_get_curation_by_color_rejects_unknown_string() -> None:
    with pytest.raises(KeyError, match="unknown personal-color identifier"):
        get_curation_by_color("rainbow")


@pytest.mark.unit
def test_get_curation_by_color_rejects_empty_string() -> None:
    with pytest.raises(KeyError, match="empty"):
        get_curation_by_color("")


@pytest.mark.unit
def test_get_curation_by_color_rejects_non_string_non_enum() -> None:
    with pytest.raises(TypeError, match="must be a Season enum or a season name"):
        get_curation_by_color(42)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# Loader API — `load_*` functions still work after the alias addition
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_load_all_first_curations_returns_tuple() -> None:
    result = load_all_first_curations()
    assert isinstance(result, tuple)


@pytest.mark.unit
@pytest.mark.parametrize("season", list(Season))
def test_load_first_curation_for_season_returns_matching_season(
    season: Season,
) -> None:
    curation = load_first_curation_for_season(season)
    assert isinstance(curation, FirstCuration)
    assert curation.season is season


@pytest.mark.unit
def test_load_first_curation_for_season_rejects_non_season() -> None:
    with pytest.raises(TypeError, match="season must be a Season enum"):
        load_first_curation_for_season("spring")  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# Immutability — frozen dataclasses, tuple collections
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_first_curation_is_frozen_dataclass() -> None:
    curation = load_all_first_curations()[0]
    with pytest.raises(dataclasses.FrozenInstanceError):
        curation.headline = "edited"  # type: ignore[misc]


@pytest.mark.unit
def test_curation_item_is_frozen_dataclass() -> None:
    item = load_all_first_curations()[0].items[0]
    with pytest.raises(dataclasses.FrozenInstanceError):
        item.title = "edited"  # type: ignore[misc]


@pytest.mark.unit
def test_collections_are_tuples_not_lists() -> None:
    for curation in load_all_first_curations():
        assert isinstance(curation.mood_keywords, tuple)
        assert isinstance(curation.cover_palette, tuple)
        assert isinstance(curation.items, tuple)


@pytest.mark.unit
def test_first_curation_is_hashable() -> None:
    """Frozen + tuple fields → hashable; usable in analytics sets/dicts."""
    curations = load_all_first_curations()
    assert len({hash(c) for c in curations}) == 4


# ---------------------------------------------------------------------------
# Constructor validation — defends against future content rewrites
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_first_curation_rejects_wrong_item_count() -> None:
    with pytest.raises(ValueError, match="exactly 4 items"):
        FirstCuration(
            season=Season.SPRING,
            headline="h",
            editor_signature="s",
            mood_keywords=("k",),
            cover_palette=("#FFFFFF",),
            items=(),
        )


@pytest.mark.unit
def test_first_curation_rejects_duplicate_kinds() -> None:
    dup_kind_items = tuple(
        CurationItem(
            kind=CurationItemKind.MAKEUP_LOOK,
            tone=tone,
            title="t",
            blurb="b",
        )
        for tone in WordingTone
    )
    with pytest.raises(ValueError, match="every CurationItemKind"):
        FirstCuration(
            season=Season.SPRING,
            headline="h",
            editor_signature="s",
            mood_keywords=("k",),
            cover_palette=("#FFFFFF",),
            items=dup_kind_items,
        )


@pytest.mark.unit
def test_first_curation_rejects_duplicate_tones() -> None:
    dup_tone_items = tuple(
        CurationItem(
            kind=kind,
            tone=WordingTone.AFFECTIONATE,
            title="t",
            blurb="b",
        )
        for kind in CurationItemKind
    )
    with pytest.raises(ValueError, match="all 4 WordingTones"):
        FirstCuration(
            season=Season.SPRING,
            headline="h",
            editor_signature="s",
            mood_keywords=("k",),
            cover_palette=("#FFFFFF",),
            items=dup_tone_items,
        )


@pytest.mark.unit
def test_first_curation_rejects_invalid_hex_palette() -> None:
    items = tuple(
        CurationItem(kind=k, tone=t, title="t", blurb="b")
        for k, t in zip(CurationItemKind, WordingTone, strict=True)
    )
    with pytest.raises(ValueError, match="cover_palette entry"):
        FirstCuration(
            season=Season.SPRING,
            headline="h",
            editor_signature="s",
            mood_keywords=("k",),
            cover_palette=("not-a-hex",),
            items=items,
        )


@pytest.mark.unit
def test_first_curation_rejects_empty_headline() -> None:
    items = tuple(
        CurationItem(kind=k, tone=t, title="t", blurb="b")
        for k, t in zip(CurationItemKind, WordingTone, strict=True)
    )
    with pytest.raises(ValueError, match="headline must be a non-empty string"):
        FirstCuration(
            season=Season.SPRING,
            headline="",
            editor_signature="s",
            mood_keywords=("k",),
            cover_palette=("#FFFFFF",),
            items=items,
        )


@pytest.mark.unit
def test_curation_item_rejects_wrong_kind_type() -> None:
    with pytest.raises(TypeError, match="kind must be a CurationItemKind"):
        CurationItem(
            kind="makeup_look",  # type: ignore[arg-type]
            tone=WordingTone.AFFECTIONATE,
            title="t",
            blurb="b",
        )


@pytest.mark.unit
def test_curation_item_rejects_wrong_tone_type() -> None:
    with pytest.raises(TypeError, match="tone must be a WordingTone"):
        CurationItem(
            kind=CurationItemKind.MAKEUP_LOOK,
            tone="affectionate",  # type: ignore[arg-type]
            title="t",
            blurb="b",
        )


# ---------------------------------------------------------------------------
# Enum metadata — Korean labels render directly on the unlock screen
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_curation_item_kind_labels_are_korean() -> None:
    assert CurationItemKind.MAKEUP_LOOK.label == "메이크업 룩"
    assert CurationItemKind.OUTFIT_PICK.label == "코디 픽"
    assert CurationItemKind.PHOTO_SCENE.label == "촬영 씬"
    assert CurationItemKind.EDITING_PRESET.label == "편집 프리셋"


@pytest.mark.unit
def test_wording_tone_labels_are_korean() -> None:
    assert WordingTone.AFFECTIONATE.label == "다정한"
    assert WordingTone.EDITORIAL.label == "에디토리얼"
    assert WordingTone.PLAYFUL.label == "유쾌한"
    assert WordingTone.POETIC.label == "시적인"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _contains_hangul(text: str) -> bool:
    """Return True iff `text` contains at least one Hangul syllable.

    Hangul Syllables block: U+AC00..U+D7A3.
    """
    return any(0xAC00 <= ord(ch) <= 0xD7A3 for ch in text)
