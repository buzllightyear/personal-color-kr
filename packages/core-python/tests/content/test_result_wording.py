"""Unit tests for the result-wording combiner (Sub-AC 6.2).

The headline contract: ``build_result_wording`` glues three pre-existing
copy surfaces — the category verdict, the per-guide detail, and the
signature curation — into a single ``ResultWording`` value object
whose combined text proves the "wording 톤 혼합" invariant on the
rendered surface itself.

Coverage:
  - Polymorphic source — accepts both ``DiagnosisResult`` and bare
    ``Season``.
  - All 4 seasons round-trip — category line, guides, curation all
    season-aligned end-to-end.
  - Tone-mix invariant — every ``WordingTone`` member appears in the
    recommendation layer exactly once, and each tone's Korean label
    appears in the rendered ``combined_text``.
  - Layer coverage in ``combined_text`` — every guide title and the
    editor signature show up in the rendered string.
  - Default loaders vs explicit overrides — both paths produce the
    same wording when given the same inputs.
  - Input validation — wrong types and cross-season mismatches raise.
  - Immutability — ``ResultWording`` is frozen.

Marker: every test is ``@pytest.mark.unit`` — pure data composition,
no I/O or fixture surface.
"""

from __future__ import annotations

import dataclasses

import pytest

from content.curations import (
    CurationItem,
    CurationItemKind,
    FirstCuration,
    WordingTone,
    load_first_curation_for_season,
)
from content.guides import (
    Guide,
    GuideCategory,
    load_guides_for_season,
)
from content.result_wording import (
    ResultWording,
    build_result_wording,
)
from personal_color.contrast_classifier import Contrast
from personal_color.diagnosis_orchestrator import DiagnosisResult
from personal_color.season_classifier import Season
from personal_color.tone_classifier import Tone

# ---------------------------------------------------------------------------
# Diagnosis fixture — minimal DiagnosisResult for tests that need one.
# Built by hand (the orchestrator's full pipeline is exercised in its own
# tests); the only fields this module reads are `season` and `confidence`.
# ---------------------------------------------------------------------------


def _diagnosis(season: Season, confidence: float = 0.84) -> DiagnosisResult:
    """Construct a minimal but contract-valid DiagnosisResult."""
    tone = Tone.WARM if season in (Season.SPRING, Season.AUTUMN) else Tone.COOL
    contrast = (
        Contrast.HIGH if season in (Season.SPRING, Season.WINTER) else Contrast.LOW
    )
    return DiagnosisResult(
        season=season,
        confidence=confidence,
        tone=tone,
        contrast=contrast,
        tone_confidence=confidence,
        contrast_confidence=confidence,
        skin_luma=0.7,
        hair_luma=0.2,
        eyes_luma=0.25,
    )


# ---------------------------------------------------------------------------
# Smoke / shape
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_returns_resultwording_instance() -> None:
    result = build_result_wording(Season.SPRING)
    assert isinstance(result, ResultWording)


@pytest.mark.unit
def test_resultwording_is_frozen() -> None:
    """Frozen dataclass — analytics layer needs immutable, hashable copies."""
    result = build_result_wording(Season.SPRING)
    with pytest.raises(dataclasses.FrozenInstanceError):
        result.category_line = "tampered"  # type: ignore[misc]


@pytest.mark.unit
def test_accepts_bare_season() -> None:
    result = build_result_wording(Season.SUMMER)
    assert result.season is Season.SUMMER


@pytest.mark.unit
def test_accepts_diagnosis_result() -> None:
    diagnosis = _diagnosis(Season.AUTUMN, confidence=0.92)
    result = build_result_wording(diagnosis)
    assert result.season is Season.AUTUMN


# ---------------------------------------------------------------------------
# Category line — 분류 layer
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize("season", list(Season))
def test_category_line_contains_korean_label(season: Season) -> None:
    """The 분류 line must surface the season's hangul name."""
    result = build_result_wording(season)
    assert season.korean in result.category_line


@pytest.mark.unit
def test_category_line_carries_confidence_percentage() -> None:
    """When source is a DiagnosisResult, the line should render the %."""
    diagnosis = _diagnosis(Season.WINTER, confidence=0.83)
    result = build_result_wording(diagnosis)
    assert "83%" in result.category_line
    assert "겨울" in result.category_line


@pytest.mark.unit
def test_category_line_clamps_confidence_to_0_100() -> None:
    """Out-of-range confidence should clamp, not crash, and not show >100%."""
    diagnosis = _diagnosis(Season.SPRING, confidence=1.5)
    result = build_result_wording(diagnosis)
    assert "100%" in result.category_line


@pytest.mark.unit
def test_category_line_without_confidence_when_source_is_bare_season() -> None:
    """Bare Season → no percentage in the line."""
    result = build_result_wording(Season.SUMMER)
    assert "%" not in result.category_line


# ---------------------------------------------------------------------------
# Guide layer — 상세
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize("season", list(Season))
def test_guide_lines_cover_every_category(season: Season) -> None:
    """Every GuideCategory's Korean label must appear in guide_lines."""
    result = build_result_wording(season)
    rendered = "\n".join(result.guide_lines)
    for category in GuideCategory:
        assert category.label in rendered


@pytest.mark.unit
def test_guide_lines_contain_titles_and_summaries() -> None:
    """Each rendered guide line must carry both the title and the summary."""
    season = Season.SPRING
    guides = load_guides_for_season(season)
    result = build_result_wording(season)
    for guide, line in zip(guides, result.guide_lines, strict=True):
        assert guide.title in line
        assert guide.summary in line


# ---------------------------------------------------------------------------
# Recommendation layer — 시그니처
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize("season", list(Season))
def test_recommendation_lines_mix_all_four_tones(season: Season) -> None:
    """The recommendation layer must surface every WordingTone exactly once.

    This is the headline "톤 혼합" invariant: the rendered surface must
    visibly carry all 4 tone labels (다정한 / 에디토리얼 / 유쾌한 / 시적인).
    """
    result = build_result_wording(season)
    rendered = "\n".join(result.recommendation_lines)
    for tone in WordingTone:
        assert f"({tone.label})" in rendered, (
            f"missing tone label {tone.label!r} in recommendation for " f"{season.name}"
        )
    # And exposed as a tone histogram — exactly one of each.
    assert sorted(t.slug for t in result.tones) == sorted(t.slug for t in WordingTone)


@pytest.mark.unit
def test_recommendation_contains_editor_signature() -> None:
    """The 시그니처 layer must render the editor signature verbatim."""
    season = Season.AUTUMN
    curation = load_first_curation_for_season(season)
    result = build_result_wording(season)
    rendered = "\n".join(result.recommendation_lines)
    assert curation.editor_signature in rendered
    assert curation.headline in rendered


@pytest.mark.unit
def test_recommendation_contains_every_item_title_and_blurb() -> None:
    """Every curation item's title and blurb must appear in the layer."""
    season = Season.WINTER
    curation = load_first_curation_for_season(season)
    result = build_result_wording(season)
    rendered = "\n".join(result.recommendation_lines)
    for item in curation.items:
        assert item.title in rendered
        assert item.blurb in rendered
        assert item.kind.label in rendered


# ---------------------------------------------------------------------------
# Combined-text invariants — the "string" the Sub-AC mandates verifying
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize("season", list(Season))
def test_combined_text_has_all_three_section_markers(season: Season) -> None:
    """combined_text must clearly carry the 분류 / 상세 / 시그니처 sections."""
    result = build_result_wording(season)
    assert "[분류]" in result.combined_text
    assert "[상세 가이드]" in result.combined_text
    assert "[추천 시그니처]" in result.combined_text


@pytest.mark.unit
@pytest.mark.parametrize("season", list(Season))
def test_combined_text_contains_every_tone_label(season: Season) -> None:
    """Tone-mix invariant must be visible in the *single* combined string —
    this is the test the Sub-AC explicitly asks for."""
    result = build_result_wording(season)
    for tone in WordingTone:
        assert tone.label in result.combined_text, (
            f"tone {tone.label!r} missing from combined_text for " f"{season.name}"
        )


@pytest.mark.unit
def test_combined_text_section_order_is_category_then_guide_then_recommendation() -> (
    None
):
    """The three sections must appear in a stable order in the rendered text."""
    result = build_result_wording(Season.SPRING)
    text = result.combined_text
    i_category = text.index("[분류]")
    i_guide = text.index("[상세 가이드]")
    i_reco = text.index("[추천 시그니처]")
    assert i_category < i_guide < i_reco


@pytest.mark.unit
def test_combined_text_contains_category_line_and_guide_titles() -> None:
    """combined_text must embed the category line and every guide title."""
    season = Season.SUMMER
    result = build_result_wording(season)
    assert result.category_line in result.combined_text
    for guide in load_guides_for_season(season):
        assert guide.title in result.combined_text


# ---------------------------------------------------------------------------
# Default-loader vs explicit-override symmetry
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_explicit_override_matches_default_loader() -> None:
    """Passing the loader's own outputs explicitly is a no-op."""
    season = Season.AUTUMN
    default = build_result_wording(season)
    explicit = build_result_wording(
        season,
        guides=load_guides_for_season(season),
        curation=load_first_curation_for_season(season),
    )
    assert default == explicit


# ---------------------------------------------------------------------------
# Input-validation
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_rejects_non_season_non_diagnosis_source() -> None:
    with pytest.raises(TypeError):
        build_result_wording("spring")  # type: ignore[arg-type]


@pytest.mark.unit
def test_rejects_guides_targeting_different_season() -> None:
    """guides[*].season must match the resolved season — refuse mismatch."""
    with pytest.raises(ValueError):
        build_result_wording(
            Season.SPRING,
            guides=load_guides_for_season(Season.WINTER),
        )


@pytest.mark.unit
def test_rejects_curation_targeting_different_season() -> None:
    """curation.season must match the resolved season — refuse mismatch."""
    with pytest.raises(ValueError):
        build_result_wording(
            Season.SUMMER,
            curation=load_first_curation_for_season(Season.AUTUMN),
        )


@pytest.mark.unit
def test_rejects_non_guide_in_guides_tuple() -> None:
    with pytest.raises(TypeError):
        build_result_wording(
            Season.SPRING,
            guides=("not-a-guide",),  # type: ignore[arg-type]
        )


@pytest.mark.unit
def test_rejects_non_firstcuration_curation() -> None:
    with pytest.raises(TypeError):
        build_result_wording(
            Season.SPRING,
            curation="not-a-curation",  # type: ignore[arg-type]
        )


@pytest.mark.unit
def test_rejects_empty_guides_tuple() -> None:
    with pytest.raises(ValueError):
        build_result_wording(Season.SPRING, guides=())


# ---------------------------------------------------------------------------
# Structural invariants on the produced ResultWording
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_guide_lines_count_matches_loaded_guides() -> None:
    season = Season.SPRING
    result = build_result_wording(season)
    assert len(result.guide_lines) == len(load_guides_for_season(season))


@pytest.mark.unit
def test_recommendation_lines_carry_headline_signature_and_four_items() -> None:
    """Headline + editor_signature + 4 items = 6 lines exactly."""
    result = build_result_wording(Season.WINTER)
    assert len(result.recommendation_lines) == 6


@pytest.mark.unit
def test_tones_field_is_a_tuple() -> None:
    """tones must be a tuple — hashable, ordered, immutable."""
    result = build_result_wording(Season.SPRING)
    assert isinstance(result.tones, tuple)


@pytest.mark.unit
def test_guide_lines_field_is_a_tuple() -> None:
    result = build_result_wording(Season.SPRING)
    assert isinstance(result.guide_lines, tuple)


@pytest.mark.unit
def test_recommendation_lines_field_is_a_tuple() -> None:
    result = build_result_wording(Season.SPRING)
    assert isinstance(result.recommendation_lines, tuple)
