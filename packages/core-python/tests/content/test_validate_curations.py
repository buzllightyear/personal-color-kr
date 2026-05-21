"""Tests for :func:`content.integrity.validate_curations` (Sub-AC 4.2).

The validator's contract mirrors :func:`validate_guides` and adds one
new responsibility — cross-catalogue ``guide_id`` reference checking:

  1. Returns a list of :class:`ValidationError`, never raises on per-item
     defects.
  2. Reports every missing required field on the package and on every
     item, not just the first.
  3. Accepts both fully-constructed :class:`FirstCuration` /
     :class:`CurationItem` dataclasses (runtime catalogue) and raw dict
     payloads (CMS-rewrite input).
  4. Reports invalid ``guide_id`` shape (non-string, empty).
  5. Reports unresolved ``guide_id`` references when a ``guides``
     iterable is supplied (and skips that check when it isn't).
  6. Returns an empty list for the real 4-curation catalogue cross-
     checked against the real 16-guide catalogue — the integrity gate
     must agree with the constructors' already-validated surfaces.

The test module is pure-data + pure-Python, so every test is
``@pytest.mark.unit``.
"""

from __future__ import annotations

import dataclasses
from typing import Any

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
    REQUIRED_CURATION_FIELDS,
    REQUIRED_CURATION_ITEM_FIELDS,
    ValidationError,
    validate_curations,
)
from personal_color.season_classifier import Season

# ---------------------------------------------------------------------------
# Test fixtures — minimal-valid raw payloads we can mutate per test.
# ---------------------------------------------------------------------------


def _valid_dict_item(**overrides: Any) -> dict[str, Any]:
    """Return a minimal-valid raw curation-item dict for mutation in tests."""
    base: dict[str, Any] = {
        "kind": CurationItemKind.MAKEUP_LOOK,
        "tone": WordingTone.AFFECTIONATE,
        "title": "테스트 아이템",
        "blurb": "테스트 한 줄 블러브.",
    }
    base.update(overrides)
    return base


def _valid_dict_curation(**overrides: Any) -> dict[str, Any]:
    """Return a minimal-valid raw curation-package dict for mutation in tests.

    The 4-items-with-mixed-kinds-and-tones invariant is enforced by the
    :class:`FirstCuration` constructor (Sub-AC 11.2) — *not* by the
    integrity validator. The validator only checks structural shape +
    cross-references. So the fixture here only needs to satisfy the
    shape contract: a non-empty ``items`` list of well-formed entries.
    """
    base: dict[str, Any] = {
        "season": Season.SPRING,
        "headline": "봄 — 테스트 헤드라인",
        "editor_signature": "에디터의 짧은 시그니처 한 줄.",
        "mood_keywords": ("햇살", "산뜻"),
        "cover_palette": ("#FFEAD2", "#E8662F"),
        "items": (_valid_dict_item(),),
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# Happy path — live catalogues must pass
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_real_catalogue_passes_integrity_check() -> None:
    """4-curation catalogue is integrity-clean against the live guide set."""
    errors = validate_curations(load_all_first_curations(), load_all_guides())
    assert (
        errors == []
    ), f"runtime curation catalogue must be clean, got defects: {errors}"


@pytest.mark.unit
def test_real_catalogue_passes_without_guides_arg() -> None:
    """Omitting `guides` is allowed — no items carry guide_id today."""
    errors = validate_curations(load_all_first_curations())
    assert errors == []


@pytest.mark.unit
def test_empty_input_returns_empty_error_list() -> None:
    """No curations → no defects. Validator must not invent errors."""
    assert validate_curations([]) == []
    assert validate_curations((), guides=load_all_guides()) == []


@pytest.mark.unit
def test_returns_list_not_generator() -> None:
    """Callers index the result for diagnostics; must be a concrete list."""
    result = validate_curations([])
    assert isinstance(result, list)


# ---------------------------------------------------------------------------
# Missing required fields — the headline AC
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_missing_required_field_is_reported() -> None:
    """Removing one required field on the package should produce one defect."""
    curation = _valid_dict_curation()
    del curation["headline"]
    errors = validate_curations([curation])
    assert len(errors) == 1
    assert errors[0].index == 0
    assert errors[0].field == "headline"
    assert "required" in errors[0].message


@pytest.mark.unit
def test_all_missing_required_package_fields_are_reported_at_once() -> None:
    """Validator must surface every defect — not stop at the first."""
    empty: dict[str, Any] = {}
    errors = validate_curations([empty])
    reported_fields = {e.field for e in errors}
    assert set(REQUIRED_CURATION_FIELDS).issubset(reported_fields), (
        f"expected all of {REQUIRED_CURATION_FIELDS} to be reported, "
        f"got {sorted(reported_fields)}"
    )


@pytest.mark.unit
def test_none_required_field_counts_as_missing() -> None:
    """A field present-but-None is the same defect as field-absent."""
    curation = _valid_dict_curation()
    curation["editor_signature"] = None
    errors = validate_curations([curation])
    assert any(e.field == "editor_signature" for e in errors)


@pytest.mark.unit
def test_empty_string_required_field_is_reported() -> None:
    """Whitespace-only required strings are defects, not pass-throughs."""
    curation = _valid_dict_curation()
    curation["headline"] = "   "
    errors = validate_curations([curation])
    assert any(e.field == "headline" for e in errors)


@pytest.mark.unit
def test_wrong_type_for_string_required_field_is_reported() -> None:
    """Non-string headline is a structural defect."""
    curation = _valid_dict_curation()
    curation["headline"] = 42
    errors = validate_curations([curation])
    assert any(e.field == "headline" and "string" in e.message for e in errors)


# ---------------------------------------------------------------------------
# season / mood_keywords / cover_palette shape validation
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_unknown_season_is_reported() -> None:
    curation = _valid_dict_curation(season="autumn-winter")
    errors = validate_curations([curation])
    assert any(e.field == "season" for e in errors)


@pytest.mark.unit
def test_season_slug_is_accepted() -> None:
    curation = _valid_dict_curation(season="spring")
    errors = validate_curations([curation])
    assert [e for e in errors if e.field == "season"] == []


@pytest.mark.unit
def test_season_korean_label_is_accepted() -> None:
    curation = _valid_dict_curation(season="봄")
    errors = validate_curations([curation])
    assert [e for e in errors if e.field == "season"] == []


@pytest.mark.unit
def test_mood_keywords_non_iterable_is_reported() -> None:
    curation = _valid_dict_curation(mood_keywords="just-a-string")
    errors = validate_curations([curation])
    assert any(e.field == "mood_keywords" for e in errors)


@pytest.mark.unit
def test_empty_mood_keywords_is_reported() -> None:
    curation = _valid_dict_curation(mood_keywords=())
    errors = validate_curations([curation])
    assert any(e.field == "mood_keywords" for e in errors)


@pytest.mark.unit
def test_blank_mood_keyword_entry_is_reported_with_index() -> None:
    curation = _valid_dict_curation(mood_keywords=("햇살", "   "))
    errors = validate_curations([curation])
    assert any(e.field == "mood_keywords[1]" for e in errors)


@pytest.mark.unit
def test_invalid_hex_in_cover_palette_is_reported_with_index() -> None:
    curation = _valid_dict_curation(cover_palette=("#FFEAD2", "not-hex"))
    errors = validate_curations([curation])
    assert any(e.field == "cover_palette[1]" for e in errors)


@pytest.mark.unit
def test_cover_palette_non_iterable_is_reported() -> None:
    curation = _valid_dict_curation(cover_palette="#FFEAD2")
    errors = validate_curations([curation])
    assert any(e.field == "cover_palette" for e in errors)


# ---------------------------------------------------------------------------
# Items — required-field + nested defect propagation
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_items_non_iterable_is_reported() -> None:
    curation = _valid_dict_curation(items="not-a-list")
    errors = validate_curations([curation])
    assert any(e.field == "items" for e in errors)


@pytest.mark.unit
def test_missing_required_item_field_is_reported_with_path() -> None:
    bad_item = _valid_dict_item()
    del bad_item["title"]
    curation = _valid_dict_curation(items=(bad_item,))
    errors = validate_curations([curation])
    assert any(e.field == "items[0].title" for e in errors)


@pytest.mark.unit
def test_all_missing_item_fields_are_reported_at_once() -> None:
    curation = _valid_dict_curation(items=({},))
    errors = validate_curations([curation])
    reported_fields = {e.field for e in errors}
    for field in REQUIRED_CURATION_ITEM_FIELDS:
        assert (
            f"items[0].{field}" in reported_fields
        ), f"expected items[0].{field} in {sorted(reported_fields)}"


@pytest.mark.unit
def test_empty_string_item_title_is_reported() -> None:
    curation = _valid_dict_curation(
        items=(_valid_dict_item(title="   "),),
    )
    errors = validate_curations([curation])
    assert any(e.field == "items[0].title" for e in errors)


@pytest.mark.unit
def test_unknown_item_kind_is_reported() -> None:
    curation = _valid_dict_curation(
        items=(_valid_dict_item(kind="lipstick-look"),),
    )
    errors = validate_curations([curation])
    assert any(e.field == "items[0].kind" for e in errors)


@pytest.mark.unit
def test_item_kind_slug_is_accepted() -> None:
    curation = _valid_dict_curation(
        items=(_valid_dict_item(kind="makeup_look"),),
    )
    errors = validate_curations([curation])
    assert [e for e in errors if e.field == "items[0].kind"] == []


@pytest.mark.unit
def test_unknown_item_tone_is_reported() -> None:
    curation = _valid_dict_curation(
        items=(_valid_dict_item(tone="sarcastic"),),
    )
    errors = validate_curations([curation])
    assert any(e.field == "items[0].tone" for e in errors)


@pytest.mark.unit
def test_item_tone_korean_label_is_accepted() -> None:
    curation = _valid_dict_curation(
        items=(_valid_dict_item(tone="다정한"),),
    )
    errors = validate_curations([curation])
    assert [e for e in errors if e.field == "items[0].tone"] == []


# ---------------------------------------------------------------------------
# guide_id cross-reference — the new responsibility for this AC
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_unknown_guide_id_is_reported_when_guides_supplied() -> None:
    """Non-existent guide_id must produce a defect — the headline AC."""
    bad_item = _valid_dict_item(guide_id="spring:nonexistent")
    curation = _valid_dict_curation(items=(bad_item,))
    errors = validate_curations([curation], load_all_guides())
    assert any(
        e.field == "items[0].guide_id" and "unknown" in e.message for e in errors
    ), f"expected unknown-guide_id defect, got {errors}"


@pytest.mark.unit
def test_known_guide_id_is_accepted() -> None:
    """A guide_id matching a real (season, category) pair must pass."""
    good_item = _valid_dict_item(guide_id="spring:makeup")
    curation = _valid_dict_curation(items=(good_item,))
    errors = validate_curations([curation], load_all_guides())
    assert [e for e in errors if e.field == "items[0].guide_id"] == []


@pytest.mark.unit
def test_guide_id_check_skipped_when_guides_omitted() -> None:
    """Without `guides`, an unresolved guide_id must NOT be flagged."""
    item = _valid_dict_item(guide_id="spring:nonexistent")
    curation = _valid_dict_curation(items=(item,))
    errors = validate_curations([curation])
    # Shape is fine (it's a non-empty string), and no resolution attempt
    # is made → no guide_id defect.
    assert [e for e in errors if e.field == "items[0].guide_id"] == []


@pytest.mark.unit
def test_non_string_guide_id_is_reported() -> None:
    curation = _valid_dict_curation(
        items=(_valid_dict_item(guide_id=123),),
    )
    errors = validate_curations([curation], load_all_guides())
    assert any(e.field == "items[0].guide_id" and "string" in e.message for e in errors)


@pytest.mark.unit
def test_empty_guide_id_is_reported() -> None:
    curation = _valid_dict_curation(
        items=(_valid_dict_item(guide_id="   "),),
    )
    errors = validate_curations([curation], load_all_guides())
    assert any(e.field == "items[0].guide_id" for e in errors)


@pytest.mark.unit
def test_none_guide_id_is_reported_when_key_present() -> None:
    """Present-but-None guide_id must flag — caller meant to set a value."""
    curation = _valid_dict_curation(
        items=(_valid_dict_item(guide_id=None),),
    )
    errors = validate_curations([curation], load_all_guides())
    assert any(e.field == "items[0].guide_id" for e in errors)


@pytest.mark.unit
def test_absent_guide_id_is_accepted() -> None:
    """guide_id is optional — its absence must not flag a defect."""
    item = _valid_dict_item()
    assert "guide_id" not in item
    curation = _valid_dict_curation(items=(item,))
    errors = validate_curations([curation], load_all_guides())
    assert [e for e in errors if "guide_id" in e.field] == []


@pytest.mark.unit
def test_guide_id_resolves_against_all_seasons_and_categories() -> None:
    """Every (season, category) combination in the live catalogue resolves."""
    items_with_refs = tuple(
        _valid_dict_item(guide_id=f"{g.season.slug}:{g.category.slug}")
        for g in load_all_guides()
    )
    curation = _valid_dict_curation(items=items_with_refs)
    errors = validate_curations([curation], load_all_guides())
    guide_id_errors = [e for e in errors if "guide_id" in e.field]
    assert (
        guide_id_errors == []
    ), f"every live guide id must resolve, got: {guide_id_errors}"


# ---------------------------------------------------------------------------
# Dataclass-input parity (mixed with dicts)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_first_curation_dataclass_passes() -> None:
    curation_obj = load_all_first_curations()[0]
    assert isinstance(curation_obj, FirstCuration)
    assert validate_curations([curation_obj]) == []


@pytest.mark.unit
def test_mixed_input_types_are_supported() -> None:
    """Validator must accept FirstCuration and dict in the same list."""
    curation_obj = load_all_first_curations()[0]
    raw = _valid_dict_curation()
    errors = validate_curations([curation_obj, raw])
    assert errors == []


@pytest.mark.unit
def test_curation_item_dataclass_with_guide_id_via_dict_wrapper() -> None:
    """A dict package whose items are real CurationItem dataclasses works."""
    item_obj = CurationItem(
        kind=CurationItemKind.MAKEUP_LOOK,
        tone=WordingTone.AFFECTIONATE,
        title="데이터클래스 아이템",
        blurb="블러브.",
    )
    curation = _valid_dict_curation(items=(item_obj,))
    errors = validate_curations([curation], load_all_guides())
    assert errors == []


# ---------------------------------------------------------------------------
# Cross-item — defect index tracking
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_defect_index_reflects_input_position() -> None:
    """Errors must carry the offending package's index, in input order."""
    good = _valid_dict_curation()
    bad = _valid_dict_curation()
    del bad["headline"]
    errors = validate_curations([good, bad, good])
    assert len(errors) == 1
    assert errors[0].index == 1
    assert errors[0].field == "headline"


@pytest.mark.unit
def test_multiple_packages_each_get_their_own_errors() -> None:
    a = _valid_dict_curation()
    del a["editor_signature"]
    b = _valid_dict_curation()
    del b["headline"]
    errors = validate_curations([a, b])
    by_index = {e.index: e.field for e in errors}
    assert by_index == {0: "editor_signature", 1: "headline"}


# ---------------------------------------------------------------------------
# Outer-type input validation
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_none_curations_raises_typeerror() -> None:
    with pytest.raises(TypeError, match="iterable"):
        validate_curations(None)  # type: ignore[arg-type]


@pytest.mark.unit
def test_string_curations_raises_typeerror() -> None:
    """A bare string would iterate character-by-character — refuse it."""
    with pytest.raises(TypeError, match="iterable"):
        validate_curations("not a list")  # type: ignore[arg-type]


@pytest.mark.unit
def test_string_guides_raises_typeerror() -> None:
    """guides argument must be iterable too — same refusal."""
    with pytest.raises(TypeError, match="iterable"):
        validate_curations(
            [],
            guides="not a list",  # type: ignore[arg-type]
        )


# ---------------------------------------------------------------------------
# ValidationError record properties (shared with validate_guides)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_validation_error_records_remain_immutable() -> None:
    err = ValidationError(
        index=0,
        field="headline",
        message="headline: missing",
    )
    with pytest.raises(dataclasses.FrozenInstanceError):
        err.field = "summary"  # type: ignore[misc]
