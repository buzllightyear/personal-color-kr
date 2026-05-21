"""Tests for :func:`content.integrity.validate_magazines` (Sub-AC 4.3).

The validator's contract mirrors :func:`validate_guides` /
:func:`validate_curations` and adds one new responsibility — cross-
catalogue ``curation_id`` reference checking against the first-curation
catalogue:

  1. Returns a list of :class:`ValidationError`, never raises on per-item
     defects.
  2. Reports every missing required field on the issue and on every
     article, not just the first.
  3. Accepts both fully-constructed :class:`Magazine` /
     :class:`MagazineArticle` dataclasses (runtime catalogue) and raw
     dict payloads (CMS-rewrite input).
  4. Reports malformed ``month`` shape independently of the constructor.
  5. Reports invalid ``curation_id`` shape (non-string, empty, None when
     present) on both the issue and the article level.
  6. Reports unresolved ``curation_id`` references when a ``curations``
     iterable is supplied (and skips that check when it isn't).
  7. Returns an empty list for the real seeded magazine catalogue cross-
     checked against the real 4-curation catalogue — the integrity gate
     must agree with the constructors' already-validated surfaces.

The test module is pure-data + pure-Python, so every test is
``@pytest.mark.unit``.
"""

from __future__ import annotations

import dataclasses
from typing import Any

import pytest

from content.curations import load_all_first_curations
from content.guides import load_all_guides
from content.integrity import (
    REQUIRED_MAGAZINE_ARTICLE_FIELDS,
    REQUIRED_MAGAZINE_FIELDS,
    ValidationError,
    validate_curations,
    validate_magazines,
)
from content.magazines import (
    Magazine,
    MagazineArticle,
    load_all_magazines,
)
from personal_color.season_classifier import Season

# ---------------------------------------------------------------------------
# Test fixtures — minimal-valid raw payloads we can mutate per test.
# ---------------------------------------------------------------------------


def _valid_dict_article(**overrides: Any) -> dict[str, Any]:
    """Return a minimal-valid raw magazine-article dict."""
    base: dict[str, Any] = {
        "season": Season.SPRING,
        "title": "테스트 기사 제목",
        "summary": "테스트 한 줄 요약.",
        "body": "테스트 본문 한 줄.",
    }
    base.update(overrides)
    return base


def _valid_dict_magazine(**overrides: Any) -> dict[str, Any]:
    """Return a minimal-valid raw magazine-issue dict.

    The 4-article-with-one-per-Season invariant is enforced by the
    :class:`Magazine` constructor (Sub-AC 3.2) — *not* by the integrity
    validator. The validator only checks structural shape +
    cross-references. So the fixture here only needs to satisfy the
    shape contract: a non-empty ``articles`` list of well-formed entries.
    """
    base: dict[str, Any] = {
        "month": "2026-05",
        "issue_title": "테스트 호 — 시그니처",
        "cover_headline": "테스트 커버 한 줄.",
        "editor_letter": "에디터의 짧은 인사 한 줄입니다.",
        "articles": (_valid_dict_article(),),
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# Happy path — live catalogues must pass
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_real_catalogue_passes_integrity_check() -> None:
    """Seeded magazine catalogue is integrity-clean against the curations."""
    errors = validate_magazines(
        load_all_magazines(),
        load_all_first_curations(),
    )
    assert (
        errors == []
    ), f"runtime magazine catalogue must be clean, got defects: {errors}"


@pytest.mark.unit
def test_real_catalogue_passes_without_curations_arg() -> None:
    """Omitting `curations` is allowed — no articles carry curation_id today."""
    errors = validate_magazines(load_all_magazines())
    assert errors == []


@pytest.mark.unit
def test_empty_input_returns_empty_error_list() -> None:
    """No magazines → no defects. Validator must not invent errors."""
    assert validate_magazines([]) == []
    assert validate_magazines((), curations=load_all_first_curations()) == []


@pytest.mark.unit
def test_returns_list_not_generator() -> None:
    """Callers index the result for diagnostics; must be a concrete list."""
    result = validate_magazines([])
    assert isinstance(result, list)


# ---------------------------------------------------------------------------
# Missing required fields — the headline AC
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_missing_required_field_is_reported() -> None:
    """Removing one required field should produce exactly one defect."""
    magazine = _valid_dict_magazine()
    del magazine["issue_title"]
    errors = validate_magazines([magazine])
    assert len(errors) == 1
    assert errors[0].index == 0
    assert errors[0].field == "issue_title"
    assert "required" in errors[0].message


@pytest.mark.unit
def test_all_missing_required_issue_fields_are_reported_at_once() -> None:
    """Validator must surface every defect — not stop at the first."""
    empty: dict[str, Any] = {}
    errors = validate_magazines([empty])
    reported_fields = {e.field for e in errors}
    assert set(REQUIRED_MAGAZINE_FIELDS).issubset(reported_fields), (
        f"expected all of {REQUIRED_MAGAZINE_FIELDS} to be reported, "
        f"got {sorted(reported_fields)}"
    )


@pytest.mark.unit
def test_none_required_field_counts_as_missing() -> None:
    """A field present-but-None is the same defect as field-absent."""
    magazine = _valid_dict_magazine()
    magazine["editor_letter"] = None
    errors = validate_magazines([magazine])
    assert any(e.field == "editor_letter" for e in errors)


@pytest.mark.unit
def test_empty_string_required_field_is_reported() -> None:
    """Whitespace-only required strings are defects, not pass-throughs."""
    magazine = _valid_dict_magazine()
    magazine["cover_headline"] = "   "
    errors = validate_magazines([magazine])
    assert any(e.field == "cover_headline" for e in errors)


@pytest.mark.unit
def test_wrong_type_for_string_required_field_is_reported() -> None:
    """Non-string editor_letter is a structural defect."""
    magazine = _valid_dict_magazine()
    magazine["editor_letter"] = 42
    errors = validate_magazines([magazine])
    assert any(e.field == "editor_letter" and "string" in e.message for e in errors)


# ---------------------------------------------------------------------------
# month shape validation
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_month_non_string_is_reported() -> None:
    magazine = _valid_dict_magazine(month=202605)
    errors = validate_magazines([magazine])
    assert any(e.field == "month" and "YYYY-MM" in e.message for e in errors)


@pytest.mark.unit
@pytest.mark.parametrize(
    "bad_month",
    ["", "2026-5", "2026/05", "26-05", "2026-13", "2026-00", "not-a-month"],
)
def test_malformed_month_is_reported(bad_month: str) -> None:
    magazine = _valid_dict_magazine(month=bad_month)
    errors = validate_magazines([magazine])
    assert any(
        e.field == "month" for e in errors
    ), f"expected month defect for {bad_month!r}, got {errors}"


@pytest.mark.unit
def test_valid_month_is_accepted() -> None:
    magazine = _valid_dict_magazine(month="2030-12")
    errors = validate_magazines([magazine])
    assert [e for e in errors if e.field == "month"] == []


# ---------------------------------------------------------------------------
# articles — required-field + nested defect propagation
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_articles_non_iterable_is_reported() -> None:
    magazine = _valid_dict_magazine(articles="not-a-list")
    errors = validate_magazines([magazine])
    assert any(e.field == "articles" for e in errors)


@pytest.mark.unit
def test_missing_required_article_field_is_reported_with_path() -> None:
    bad_article = _valid_dict_article()
    del bad_article["title"]
    magazine = _valid_dict_magazine(articles=(bad_article,))
    errors = validate_magazines([magazine])
    assert any(e.field == "articles[0].title" for e in errors)


@pytest.mark.unit
def test_all_missing_article_fields_are_reported_at_once() -> None:
    magazine = _valid_dict_magazine(articles=({},))
    errors = validate_magazines([magazine])
    reported_fields = {e.field for e in errors}
    for field in REQUIRED_MAGAZINE_ARTICLE_FIELDS:
        assert (
            f"articles[0].{field}" in reported_fields
        ), f"expected articles[0].{field} in {sorted(reported_fields)}"


@pytest.mark.unit
def test_empty_string_article_body_is_reported() -> None:
    magazine = _valid_dict_magazine(
        articles=(_valid_dict_article(body="   "),),
    )
    errors = validate_magazines([magazine])
    assert any(e.field == "articles[0].body" for e in errors)


@pytest.mark.unit
def test_unknown_article_season_is_reported() -> None:
    magazine = _valid_dict_magazine(
        articles=(_valid_dict_article(season="autumn-winter"),),
    )
    errors = validate_magazines([magazine])
    assert any(e.field == "articles[0].season" for e in errors)


@pytest.mark.unit
def test_article_season_slug_is_accepted() -> None:
    magazine = _valid_dict_magazine(
        articles=(_valid_dict_article(season="summer"),),
    )
    errors = validate_magazines([magazine])
    assert [e for e in errors if e.field == "articles[0].season"] == []


@pytest.mark.unit
def test_article_season_korean_label_is_accepted() -> None:
    magazine = _valid_dict_magazine(
        articles=(_valid_dict_article(season="가을"),),
    )
    errors = validate_magazines([magazine])
    assert [e for e in errors if e.field == "articles[0].season"] == []


# ---------------------------------------------------------------------------
# curation_id cross-reference — the new responsibility for this AC
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_unknown_issue_curation_id_is_reported_when_curations_supplied() -> None:
    """Non-existent issue-level curation_id → defect (the headline AC)."""
    magazine = _valid_dict_magazine(curation_id="nonexistent")
    errors = validate_magazines([magazine], load_all_first_curations())
    assert any(
        e.field == "curation_id" and "unknown" in e.message for e in errors
    ), f"expected unknown-curation_id defect, got {errors}"


@pytest.mark.unit
def test_known_issue_curation_id_is_accepted() -> None:
    """An issue curation_id matching a real season slug must pass."""
    magazine = _valid_dict_magazine(curation_id="spring")
    errors = validate_magazines([magazine], load_all_first_curations())
    assert [e for e in errors if e.field == "curation_id"] == []


@pytest.mark.unit
def test_unknown_article_curation_id_is_reported_when_curations_supplied() -> None:
    """Non-existent article-level curation_id → defect."""
    bad_article = _valid_dict_article(curation_id="nonexistent")
    magazine = _valid_dict_magazine(articles=(bad_article,))
    errors = validate_magazines([magazine], load_all_first_curations())
    assert any(
        e.field == "articles[0].curation_id" and "unknown" in e.message for e in errors
    ), f"expected unknown-article-curation_id defect, got {errors}"


@pytest.mark.unit
def test_known_article_curation_id_is_accepted() -> None:
    article = _valid_dict_article(curation_id="winter")
    magazine = _valid_dict_magazine(articles=(article,))
    errors = validate_magazines([magazine], load_all_first_curations())
    assert [e for e in errors if e.field == "articles[0].curation_id"] == []


@pytest.mark.unit
def test_curation_id_check_skipped_when_curations_omitted() -> None:
    """Without `curations`, an unresolved curation_id must NOT be flagged."""
    magazine = _valid_dict_magazine(curation_id="nonexistent")
    errors = validate_magazines([magazine])
    assert [e for e in errors if e.field == "curation_id"] == []


@pytest.mark.unit
def test_non_string_curation_id_is_reported() -> None:
    magazine = _valid_dict_magazine(curation_id=42)
    errors = validate_magazines([magazine], load_all_first_curations())
    assert any(e.field == "curation_id" and "string" in e.message for e in errors)


@pytest.mark.unit
def test_empty_curation_id_is_reported() -> None:
    magazine = _valid_dict_magazine(curation_id="   ")
    errors = validate_magazines([magazine], load_all_first_curations())
    assert any(e.field == "curation_id" for e in errors)


@pytest.mark.unit
def test_none_curation_id_is_reported_when_key_present() -> None:
    """Present-but-None curation_id must flag — caller meant to set a value."""
    magazine = _valid_dict_magazine(curation_id=None)
    errors = validate_magazines([magazine], load_all_first_curations())
    assert any(e.field == "curation_id" for e in errors)


@pytest.mark.unit
def test_absent_curation_id_is_accepted() -> None:
    """curation_id is optional — its absence must not flag a defect."""
    magazine = _valid_dict_magazine()
    assert "curation_id" not in magazine
    errors = validate_magazines([magazine], load_all_first_curations())
    assert [e for e in errors if "curation_id" in e.field] == []


@pytest.mark.unit
def test_curation_id_resolves_for_every_seeded_season() -> None:
    """Every Season slug in the curation catalogue resolves."""
    curations = load_all_first_curations()
    magazines = [_valid_dict_magazine(curation_id=c.season.slug) for c in curations]
    errors = validate_magazines(magazines, curations)
    assert [
        e for e in errors if "curation_id" in e.field
    ] == [], f"every seeded curation id must resolve, got: {errors}"


# ---------------------------------------------------------------------------
# Dataclass-input parity (mixed with dicts)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_magazine_dataclass_passes() -> None:
    magazine_obj = load_all_magazines()[0]
    assert isinstance(magazine_obj, Magazine)
    assert validate_magazines([magazine_obj]) == []


@pytest.mark.unit
def test_mixed_input_types_are_supported() -> None:
    """Validator must accept Magazine and dict in the same list."""
    magazine_obj = load_all_magazines()[0]
    raw = _valid_dict_magazine(month="2099-01")
    errors = validate_magazines([magazine_obj, raw])
    assert errors == []


@pytest.mark.unit
def test_magazine_article_dataclass_in_dict_wrapper_works() -> None:
    """A dict issue whose articles are real MagazineArticle dataclasses works."""
    article_obj = MagazineArticle(
        season=Season.SPRING,
        title="데이터클래스 기사",
        summary="요약.",
        body="본문.",
    )
    magazine = _valid_dict_magazine(articles=(article_obj,))
    errors = validate_magazines([magazine], load_all_first_curations())
    assert errors == []


# ---------------------------------------------------------------------------
# Cross-item — defect index tracking
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_defect_index_reflects_input_position() -> None:
    """Errors must carry the offending issue's index, in input order."""
    good = _valid_dict_magazine()
    bad = _valid_dict_magazine(month="2026-06")
    del bad["issue_title"]
    third = _valid_dict_magazine(month="2026-07")
    errors = validate_magazines([good, bad, third])
    assert len(errors) == 1
    assert errors[0].index == 1
    assert errors[0].field == "issue_title"


@pytest.mark.unit
def test_multiple_issues_each_get_their_own_errors() -> None:
    a = _valid_dict_magazine()
    del a["cover_headline"]
    b = _valid_dict_magazine(month="2026-06")
    del b["editor_letter"]
    errors = validate_magazines([a, b])
    by_index = {(e.index, e.field) for e in errors}
    assert (0, "cover_headline") in by_index
    assert (1, "editor_letter") in by_index


# ---------------------------------------------------------------------------
# Outer-type input validation
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_none_magazines_raises_typeerror() -> None:
    with pytest.raises(TypeError, match="iterable"):
        validate_magazines(None)  # type: ignore[arg-type]


@pytest.mark.unit
def test_string_magazines_raises_typeerror() -> None:
    """A bare string would iterate character-by-character — refuse it."""
    with pytest.raises(TypeError, match="iterable"):
        validate_magazines("not a list")  # type: ignore[arg-type]


@pytest.mark.unit
def test_string_curations_raises_typeerror() -> None:
    """curations argument must be iterable too — same refusal."""
    with pytest.raises(TypeError, match="iterable"):
        validate_magazines(
            [],
            curations="not a list",  # type: ignore[arg-type]
        )


# ---------------------------------------------------------------------------
# Cross-validator consistency — integrity gates must agree with each other
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_validate_magazines_agrees_with_validate_curations_on_clean_set() -> None:
    """The two sibling validators must concur the prebuilt catalogue is clean."""
    curation_errors = validate_curations(
        load_all_first_curations(),
        load_all_guides(),
    )
    magazine_errors = validate_magazines(
        load_all_magazines(),
        load_all_first_curations(),
    )
    assert curation_errors == []
    assert magazine_errors == []


# ---------------------------------------------------------------------------
# ValidationError record properties (shared with sibling validators)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_validation_error_records_remain_immutable() -> None:
    err = ValidationError(
        index=0,
        field="month",
        message="month: missing",
    )
    with pytest.raises(dataclasses.FrozenInstanceError):
        err.field = "issue_title"  # type: ignore[misc]
