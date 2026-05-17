"""Tests for :func:`content.integrity.validate_guides` (Sub-AC 4.1).

The validator's contract:
  1. Returns a list of :class:`ValidationError`, never raises on per-item
     defects.
  2. Reports every missing required field, not just the first one.
  3. Accepts both fully-constructed :class:`Guide` objects (runtime
     catalogue) and raw dict payloads (CMS-rewrite input).
  4. Reports invalid image paths when an ``image_path`` field is present.
  5. Reports invalid palette hex codes.
  6. Returns an empty list for the real 16-guide catalogue — the
     integrity gate must agree with the constructor's already-validated
     surface, otherwise the gate contradicts itself.

The test module is pure-data + pure-Python, so every test is
``@pytest.mark.unit``.
"""

from __future__ import annotations

import pytest

from content.guides import (
    Guide,
    GuideCategory,
    load_all_guides,
)
from content.integrity import (
    ALLOWED_IMAGE_EXTENSIONS,
    REQUIRED_FIELDS,
    ValidationError,
    validate_guides,
)
from personal_color.season_classifier import Season


# ---------------------------------------------------------------------------
# Happy path — the live catalogue must pass
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_real_catalogue_passes_integrity_check() -> None:
    """The 16-guide catalogue is the canonical clean reference set."""
    errors = validate_guides(load_all_guides())
    assert errors == [], (
        f"runtime catalogue must be clean, got defects: {errors}"
    )


@pytest.mark.unit
def test_empty_input_returns_empty_error_list() -> None:
    """No items → no defects. Validator must not invent errors."""
    assert validate_guides([]) == []
    assert validate_guides(()) == []


@pytest.mark.unit
def test_returns_list_not_generator() -> None:
    """Callers index the result for diagnostics; must be a concrete list."""
    result = validate_guides([])
    assert isinstance(result, list)


# ---------------------------------------------------------------------------
# Missing required fields — the headline AC
# ---------------------------------------------------------------------------


def _valid_dict_guide(**overrides: object) -> dict[str, object]:
    """Return a minimal-valid raw guide dict for mutation in tests."""
    base: dict[str, object] = {
        "season": Season.SPRING,
        "category": GuideCategory.MAKEUP,
        "title": "봄 웜톤 — 테스트 가이드",
        "summary": "테스트 요약입니다.",
        "body": "테스트 본문 한 줄.",
        "palette": ("#FFC7B0",),
    }
    base.update(overrides)
    return base


@pytest.mark.unit
def test_missing_required_field_is_reported() -> None:
    """Removing one required field should produce exactly one defect."""
    guide = _valid_dict_guide()
    del guide["title"]
    errors = validate_guides([guide])
    assert len(errors) == 1
    assert errors[0].index == 0
    assert errors[0].field == "title"
    assert "required" in errors[0].message


@pytest.mark.unit
def test_all_missing_required_fields_are_reported_at_once() -> None:
    """The validator must surface every defect — not stop at the first."""
    empty: dict[str, object] = {}
    errors = validate_guides([empty])
    reported_fields = {e.field for e in errors}
    assert set(REQUIRED_FIELDS).issubset(reported_fields), (
        f"expected all of {REQUIRED_FIELDS} to be reported, "
        f"got {sorted(reported_fields)}"
    )


@pytest.mark.unit
def test_none_required_field_counts_as_missing() -> None:
    """A field present-but-None is the same defect as field-absent."""
    guide = _valid_dict_guide()
    guide["body"] = None
    errors = validate_guides([guide])
    assert any(e.field == "body" for e in errors)


@pytest.mark.unit
def test_empty_string_required_field_is_reported() -> None:
    """Whitespace-only required strings are defects, not pass-throughs."""
    guide = _valid_dict_guide()
    guide["summary"] = "   "
    errors = validate_guides([guide])
    assert any(e.field == "summary" for e in errors)


@pytest.mark.unit
def test_wrong_type_for_string_required_field_is_reported() -> None:
    """Non-string title is a structural defect."""
    guide = _valid_dict_guide()
    guide["title"] = 42
    errors = validate_guides([guide])
    assert any(e.field == "title" and "string" in e.message for e in errors)


# ---------------------------------------------------------------------------
# Image-path validation
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize("ext", list(ALLOWED_IMAGE_EXTENSIONS))
def test_valid_image_path_extensions_pass(ext: str) -> None:
    guide = _valid_dict_guide(image_path=f"assets/spring/hero{ext}")
    errors = validate_guides([guide])
    image_errors = [e for e in errors if e.field == "image_path"]
    assert image_errors == []


@pytest.mark.unit
def test_image_path_with_disallowed_extension_is_reported() -> None:
    guide = _valid_dict_guide(image_path="assets/spring/hero.gif")
    errors = validate_guides([guide])
    assert any(e.field == "image_path" for e in errors)


@pytest.mark.unit
def test_image_path_with_no_extension_is_reported() -> None:
    guide = _valid_dict_guide(image_path="assets/spring/hero")
    errors = validate_guides([guide])
    assert any(e.field == "image_path" for e in errors)


@pytest.mark.unit
def test_image_path_with_backslash_is_reported() -> None:
    """Windows-style backslash paths must be rejected (bundle integrity)."""
    guide = _valid_dict_guide(image_path="assets\\spring\\hero.png")
    errors = validate_guides([guide])
    assert any(e.field == "image_path" for e in errors)


@pytest.mark.unit
def test_remote_url_image_path_is_reported() -> None:
    """HTTP(S) URLs must be rejected — assets are bundled, not fetched."""
    guide = _valid_dict_guide(image_path="https://cdn.example.com/hero.png")
    errors = validate_guides([guide])
    assert any(e.field == "image_path" for e in errors)


@pytest.mark.unit
def test_empty_image_path_is_reported() -> None:
    guide = _valid_dict_guide(image_path="")
    errors = validate_guides([guide])
    assert any(e.field == "image_path" for e in errors)


@pytest.mark.unit
def test_non_string_image_path_is_reported() -> None:
    guide = _valid_dict_guide(image_path=123)
    errors = validate_guides([guide])
    assert any(e.field == "image_path" for e in errors)


@pytest.mark.unit
def test_absent_image_path_is_accepted() -> None:
    """``image_path`` is optional — its absence must not flag a defect."""
    guide = _valid_dict_guide()  # no image_path key
    assert "image_path" not in guide
    errors = validate_guides([guide])
    image_errors = [e for e in errors if e.field == "image_path"]
    assert image_errors == []


# ---------------------------------------------------------------------------
# Palette and enum validation
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_invalid_hex_in_palette_is_reported() -> None:
    guide = _valid_dict_guide(palette=("#FFC7B0", "not-a-hex"))
    errors = validate_guides([guide])
    assert any(e.field == "palette[1]" for e in errors)


@pytest.mark.unit
def test_palette_non_iterable_type_is_reported() -> None:
    guide = _valid_dict_guide(palette="just-a-string")
    errors = validate_guides([guide])
    assert any(e.field == "palette" for e in errors)


@pytest.mark.unit
def test_season_slug_is_accepted() -> None:
    """CMS payloads commonly carry slugs, not enums."""
    guide = _valid_dict_guide(season="spring")
    errors = validate_guides([guide])
    season_errors = [e for e in errors if e.field == "season"]
    assert season_errors == []


@pytest.mark.unit
def test_season_korean_label_is_accepted() -> None:
    guide = _valid_dict_guide(season="봄")
    errors = validate_guides([guide])
    season_errors = [e for e in errors if e.field == "season"]
    assert season_errors == []


@pytest.mark.unit
def test_unknown_season_is_reported() -> None:
    guide = _valid_dict_guide(season="autumn-winter")
    errors = validate_guides([guide])
    assert any(e.field == "season" for e in errors)


@pytest.mark.unit
def test_unknown_category_is_reported() -> None:
    guide = _valid_dict_guide(category="lipstick")
    errors = validate_guides([guide])
    assert any(e.field == "category" for e in errors)


@pytest.mark.unit
def test_category_korean_label_is_accepted() -> None:
    guide = _valid_dict_guide(category="메이크업")
    errors = validate_guides([guide])
    cat_errors = [e for e in errors if e.field == "category"]
    assert cat_errors == []


# ---------------------------------------------------------------------------
# Cross-item — defect index tracking
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_defect_index_reflects_input_position() -> None:
    """Errors must carry the offending item's index, in input order."""
    good = _valid_dict_guide()
    bad = _valid_dict_guide()
    del bad["title"]
    errors = validate_guides([good, bad, good])
    assert len(errors) == 1
    assert errors[0].index == 1
    assert errors[0].field == "title"


@pytest.mark.unit
def test_multiple_items_each_get_their_own_errors() -> None:
    a = _valid_dict_guide()
    del a["body"]
    b = _valid_dict_guide()
    del b["summary"]
    errors = validate_guides([a, b])
    by_index = {e.index: e.field for e in errors}
    assert by_index == {0: "body", 1: "summary"}


# ---------------------------------------------------------------------------
# Guide-object inputs work too (mixed with dicts)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_guide_dataclass_passes() -> None:
    guide_obj = load_all_guides()[0]
    assert isinstance(guide_obj, Guide)
    assert validate_guides([guide_obj]) == []


@pytest.mark.unit
def test_mixed_input_types_are_supported() -> None:
    """Validator must accept Guide and dict in the same list."""
    guide_obj = load_all_guides()[0]
    raw = _valid_dict_guide()
    errors = validate_guides([guide_obj, raw])
    assert errors == []


# ---------------------------------------------------------------------------
# Outer-type input validation — Validator-level argument errors
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_none_input_raises_typeerror() -> None:
    with pytest.raises(TypeError, match="iterable"):
        validate_guides(None)  # type: ignore[arg-type]


@pytest.mark.unit
def test_string_input_raises_typeerror() -> None:
    """A bare string would iterate character-by-character — refuse it."""
    with pytest.raises(TypeError, match="iterable"):
        validate_guides("not a list")  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# ValidationError is a hashable frozen dataclass (Seed integrity ontology)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_validation_error_is_hashable() -> None:
    err = ValidationError(index=0, field="title", message="title: missing")
    assert hash(err) == hash(
        ValidationError(index=0, field="title", message="title: missing"),
    )


@pytest.mark.unit
def test_validation_error_is_immutable() -> None:
    import dataclasses

    err = ValidationError(index=0, field="title", message="title: missing")
    with pytest.raises(dataclasses.FrozenInstanceError):
        err.field = "summary"  # type: ignore[misc]
