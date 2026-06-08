"""Unit tests for the post-payment `ContentPackage` dataclass (Sub-AC 5.1).

The `ContentPackage` is the post-payment unlock bundle defined by the
Seed ontology — `diagnosis + edited_image + guides + curations`. This
suite covers the AC's "field validation" guarantee:

  - **Type validation per field.** Each constructor argument must be the
    expected dataclass instance / tuple; wrong types are refused with a
    descriptive `TypeError`.
  - **Non-empty guides.** A package with zero guides is meaningless on
    the post-diagnosis 4-tile grid and is refused at construction.
  - **Heterogeneous-tuple rejection.** A `guides` tuple that mixes in a
    non-Guide is rejected with an index-bearing error.
  - **Season coherence.** All guides and the curation package must
    target the same season as the diagnosis verdict. A 봄 user must
    never receive 가을 content on the welcome screen.
  - **Immutability.** Frozen dataclass — funnel-analytics + future
    preset rendering need hashable, non-mutable bundles.

Marker: every test is `@pytest.mark.unit` — pure dataclass plumbing,
no I/O and no external vendor calls. The image-edit pipeline result is
built from a hand-constructed `VendorResponse` so this suite never
touches `run_edit_pipeline` itself (which has its own test suite).
"""

from __future__ import annotations

import dataclasses

import pytest

from content.curations import (
    get_curation_by_color,
    load_first_curation_for_season,
)
from content.guides import load_guides_for_season
from content.post_payment_package import ContentPackage
from image_edit.pipeline import PipelineResult
from image_edit.vendor_client import VendorResponse
from personal_color.diagnosis_orchestrator import (
    DiagnosisResult,
    diagnose_from_region_colors,
)
from personal_color.region_extractor import RegionColors
from personal_color.season_classifier import Season

# ---------------------------------------------------------------------------
# Fixtures — one diagnosis + pipeline per season. Kept as plain helpers so
# the parametrized tests below can re-construct fresh instances without
# fixture caching surprises.
# ---------------------------------------------------------------------------


_REGION_COLORS_BY_SEASON: dict[Season, RegionColors] = {
    # Warm undertone, bright skin vs dark hair → HIGH contrast → 봄.
    Season.SPRING: RegionColors(
        skin=(230, 195, 160),
        eyes=(80, 50, 30),
        hair=(70, 45, 30),
    ),
    # Cool undertone, small luma gap → LOW contrast → 여름.
    Season.SUMMER: RegionColors(
        skin=(210, 200, 215),
        eyes=(90, 80, 95),
        hair=(150, 140, 160),
    ),
    # Warm undertone, small luma gap → LOW contrast → 가을.
    Season.AUTUMN: RegionColors(
        skin=(170, 130, 95),
        eyes=(95, 70, 50),
        hair=(140, 105, 80),
    ),
    # Cool undertone, large luma gap → HIGH contrast → 겨울.
    Season.WINTER: RegionColors(
        skin=(210, 215, 235),
        eyes=(40, 35, 50),
        hair=(20, 18, 25),
    ),
}


def _diagnosis_for(season: Season) -> DiagnosisResult:
    """Run the real diagnosis orchestrator for a season-archetype sample."""
    result = diagnose_from_region_colors(_REGION_COLORS_BY_SEASON[season])
    # Defence in depth — the fixture archetypes must actually produce the
    # season we claim. A drift here would cascade into misleading test
    # failures further down.
    assert result.season is season, (
        f"fixture mismatch: archetype for {season.name} produced "
        f"{result.season.name}"
    )
    return result


def _pipeline_result(edited: bytes = b"edited-jpeg-bytes") -> PipelineResult:
    """Build a plausible `PipelineResult` without invoking the pipeline.

    Constructing the dataclass directly (rather than running
    `run_edit_pipeline`) keeps this test suite free of vendor-caller
    plumbing while still exercising the full immutable shape the
    `ContentPackage` accepts.
    """
    response = VendorResponse(
        edited_bytes=edited,
        vendor="nano_banana",
        latency_seconds=4.2,
        attempt=1,
    )
    return PipelineResult(
        edited_bytes=edited,
        vendor="nano_banana",
        pipeline_latency_seconds=4.5,
        vendor_response=response,
    )


def _package_for(season: Season) -> ContentPackage:
    """Build a fully-coherent ContentPackage for the given season."""
    return ContentPackage(
        diagnosis=_diagnosis_for(season),
        edited_image=_pipeline_result(),
        guides=load_guides_for_season(season),
        curations=load_first_curation_for_season(season),
    )


# ---------------------------------------------------------------------------
# Happy path — coherent packages for every season build without error
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize("season", list(Season))
def test_coherent_package_builds_for_every_season(season: Season) -> None:
    """A package whose diagnosis, guides, and curations all target the
    same season must build successfully."""
    package = _package_for(season)
    assert package.diagnosis.season is season
    assert package.curations.season is season
    assert all(g.season is season for g in package.guides)


@pytest.mark.unit
def test_package_preserves_field_references() -> None:
    """The constructor stores references — no surprise copy or wrap."""
    diagnosis = _diagnosis_for(Season.SPRING)
    pipeline = _pipeline_result()
    guides = load_guides_for_season(Season.SPRING)
    curation = get_curation_by_color(Season.SPRING)

    package = ContentPackage(
        diagnosis=diagnosis,
        edited_image=pipeline,
        guides=guides,
        curations=curation,
    )

    assert package.diagnosis is diagnosis
    assert package.edited_image is pipeline
    assert package.guides is guides
    assert package.curations is curation


# ---------------------------------------------------------------------------
# Per-field type validation
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_package_rejects_non_diagnosis() -> None:
    with pytest.raises(TypeError, match="diagnosis must be a DiagnosisResult"):
        ContentPackage(
            diagnosis="spring",  # type: ignore[arg-type]
            edited_image=_pipeline_result(),
            guides=load_guides_for_season(Season.SPRING),
            curations=load_first_curation_for_season(Season.SPRING),
        )


@pytest.mark.unit
def test_package_rejects_non_pipeline_result() -> None:
    with pytest.raises(TypeError, match="edited_image must be a PipelineResult"):
        ContentPackage(
            diagnosis=_diagnosis_for(Season.SPRING),
            edited_image=b"raw-bytes",  # type: ignore[arg-type]
            guides=load_guides_for_season(Season.SPRING),
            curations=load_first_curation_for_season(Season.SPRING),
        )


@pytest.mark.unit
def test_package_rejects_list_guides() -> None:
    """`guides` must be a tuple — frozen-dataclass hashability requires it."""
    with pytest.raises(TypeError, match="guides must be a tuple"):
        ContentPackage(
            diagnosis=_diagnosis_for(Season.SPRING),
            edited_image=_pipeline_result(),
            guides=list(load_guides_for_season(Season.SPRING)),  # type: ignore[arg-type]
            curations=load_first_curation_for_season(Season.SPRING),
        )


@pytest.mark.unit
def test_package_rejects_empty_guides() -> None:
    with pytest.raises(ValueError, match="guides must contain at least one"):
        ContentPackage(
            diagnosis=_diagnosis_for(Season.SPRING),
            edited_image=_pipeline_result(),
            guides=(),
            curations=load_first_curation_for_season(Season.SPRING),
        )


@pytest.mark.unit
def test_package_rejects_non_guide_element_in_tuple() -> None:
    """A heterogeneous guides tuple should fail with the offending index."""
    spring_guides = load_guides_for_season(Season.SPRING)
    bad_tuple = spring_guides + ("not-a-guide",)  # type: ignore[operator]
    with pytest.raises(TypeError, match=r"guides\[4\] must be a Guide"):
        ContentPackage(
            diagnosis=_diagnosis_for(Season.SPRING),
            edited_image=_pipeline_result(),
            guides=bad_tuple,
            curations=load_first_curation_for_season(Season.SPRING),
        )


@pytest.mark.unit
def test_package_rejects_non_curation() -> None:
    with pytest.raises(TypeError, match="curations must be a FirstCuration"):
        ContentPackage(
            diagnosis=_diagnosis_for(Season.SPRING),
            edited_image=_pipeline_result(),
            guides=load_guides_for_season(Season.SPRING),
            curations="봄 패키지",  # type: ignore[arg-type]
        )


# ---------------------------------------------------------------------------
# Season-coherence invariant — the package must theme one season only
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_package_rejects_curation_for_wrong_season() -> None:
    """봄 diagnosis + 가을 curation must fail — mismatched welcome screen."""
    with pytest.raises(
        ValueError,
        match=r"curations.season \(AUTUMN\) does not match diagnosis.season \(SPRING\)",
    ):
        ContentPackage(
            diagnosis=_diagnosis_for(Season.SPRING),
            edited_image=_pipeline_result(),
            guides=load_guides_for_season(Season.SPRING),
            curations=load_first_curation_for_season(Season.AUTUMN),
        )


@pytest.mark.unit
def test_package_rejects_guide_for_wrong_season() -> None:
    """A guides tuple that smuggles in a non-matching-season guide fails."""
    spring_guides = load_guides_for_season(Season.SPRING)
    autumn_guides = load_guides_for_season(Season.AUTUMN)
    mixed = spring_guides + (autumn_guides[0],)
    with pytest.raises(
        ValueError,
        match=r"guides\[4\].season \(AUTUMN\) does not match diagnosis.season \(SPRING\)",
    ):
        ContentPackage(
            diagnosis=_diagnosis_for(Season.SPRING),
            edited_image=_pipeline_result(),
            guides=mixed,
            curations=load_first_curation_for_season(Season.SPRING),
        )


@pytest.mark.unit
@pytest.mark.parametrize(
    "diagnosis_season,wrong_curation_season",
    [
        (Season.SUMMER, Season.WINTER),
        (Season.WINTER, Season.SUMMER),
        (Season.AUTUMN, Season.SPRING),
    ],
)
def test_package_season_mismatch_message_names_both_seasons(
    diagnosis_season: Season,
    wrong_curation_season: Season,
) -> None:
    """The error message must name both seasons so debugging is one read."""
    with pytest.raises(ValueError) as exc_info:
        ContentPackage(
            diagnosis=_diagnosis_for(diagnosis_season),
            edited_image=_pipeline_result(),
            guides=load_guides_for_season(diagnosis_season),
            curations=load_first_curation_for_season(wrong_curation_season),
        )
    message = str(exc_info.value)
    assert diagnosis_season.name in message
    assert wrong_curation_season.name in message


# ---------------------------------------------------------------------------
# Immutability — frozen dataclass, hashable, tuple collections
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_package_is_frozen() -> None:
    package = _package_for(Season.SPRING)
    with pytest.raises(dataclasses.FrozenInstanceError):
        package.diagnosis = _diagnosis_for(Season.WINTER)  # type: ignore[misc]


@pytest.mark.unit
def test_package_guides_field_is_tuple() -> None:
    package = _package_for(Season.SUMMER)
    assert isinstance(package.guides, tuple)


@pytest.mark.unit
def test_package_is_hashable() -> None:
    """Frozen dataclass + immutable fields → hashable for analytics dedup."""
    a = _package_for(Season.SPRING)
    b = _package_for(Season.SPRING)
    # Equal-by-value packages must hash to the same bucket.
    assert hash(a) == hash(b)
