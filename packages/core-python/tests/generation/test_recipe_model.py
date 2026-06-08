"""Unit tests for ``generation.recipe_model`` (Sub-AC 6.1).

Acceptance criterion (Sub-AC 6.1) being verified
-------------------------------------------------
    RecipeModel 스키마 정의 및 단위 검증 — Pydantic(또는 JSON Schema) 기반
    RecipeModel 클래스와 ``validate_recipe(data: dict) -> RecipeModel`` 함수
    구현. 테스트: 필수 필드 완비 시 통과, 필수 필드 누락 시 ValidationError,
    잘못된 타입 시 ValidationError.

Test coverage
-------------
1. **Happy path** — all required fields present → ``RecipeModel`` returned.
2. **Missing required fields** — each required field omitted individually
   → ``ValidationError`` raised.
3. **Wrong type** — e.g. ``candidate_count`` given as a string, ``active``
   given as a string, ``style_params`` given as a list → ``ValidationError``.
4. **Optional fields default** — ``enhancer_overrides`` and
   ``reject_threshold_overrides`` default to ``None`` when absent.
5. **Optional fields accepted** — optional fields present with valid values.
6. **Constraint violations** — ``candidate_count < 1`` → ``ValidationError``.
7. **Immutability** — mutating a field on a constructed ``RecipeModel``
   raises an exception (frozen Pydantic model).
8. **Empty required strings** — empty-string values for required string
   fields → ``ValidationError``.
9. **validate_recipe returns RecipeModel** — the public wrapper function
   returns the same type as constructing the model directly.
10. **personal_color_modifiers** — empty dict is valid (all-users recipe).
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from generation.recipe_model import RecipeModel, validate_recipe

# ---------------------------------------------------------------------------
# Shared fixture: a minimal valid recipe payload
# ---------------------------------------------------------------------------

_VALID_PAYLOAD: dict = {
    "recipe_id": "recipe_trend001_1",
    "trend_id": "trend001",
    "prompt_template": "A selfie of a {personal_color_modifier} person.",
    "style_params": {"model": "flux", "strength": 0.75},
    "personal_color_modifiers": {"봄": "warm spring", "겨울": "cool winter"},
    "candidate_count": 4,
    "created_by": "operator_singleton",
    "created_at": "2026-06-01T09:00:00Z",
    "active": True,
}


def _payload(**overrides) -> dict:
    """Return a copy of _VALID_PAYLOAD with the given overrides applied."""
    return {**_VALID_PAYLOAD, **overrides}


def _payload_without(*keys: str) -> dict:
    """Return a copy of _VALID_PAYLOAD with the given keys removed."""
    p = dict(_VALID_PAYLOAD)
    for k in keys:
        p.pop(k, None)
    return p


# ---------------------------------------------------------------------------
# 1. Happy path
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_validate_recipe_passes_with_all_required_fields() -> None:
    """validate_recipe returns RecipeModel when all required fields are present."""
    recipe = validate_recipe(_VALID_PAYLOAD)

    assert isinstance(recipe, RecipeModel)
    assert recipe.recipe_id == "recipe_trend001_1"
    assert recipe.trend_id == "trend001"
    assert recipe.candidate_count == 4
    assert recipe.active is True


@pytest.mark.unit
def test_recipe_model_construct_directly_passes() -> None:
    """RecipeModel can be constructed directly from keyword arguments."""
    recipe = RecipeModel(**_VALID_PAYLOAD)
    assert recipe.recipe_id == "recipe_trend001_1"


# ---------------------------------------------------------------------------
# 2. Missing required fields → ValidationError
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize(
    "missing_field",
    [
        "recipe_id",
        "trend_id",
        "prompt_template",
        "style_params",
        "personal_color_modifiers",
        "candidate_count",
        "created_by",
        "created_at",
        "active",
    ],
)
def test_validate_recipe_raises_validation_error_on_missing_required_field(
    missing_field: str,
) -> None:
    """Omitting any required field raises pydantic.ValidationError."""
    data = _payload_without(missing_field)
    with pytest.raises(ValidationError) as exc_info:
        validate_recipe(data)

    # The error should mention the missing field name.
    error_str = str(exc_info.value)
    assert missing_field in error_str, (
        f"ValidationError should mention '{missing_field}'; "
        f"got: {error_str[:300]}"
    )


# ---------------------------------------------------------------------------
# 3. Wrong type → ValidationError
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_validate_recipe_raises_on_wrong_type_candidate_count_string() -> None:
    """candidate_count as a non-numeric string raises ValidationError."""
    with pytest.raises(ValidationError):
        validate_recipe(_payload(candidate_count="many"))


@pytest.mark.unit
def test_validate_recipe_raises_on_wrong_type_active_arbitrary_string() -> None:
    """active as an arbitrary string that cannot be coerced to bool raises ValidationError."""
    # Note: Pydantic v2 coerces "true"/"false"/"1"/"0" to bool. Use a value
    # that cannot be interpreted as bool to guarantee a ValidationError.
    with pytest.raises(ValidationError):
        validate_recipe(_payload(active="yes_please"))


@pytest.mark.unit
def test_validate_recipe_raises_on_wrong_type_style_params_list() -> None:
    """style_params as a list (not a dict) raises ValidationError."""
    with pytest.raises(ValidationError):
        validate_recipe(_payload(style_params=["flux", "strength"]))


@pytest.mark.unit
def test_validate_recipe_raises_on_wrong_type_personal_color_modifiers_string() -> None:
    """personal_color_modifiers as a plain string raises ValidationError."""
    with pytest.raises(ValidationError):
        validate_recipe(_payload(personal_color_modifiers="봄:warm"))


@pytest.mark.unit
def test_validate_recipe_raises_on_wrong_type_candidate_count_float_string() -> None:
    """candidate_count as a non-integer string raises ValidationError."""
    with pytest.raises(ValidationError):
        validate_recipe(_payload(candidate_count="3.5"))


# ---------------------------------------------------------------------------
# 4. Optional fields default to None when absent
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_validate_recipe_enhancer_overrides_defaults_to_none() -> None:
    """enhancer_overrides defaults to None when not provided."""
    recipe = validate_recipe(_VALID_PAYLOAD)
    assert recipe.enhancer_overrides is None


@pytest.mark.unit
def test_validate_recipe_reject_threshold_overrides_defaults_to_none() -> None:
    """reject_threshold_overrides defaults to None when not provided."""
    recipe = validate_recipe(_VALID_PAYLOAD)
    assert recipe.reject_threshold_overrides is None


# ---------------------------------------------------------------------------
# 5. Optional fields accepted when provided
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_validate_recipe_accepts_enhancer_overrides() -> None:
    """enhancer_overrides dict is accepted and preserved."""
    overrides = {"sharpness_factor": 1.5, "contrast_factor": 1.2}
    recipe = validate_recipe(_payload(enhancer_overrides=overrides))
    assert recipe.enhancer_overrides == overrides


@pytest.mark.unit
def test_validate_recipe_accepts_reject_threshold_overrides() -> None:
    """reject_threshold_overrides dict is accepted and preserved."""
    overrides = {"identity_threshold": 0.70, "uncanny_threshold": 0.40}
    recipe = validate_recipe(_payload(reject_threshold_overrides=overrides))
    assert recipe.reject_threshold_overrides == overrides


@pytest.mark.unit
def test_validate_recipe_accepts_none_for_optional_fields_explicitly() -> None:
    """Explicitly passing None for optional fields is accepted."""
    recipe = validate_recipe(
        _payload(enhancer_overrides=None, reject_threshold_overrides=None)
    )
    assert recipe.enhancer_overrides is None
    assert recipe.reject_threshold_overrides is None


# ---------------------------------------------------------------------------
# 6. Constraint violations → ValidationError
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_validate_recipe_raises_on_candidate_count_zero() -> None:
    """candidate_count=0 violates ge=1 constraint → ValidationError."""
    with pytest.raises(ValidationError) as exc_info:
        validate_recipe(_payload(candidate_count=0))
    assert "candidate_count" in str(exc_info.value)


@pytest.mark.unit
def test_validate_recipe_raises_on_candidate_count_negative() -> None:
    """Negative candidate_count raises ValidationError."""
    with pytest.raises(ValidationError):
        validate_recipe(_payload(candidate_count=-1))


@pytest.mark.unit
def test_validate_recipe_candidate_count_one_is_valid() -> None:
    """candidate_count=1 satisfies ge=1 and is valid."""
    recipe = validate_recipe(_payload(candidate_count=1))
    assert recipe.candidate_count == 1


# ---------------------------------------------------------------------------
# 7. Immutability (frozen model)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_recipe_model_is_immutable() -> None:
    """Setting a field on a constructed RecipeModel raises an exception."""
    recipe = validate_recipe(_VALID_PAYLOAD)
    with pytest.raises(Exception):
        recipe.recipe_id = "tampered"  # type: ignore[misc]


@pytest.mark.unit
def test_recipe_model_is_immutable_for_active_field() -> None:
    """Setting 'active' on a constructed RecipeModel raises an exception."""
    recipe = validate_recipe(_VALID_PAYLOAD)
    with pytest.raises(Exception):
        recipe.active = False  # type: ignore[misc]


# ---------------------------------------------------------------------------
# 8. Empty required strings → ValidationError
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize(
    "empty_str_field",
    ["recipe_id", "trend_id", "prompt_template", "created_by", "created_at"],
)
def test_validate_recipe_raises_on_empty_string_required_fields(
    empty_str_field: str,
) -> None:
    """Empty string for min_length=1 required fields raises ValidationError."""
    with pytest.raises(ValidationError) as exc_info:
        validate_recipe(_payload(**{empty_str_field: ""}))
    assert empty_str_field in str(exc_info.value)


# ---------------------------------------------------------------------------
# 9. validate_recipe wrapper contract
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_validate_recipe_returns_recipe_model_type() -> None:
    """validate_recipe always returns a RecipeModel instance."""
    result = validate_recipe(_VALID_PAYLOAD)
    assert type(result) is RecipeModel


@pytest.mark.unit
def test_validate_recipe_raises_validation_error_not_generic_error() -> None:
    """validate_recipe raises pydantic.ValidationError (not a generic Exception)."""
    with pytest.raises(ValidationError):
        validate_recipe({})  # completely empty dict


# ---------------------------------------------------------------------------
# 10. personal_color_modifiers edge cases
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_validate_recipe_accepts_empty_personal_color_modifiers() -> None:
    """Empty personal_color_modifiers dict is valid (all-users recipe)."""
    recipe = validate_recipe(_payload(personal_color_modifiers={}))
    assert recipe.personal_color_modifiers == {}


@pytest.mark.unit
def test_validate_recipe_accepts_all_four_seasons_in_modifiers() -> None:
    """personal_color_modifiers with all four seasons is accepted."""
    modifiers = {
        "봄": "warm spring bright",
        "여름": "cool summer soft",
        "가을": "warm autumn deep",
        "겨울": "cool winter clear",
    }
    recipe = validate_recipe(_payload(personal_color_modifiers=modifiers))
    assert len(recipe.personal_color_modifiers) == 4
    assert recipe.personal_color_modifiers["봄"] == "warm spring bright"


@pytest.mark.unit
def test_validate_recipe_personal_color_modifiers_wrong_value_type() -> None:
    """personal_color_modifiers with non-string values raises ValidationError."""
    with pytest.raises(ValidationError):
        validate_recipe(
            _payload(personal_color_modifiers={"봄": 123})  # value should be str
        )
