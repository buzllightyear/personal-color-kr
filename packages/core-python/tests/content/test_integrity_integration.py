"""End-to-end integration tests for :func:`verify_content_integrity` (Sub-AC 4.4).

The previous Sub-ACs each delivered one *per-catalogue* validator
(:func:`validate_guides`, :func:`validate_curations`,
:func:`validate_magazines`). Sub-AC 4.4 ties them into a single
integration entry point that the pre-build harness invokes.

The contract these tests pin down:

  1. Run against the *real* seeded catalogues (the on-disk
     ``content.guides`` / ``content.curations`` / ``content.magazines``
     modules) and the report must be clean — every defect surface must
     agree with the per-catalogue validators that the seeded surfaces
     have already passed.
  2. Counts match the documented catalogue sizes (16 guides, 4
     curations, 3 magazines) — the harness uses these to assert that no
     entry was silently dropped between modules.
  3. The report is immutable — frozen dataclass with tuple slices,
     hashable, no mutation API.
  4. Aggregate views (``total_errors``, ``is_clean``, ``all_errors``)
     are correctly derived.
  5. Loader dependency injection works — a custom loader returning a
     malformed entry produces defects in *that* catalogue's slice while
     leaving the others clean. This is what makes the integrity layer
     testable without monkey-patching the seeded modules.
  6. Cross-references are wired correctly end-to-end: a curation that
     references a guide_id absent from the loaded guide catalogue is
     caught at ``curation_errors``; a magazine that references a
     curation_id absent from the loaded curation catalogue is caught at
     ``magazine_errors``. This is the integration property — calling
     the validators individually would not surface these because the
     caller would have to wire the cross-catalogue argument by hand.

The module is pure-data + pure-Python, so every test is
``@pytest.mark.integration`` (it composes multiple catalogues end-to-
end) except the immutability micro-tests which are ``@pytest.mark.unit``.
"""

from __future__ import annotations

import dataclasses
from typing import Any, Iterable

import pytest

from content.curations import (
    CurationItem,
    CurationItemKind,
    FirstCuration,
    WordingTone,
    load_all_first_curations,
)
from content.guides import load_all_guides
from content.integrity import (
    ContentIntegrityReport,
    ValidationError,
    verify_content_integrity,
)
from content.magazines import load_all_magazines
from personal_color.season_classifier import Season

# Documented catalogue sizes — the harness uses these as the "expected"
# numbers when gating a release. If a content rewrite legitimately
# changes these, the change must be reflected here so the gate stays
# meaningful (rather than reading whatever ``load_all_*`` happens to
# return today).
EXPECTED_GUIDE_COUNT = 16
EXPECTED_CURATION_COUNT = 4
EXPECTED_MAGAZINE_COUNT = 3


# ---------------------------------------------------------------------------
# End-to-end happy path — real seeded catalogues
# ---------------------------------------------------------------------------


@pytest.mark.integration
def test_real_catalogues_are_integrity_clean() -> None:
    """The seeded catalogues must pass the integrated gate end-to-end."""
    report = verify_content_integrity()

    assert report.is_clean, (
        "real catalogues must be integrity-clean end-to-end. "
        f"guides={list(report.guide_errors)} "
        f"curations={list(report.curation_errors)} "
        f"magazines={list(report.magazine_errors)}"
    )
    assert report.total_errors == 0
    assert report.guide_errors == ()
    assert report.curation_errors == ()
    assert report.magazine_errors == ()


@pytest.mark.integration
def test_real_catalogue_counts_match_documented_sizes() -> None:
    """The harness uses these counts to detect silent drops."""
    report = verify_content_integrity()

    assert report.guide_count == EXPECTED_GUIDE_COUNT
    assert report.curation_count == EXPECTED_CURATION_COUNT
    assert report.magazine_count == EXPECTED_MAGAZINE_COUNT


@pytest.mark.integration
def test_real_catalogue_all_errors_view_is_empty() -> None:
    """`all_errors` must be the flat concat — empty for a clean run."""
    report = verify_content_integrity()
    assert report.all_errors() == ()


# ---------------------------------------------------------------------------
# Report-shape invariants (immutability + aggregate views)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_report_is_frozen_dataclass() -> None:
    """The report must be immutable so it can be logged / hashed safely."""
    report = ContentIntegrityReport()

    with pytest.raises(dataclasses.FrozenInstanceError):
        report.guide_errors = (ValidationError(0, "x", "x"),)  # type: ignore[misc]

    with pytest.raises(dataclasses.FrozenInstanceError):
        report.guide_count = 99  # type: ignore[misc]


@pytest.mark.unit
def test_report_error_slices_are_tuples() -> None:
    """Tuples (not lists) so the report is hashable and safe to share."""
    report = ContentIntegrityReport()

    assert isinstance(report.guide_errors, tuple)
    assert isinstance(report.curation_errors, tuple)
    assert isinstance(report.magazine_errors, tuple)


@pytest.mark.unit
def test_report_total_errors_aggregates_three_slices() -> None:
    """`total_errors` is the sum of the three error-slice lengths."""
    err_g = ValidationError(0, "title", "guide defect")
    err_c1 = ValidationError(1, "headline", "curation defect 1")
    err_c2 = ValidationError(2, "items[0].title", "curation defect 2")
    err_m = ValidationError(0, "month", "magazine defect")

    report = ContentIntegrityReport(
        guide_errors=(err_g,),
        curation_errors=(err_c1, err_c2),
        magazine_errors=(err_m,),
        guide_count=16,
        curation_count=4,
        magazine_count=3,
    )

    assert report.total_errors == 4
    assert not report.is_clean


@pytest.mark.unit
def test_report_all_errors_orders_guides_curations_magazines() -> None:
    """Root-cause-first ordering: guides → curations → magazines."""
    err_g = ValidationError(0, "title", "guide defect")
    err_c = ValidationError(0, "headline", "curation defect")
    err_m = ValidationError(0, "month", "magazine defect")

    report = ContentIntegrityReport(
        guide_errors=(err_g,),
        curation_errors=(err_c,),
        magazine_errors=(err_m,),
    )

    assert report.all_errors() == (err_g, err_c, err_m)


@pytest.mark.unit
def test_empty_report_is_clean() -> None:
    """An empty-construct report defaults to clean for harness wiring."""
    report = ContentIntegrityReport()

    assert report.is_clean is True
    assert report.total_errors == 0


# ---------------------------------------------------------------------------
# Loader dependency injection — bad guide surfaces in guide_errors only
# ---------------------------------------------------------------------------


def _bad_guide_dict() -> dict[str, Any]:
    """Minimal-shape guide payload missing every required string field.

    Returning a dict (rather than constructing :class:`Guide`) is what
    makes this fixture safe — the Guide constructor would hard-raise on
    these holes, but the integrity validator must catch them at the
    *payload* layer for CMS-pipeline use.
    """
    return {
        "season": Season.SPRING,
        "category": "makeup",
        "title": "",  # empty → reported
        "summary": "   ",  # whitespace → reported
        # body intentionally missing
    }


@pytest.mark.integration
def test_bad_guide_loader_surfaces_in_guide_errors_only() -> None:
    """A malformed guide must not leak into curation/magazine slices."""
    bad_guide = _bad_guide_dict()

    report = verify_content_integrity(
        guides_loader=lambda: [bad_guide],
    )

    # Curation / magazine slices stay clean — the per-catalogue
    # validators on the real seeded curations / magazines don't depend
    # on the bad guide's shape (they only care that its season/category
    # don't appear in the cross-ref set, and the seeded curations don't
    # carry any guide_id payloads).
    assert report.curation_errors == ()
    assert report.magazine_errors == ()
    assert report.guide_errors, "bad guide must be reported"

    # Single bad row → all three required-field defects (title, summary
    # empty + body missing) land on index 0.
    fields = {err.field for err in report.guide_errors}
    assert {"title", "summary", "body"}.issubset(fields)
    assert all(err.index == 0 for err in report.guide_errors)

    # Counts reflect what was *loaded*, not what was clean.
    assert report.guide_count == 1
    assert report.curation_count == EXPECTED_CURATION_COUNT
    assert report.magazine_count == EXPECTED_MAGAZINE_COUNT

    assert not report.is_clean


# ---------------------------------------------------------------------------
# Cross-ref end-to-end: curation.guide_id → guides
# ---------------------------------------------------------------------------


def _curation_with_guide_id_dict(guide_id: str) -> dict[str, Any]:
    """Curation package carrying one item with a chosen ``guide_id``."""
    return {
        "season": Season.SPRING,
        "headline": "봄 — 통합 테스트 헤드라인",
        "editor_signature": "통합 테스트용 시그니처.",
        "mood_keywords": ("햇살",),
        "cover_palette": ("#FFEAD2", "#E8662F"),
        "items": (
            {
                "kind": CurationItemKind.MAKEUP_LOOK,
                "tone": WordingTone.AFFECTIONATE,
                "title": "테스트 아이템",
                "blurb": "테스트 블러브.",
                "guide_id": guide_id,
            },
        ),
    }


@pytest.mark.integration
def test_curation_guide_id_unresolved_is_caught_end_to_end() -> None:
    """A curation referencing a non-existent guide must fail the gate."""
    bad_curation = _curation_with_guide_id_dict("spring:nonexistent_category")

    report = verify_content_integrity(
        curations_loader=lambda: [bad_curation],
    )

    # Guide / magazine slices stay clean — the cross-reference defect
    # lives entirely in the curation slice because that's the catalogue
    # where the broken pointer lives. This is the integration property
    # that calling the validators individually cannot produce.
    assert report.guide_errors == ()
    assert report.magazine_errors == ()
    assert any(err.field.endswith(".guide_id") for err in report.curation_errors), (
        "broken curation guide_id must be surfaced as a curation error, "
        f"got {report.curation_errors}"
    )

    # Counts reflect the injected catalogue.
    assert report.curation_count == 1
    assert report.guide_count == EXPECTED_GUIDE_COUNT
    assert report.magazine_count == EXPECTED_MAGAZINE_COUNT


@pytest.mark.integration
def test_curation_guide_id_resolves_against_loaded_guides() -> None:
    """A curation pointing at a real guide must NOT be flagged."""
    real_curation = _curation_with_guide_id_dict("spring:makeup")

    # Inject only the bespoke curation. The real seeded guide catalogue
    # contains spring:makeup, so the cross-reference must resolve.
    report = verify_content_integrity(
        curations_loader=lambda: [real_curation],
    )

    # No curation defect — and specifically no guide_id defect.
    assert all(
        not err.field.endswith(".guide_id") for err in report.curation_errors
    ), f"valid guide_id must not be flagged, got {report.curation_errors}"


# ---------------------------------------------------------------------------
# Cross-ref end-to-end: magazine.curation_id → curations
# ---------------------------------------------------------------------------


def _magazine_with_curation_id_dict(curation_id: str) -> dict[str, Any]:
    """Magazine issue carrying a top-level ``curation_id`` pointer."""
    return {
        "month": "2099-01",
        "issue_title": "통합 테스트 이슈",
        "cover_headline": "통합 테스트 커버 헤드라인",
        "editor_letter": "통합 테스트 에디터 레터.",
        "articles": (
            {
                "season": Season.SPRING,
                "title": "봄 아티클",
                "summary": "봄 한 줄 요약.",
                "body": "봄 본문 단락.",
            },
            {
                "season": Season.SUMMER,
                "title": "여름 아티클",
                "summary": "여름 한 줄 요약.",
                "body": "여름 본문 단락.",
            },
            {
                "season": Season.AUTUMN,
                "title": "가을 아티클",
                "summary": "가을 한 줄 요약.",
                "body": "가을 본문 단락.",
            },
            {
                "season": Season.WINTER,
                "title": "겨울 아티클",
                "summary": "겨울 한 줄 요약.",
                "body": "겨울 본문 단락.",
            },
        ),
        "curation_id": curation_id,
    }


@pytest.mark.integration
def test_magazine_curation_id_unresolved_is_caught_end_to_end() -> None:
    """A magazine referencing a non-existent curation must fail the gate."""
    bad_magazine = _magazine_with_curation_id_dict("nonexistent_season")

    report = verify_content_integrity(
        magazines_loader=lambda: [bad_magazine],
    )

    # Guide / curation slices stay clean.
    assert report.guide_errors == ()
    assert report.curation_errors == ()
    assert any(err.field == "curation_id" for err in report.magazine_errors), (
        "broken magazine curation_id must be surfaced as a magazine error, "
        f"got {report.magazine_errors}"
    )

    assert report.magazine_count == 1
    assert report.guide_count == EXPECTED_GUIDE_COUNT
    assert report.curation_count == EXPECTED_CURATION_COUNT


@pytest.mark.integration
def test_magazine_curation_id_resolves_against_loaded_curations() -> None:
    """A magazine pointing at a real curation must NOT be flagged."""
    # Real curation catalogue contains all 4 season slugs.
    real_magazine = _magazine_with_curation_id_dict("spring")

    report = verify_content_integrity(
        magazines_loader=lambda: [real_magazine],
    )

    assert all(
        err.field != "curation_id" and not err.field.endswith(".curation_id")
        for err in report.magazine_errors
    ), f"valid curation_id must not be flagged, got {report.magazine_errors}"


# ---------------------------------------------------------------------------
# Loader contract — generators are materialised so cross-refs still work
# ---------------------------------------------------------------------------


@pytest.mark.integration
def test_generator_loader_does_not_exhaust_cross_reference() -> None:
    """A loader that returns a generator must still drive cross-refs.

    Without internal materialisation, the first validator call would
    consume the generator and the cross-reference check on the next
    validator would see an empty catalogue — turning legitimate
    references into spurious ``unresolved`` errors.
    """
    real_guides = tuple(load_all_guides())
    real_curations = tuple(load_all_first_curations())
    real_magazines = tuple(load_all_magazines())

    def _gen(items: Iterable[Any]) -> Iterable[Any]:
        for it in items:
            yield it

    report = verify_content_integrity(
        guides_loader=lambda: _gen(real_guides),
        curations_loader=lambda: _gen(real_curations),
        magazines_loader=lambda: _gen(real_magazines),
    )

    assert report.is_clean, (
        "generator loaders must still produce a clean integration run, "
        f"got {report.all_errors()}"
    )
    assert report.guide_count == EXPECTED_GUIDE_COUNT
    assert report.curation_count == EXPECTED_CURATION_COUNT
    assert report.magazine_count == EXPECTED_MAGAZINE_COUNT


# ---------------------------------------------------------------------------
# Loader misuse — wiring bugs surface as TypeError (not silent defects)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_loader_returning_none_raises_type_error() -> None:
    """A loader returning ``None`` is a harness-wiring bug — must raise."""
    with pytest.raises(TypeError):
        verify_content_integrity(guides_loader=lambda: None)


@pytest.mark.unit
def test_loader_returning_string_raises_type_error() -> None:
    """A loader returning a bare string is a harness-wiring bug — must raise."""
    with pytest.raises(TypeError):
        verify_content_integrity(curations_loader=lambda: "not a list")
