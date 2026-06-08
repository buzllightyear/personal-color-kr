"""Unit tests for ``generation.recipe_loader`` (Sub-AC 6.3.1 & 6.3.2).

Acceptance criterion (Sub-AC 6.3.1) being verified
----------------------------------------------------
``load_recipe_file(path: Path) -> RecipeModel`` 단일 파일 파서 + 스키마 검증 —
YAML/JSON 파일을 읽어 RecipeModel로 역직렬화하고 스키마 위반 시 ValidationError를
발생시키는 함수 구현.

Tests:
  1. 유효한 파일에서 올바른 RecipeModel 반환
  2. 필수 필드 누락 파일에서 ValidationError 발생
  3. 존재하지 않는 경로에서 FileNotFoundError 발생

Extended coverage
-----------------
1.  Valid JSON file → correct RecipeModel returned.
2.  Valid YAML file (.yaml extension) → correct RecipeModel returned.
3.  Valid YAML file (.yml extension) → correct RecipeModel returned.
4.  Non-existent JSON path → raises FileNotFoundError.
5.  Non-existent YAML path → raises FileNotFoundError.
6.  Broken JSON syntax → raises json.JSONDecodeError.
7.  Broken YAML syntax → raises yaml.YAMLError.
8.  Unsupported extension → raises ValueError.
9.  JSON file with nested recipe fields → nested values preserved on RecipeModel.
10. YAML file with recipe overrides → optional fields preserved on RecipeModel.
11. Case-insensitive extension matching (.JSON, .YAML).
12. Top-level non-dict YAML (e.g. a list) → raises ValueError.
13. Missing required field (schema violation) → raises pydantic.ValidationError.
14. Multiple missing fields → raises pydantic.ValidationError.
15. candidate_count < 1 (constraint violation) → raises pydantic.ValidationError.
16. Return type is always RecipeModel (not dict).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml
from pydantic import ValidationError

from generation.recipe_loader import discover_recipes, load_recipe_file
from generation.recipe_model import RecipeModel

# ---------------------------------------------------------------------------
# Shared fixture helpers
# ---------------------------------------------------------------------------

_MINIMAL_RECIPE: dict = {
    "recipe_id": "recipe_trend001_1",
    "trend_id": "trend001",
    "prompt_template": "A {personal_color_modifier} selfie.",
    "style_params": {"model": "flux", "strength": 0.75},
    "personal_color_modifiers": {"봄": "warm spring"},
    "candidate_count": 4,
    "created_by": "operator_singleton",
    "created_at": "2026-06-01T09:00:00Z",
    "active": True,
}


# ---------------------------------------------------------------------------
# 1. Valid JSON file → correct RecipeModel returned
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_load_recipe_file_valid_json_returns_recipe_model(tmp_path: Path) -> None:
    """A syntactically valid JSON recipe file is parsed and validated into RecipeModel."""
    recipe_file = tmp_path / "recipe.json"
    recipe_file.write_text(json.dumps(_MINIMAL_RECIPE), encoding="utf-8")

    result = load_recipe_file(recipe_file)

    assert isinstance(result, RecipeModel)
    assert result.recipe_id == "recipe_trend001_1"
    assert result.trend_id == "trend001"
    assert result.candidate_count == 4
    assert result.active is True


@pytest.mark.unit
def test_load_recipe_file_valid_json_preserves_nested_values(tmp_path: Path) -> None:
    """Nested dict values inside JSON are preserved on the returned RecipeModel."""
    recipe_file = tmp_path / "recipe.json"
    recipe_file.write_text(json.dumps(_MINIMAL_RECIPE), encoding="utf-8")

    result = load_recipe_file(recipe_file)

    assert result.style_params == {"model": "flux", "strength": 0.75}
    assert result.personal_color_modifiers == {"봄": "warm spring"}


# ---------------------------------------------------------------------------
# 2. Valid YAML file (.yaml extension) → correct RecipeModel returned
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_load_recipe_file_valid_yaml_returns_recipe_model(tmp_path: Path) -> None:
    """A syntactically valid YAML recipe file (.yaml) is parsed into RecipeModel."""
    recipe_file = tmp_path / "recipe.yaml"
    recipe_file.write_text(
        yaml.dump(_MINIMAL_RECIPE, allow_unicode=True), encoding="utf-8"
    )

    result = load_recipe_file(recipe_file)

    assert isinstance(result, RecipeModel)
    assert result.recipe_id == "recipe_trend001_1"
    assert result.trend_id == "trend001"
    assert result.candidate_count == 4


@pytest.mark.unit
def test_load_recipe_file_valid_yaml_preserves_unicode(tmp_path: Path) -> None:
    """Korean unicode values in YAML are preserved correctly on the RecipeModel."""
    recipe_file = tmp_path / "recipe.yaml"
    recipe_file.write_text(
        yaml.dump(_MINIMAL_RECIPE, allow_unicode=True), encoding="utf-8"
    )

    result = load_recipe_file(recipe_file)

    assert result.personal_color_modifiers == {"봄": "warm spring"}


# ---------------------------------------------------------------------------
# 3. Valid YAML file (.yml extension) → correct RecipeModel returned
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_load_recipe_file_valid_yml_extension_returns_recipe_model(
    tmp_path: Path,
) -> None:
    """A valid YAML recipe file with .yml extension is accepted and validated."""
    recipe_file = tmp_path / "recipe.yml"
    recipe_file.write_text(
        yaml.dump(_MINIMAL_RECIPE, allow_unicode=True), encoding="utf-8"
    )

    result = load_recipe_file(recipe_file)

    assert isinstance(result, RecipeModel)
    assert result.recipe_id == "recipe_trend001_1"


# ---------------------------------------------------------------------------
# 4 & 5. Non-existent file → FileNotFoundError  (AC 6.3.1 test 3)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_load_recipe_file_nonexistent_json_raises_file_not_found(
    tmp_path: Path,
) -> None:
    """A non-existent JSON path raises FileNotFoundError."""
    missing = tmp_path / "missing_recipe.json"

    with pytest.raises(FileNotFoundError):
        load_recipe_file(missing)


@pytest.mark.unit
def test_load_recipe_file_nonexistent_yaml_raises_file_not_found(
    tmp_path: Path,
) -> None:
    """A non-existent YAML path raises FileNotFoundError."""
    missing = tmp_path / "missing_recipe.yaml"

    with pytest.raises(FileNotFoundError):
        load_recipe_file(missing)


@pytest.mark.unit
def test_load_recipe_file_nonexistent_yml_raises_file_not_found(tmp_path: Path) -> None:
    """A non-existent .yml path raises FileNotFoundError."""
    missing = tmp_path / "missing_recipe.yml"

    with pytest.raises(FileNotFoundError):
        load_recipe_file(missing)


# ---------------------------------------------------------------------------
# 6. Broken JSON syntax → json.JSONDecodeError
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_load_recipe_file_broken_json_raises_json_decode_error(tmp_path: Path) -> None:
    """A JSON file with broken syntax raises json.JSONDecodeError."""
    broken_json = tmp_path / "broken.json"
    broken_json.write_text('{"recipe_id": "r1", "trend_id":}', encoding="utf-8")

    with pytest.raises(json.JSONDecodeError):
        load_recipe_file(broken_json)


@pytest.mark.unit
def test_load_recipe_file_truncated_json_raises_json_decode_error(
    tmp_path: Path,
) -> None:
    """A truncated JSON file (unclosed brace) raises json.JSONDecodeError."""
    truncated_json = tmp_path / "truncated.json"
    truncated_json.write_text('{"recipe_id": "r1"', encoding="utf-8")

    with pytest.raises(json.JSONDecodeError):
        load_recipe_file(truncated_json)


# ---------------------------------------------------------------------------
# 7. Broken YAML syntax → yaml.YAMLError
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_load_recipe_file_broken_yaml_raises_yaml_error(tmp_path: Path) -> None:
    """A YAML file with broken syntax raises yaml.YAMLError."""
    broken_yaml = tmp_path / "broken.yaml"
    # Indentation error in YAML
    broken_yaml.write_text(
        "recipe_id: recipe_001\n  bad_indent_here: [unclosed\n",
        encoding="utf-8",
    )

    with pytest.raises(yaml.YAMLError):
        load_recipe_file(broken_yaml)


@pytest.mark.unit
def test_load_recipe_file_broken_yml_syntax_raises_yaml_error(tmp_path: Path) -> None:
    """A .yml file with tab-indented syntax raises yaml.YAMLError."""
    broken_yml = tmp_path / "broken.yml"
    # YAML does not allow tabs for indentation
    broken_yml.write_text(
        "recipe_id: ok\nstyle_params:\n\tmodel: flux\n",
        encoding="utf-8",
    )

    with pytest.raises(yaml.YAMLError):
        load_recipe_file(broken_yml)


# ---------------------------------------------------------------------------
# 8. Unsupported extension → ValueError
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_load_recipe_file_unsupported_extension_raises_value_error(
    tmp_path: Path,
) -> None:
    """A file with an unsupported extension raises ValueError before reading."""
    toml_file = tmp_path / "recipe.toml"
    toml_file.write_text('recipe_id = "r1"\n', encoding="utf-8")

    with pytest.raises(ValueError, match="Unsupported recipe file extension"):
        load_recipe_file(toml_file)


@pytest.mark.unit
def test_load_recipe_file_txt_extension_raises_value_error(tmp_path: Path) -> None:
    """A plain .txt file raises ValueError."""
    txt_file = tmp_path / "recipe.txt"
    txt_file.write_text("some text", encoding="utf-8")

    with pytest.raises(ValueError, match="Unsupported recipe file extension"):
        load_recipe_file(txt_file)


# ---------------------------------------------------------------------------
# 9. JSON with recipe overrides (optional fields) preserved on RecipeModel
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_load_recipe_file_json_with_optional_overrides(tmp_path: Path) -> None:
    """JSON recipe with optional overrides fields produces correct RecipeModel."""
    full_recipe = {
        **_MINIMAL_RECIPE,
        "enhancer_overrides": {"sharpness_factor": 1.5},
        "reject_threshold_overrides": {"identity_threshold": 0.70},
    }
    recipe_file = tmp_path / "recipe_full.json"
    recipe_file.write_text(json.dumps(full_recipe), encoding="utf-8")

    result = load_recipe_file(recipe_file)

    assert result.enhancer_overrides == {"sharpness_factor": 1.5}
    assert result.reject_threshold_overrides == {"identity_threshold": 0.70}


# ---------------------------------------------------------------------------
# 10. YAML with recipe overrides preserved on RecipeModel
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_load_recipe_file_yaml_with_optional_overrides(tmp_path: Path) -> None:
    """YAML recipe with optional overrides fields produces correct RecipeModel."""
    full_recipe = {
        **_MINIMAL_RECIPE,
        "enhancer_overrides": {"contrast_factor": 1.2},
        "reject_threshold_overrides": {"uncanny_threshold": 0.40},
    }
    recipe_file = tmp_path / "recipe_full.yaml"
    recipe_file.write_text(yaml.dump(full_recipe, allow_unicode=True), encoding="utf-8")

    result = load_recipe_file(recipe_file)

    assert result.enhancer_overrides == {"contrast_factor": 1.2}
    assert result.reject_threshold_overrides == {"uncanny_threshold": 0.40}


# ---------------------------------------------------------------------------
# 11. Case-insensitive extension matching
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_load_recipe_file_case_insensitive_json_extension(tmp_path: Path) -> None:
    """Upper-case .JSON extension is treated as JSON and returns RecipeModel."""
    recipe_file = tmp_path / "recipe.JSON"
    recipe_file.write_text(json.dumps(_MINIMAL_RECIPE), encoding="utf-8")

    result = load_recipe_file(recipe_file)

    assert isinstance(result, RecipeModel)
    assert result.recipe_id == "recipe_trend001_1"


@pytest.mark.unit
def test_load_recipe_file_case_insensitive_yaml_extension(tmp_path: Path) -> None:
    """Upper-case .YAML extension is treated as YAML and returns RecipeModel."""
    recipe_file = tmp_path / "recipe.YAML"
    recipe_file.write_text(
        yaml.dump(_MINIMAL_RECIPE, allow_unicode=True), encoding="utf-8"
    )

    result = load_recipe_file(recipe_file)

    assert isinstance(result, RecipeModel)
    assert result.recipe_id == "recipe_trend001_1"


# ---------------------------------------------------------------------------
# 12. Top-level non-dict content → ValueError
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_load_recipe_file_yaml_list_at_top_level_raises_value_error(
    tmp_path: Path,
) -> None:
    """A YAML file that parses to a list (not a dict) raises ValueError."""
    list_yaml = tmp_path / "list_recipe.yaml"
    list_yaml.write_text("- recipe_id: r1\n- recipe_id: r2\n", encoding="utf-8")

    with pytest.raises(ValueError, match="did not parse to a dict"):
        load_recipe_file(list_yaml)


@pytest.mark.unit
def test_load_recipe_file_json_array_at_top_level_raises_value_error(
    tmp_path: Path,
) -> None:
    """A JSON file containing a top-level array raises ValueError."""
    array_json = tmp_path / "array_recipe.json"
    array_json.write_text('[{"recipe_id": "r1"}]', encoding="utf-8")

    with pytest.raises(ValueError, match="did not parse to a dict"):
        load_recipe_file(array_json)


# ---------------------------------------------------------------------------
# 13. Missing required field → pydantic.ValidationError  (AC 6.3.1 test 2)
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
def test_load_recipe_file_missing_required_field_raises_validation_error(
    tmp_path: Path,
    missing_field: str,
) -> None:
    """A recipe file missing any required field raises pydantic.ValidationError."""
    incomplete = {k: v for k, v in _MINIMAL_RECIPE.items() if k != missing_field}
    recipe_file = tmp_path / "incomplete.json"
    recipe_file.write_text(json.dumps(incomplete), encoding="utf-8")

    with pytest.raises(ValidationError) as exc_info:
        load_recipe_file(recipe_file)

    # The ValidationError must identify the missing field.
    assert missing_field in str(exc_info.value), (
        f"ValidationError should mention '{missing_field}'; "
        f"got: {str(exc_info.value)[:300]}"
    )


@pytest.mark.unit
def test_load_recipe_file_missing_required_field_yaml_raises_validation_error(
    tmp_path: Path,
) -> None:
    """A YAML recipe file missing 'trend_id' raises pydantic.ValidationError."""
    incomplete = {k: v for k, v in _MINIMAL_RECIPE.items() if k != "trend_id"}
    recipe_file = tmp_path / "incomplete.yaml"
    recipe_file.write_text(yaml.dump(incomplete, allow_unicode=True), encoding="utf-8")

    with pytest.raises(ValidationError) as exc_info:
        load_recipe_file(recipe_file)

    assert "trend_id" in str(exc_info.value)


@pytest.mark.unit
def test_load_recipe_file_empty_dict_raises_validation_error(tmp_path: Path) -> None:
    """A JSON recipe file with an empty dict raises pydantic.ValidationError."""
    recipe_file = tmp_path / "empty.json"
    recipe_file.write_text("{}", encoding="utf-8")

    with pytest.raises(ValidationError):
        load_recipe_file(recipe_file)


# ---------------------------------------------------------------------------
# 14. Multiple missing fields → pydantic.ValidationError
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_load_recipe_file_multiple_missing_fields_raises_validation_error(
    tmp_path: Path,
) -> None:
    """A recipe file missing multiple required fields raises pydantic.ValidationError."""
    # Only recipe_id and trend_id present — rest missing
    minimal = {"recipe_id": "r1", "trend_id": "t1"}
    recipe_file = tmp_path / "minimal.json"
    recipe_file.write_text(json.dumps(minimal), encoding="utf-8")

    with pytest.raises(ValidationError):
        load_recipe_file(recipe_file)


# ---------------------------------------------------------------------------
# 15. Constraint violation (candidate_count < 1) → pydantic.ValidationError
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_load_recipe_file_candidate_count_zero_raises_validation_error(
    tmp_path: Path,
) -> None:
    """A recipe file with candidate_count=0 raises pydantic.ValidationError."""
    bad_recipe = {**_MINIMAL_RECIPE, "candidate_count": 0}
    recipe_file = tmp_path / "bad_count.json"
    recipe_file.write_text(json.dumps(bad_recipe), encoding="utf-8")

    with pytest.raises(ValidationError) as exc_info:
        load_recipe_file(recipe_file)

    assert "candidate_count" in str(exc_info.value)


@pytest.mark.unit
def test_load_recipe_file_candidate_count_negative_raises_validation_error(
    tmp_path: Path,
) -> None:
    """A recipe file with candidate_count=-1 raises pydantic.ValidationError."""
    bad_recipe = {**_MINIMAL_RECIPE, "candidate_count": -1}
    recipe_file = tmp_path / "negative_count.yaml"
    recipe_file.write_text(yaml.dump(bad_recipe, allow_unicode=True), encoding="utf-8")

    with pytest.raises(ValidationError):
        load_recipe_file(recipe_file)


# ---------------------------------------------------------------------------
# 16. Return type contract — always RecipeModel, never dict
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_load_recipe_file_return_type_is_recipe_model(tmp_path: Path) -> None:
    """load_recipe_file always returns a RecipeModel instance, never a dict."""
    recipe_file = tmp_path / "recipe.json"
    recipe_file.write_text(json.dumps(_MINIMAL_RECIPE), encoding="utf-8")

    result = load_recipe_file(recipe_file)

    assert type(result) is RecipeModel
    assert not isinstance(result, dict)


@pytest.mark.unit
def test_load_recipe_file_returned_model_is_immutable(tmp_path: Path) -> None:
    """The RecipeModel returned by load_recipe_file is immutable (frozen)."""
    recipe_file = tmp_path / "recipe.yaml"
    recipe_file.write_text(
        yaml.dump(_MINIMAL_RECIPE, allow_unicode=True), encoding="utf-8"
    )

    result = load_recipe_file(recipe_file)

    with pytest.raises(Exception):
        result.recipe_id = "tampered"  # type: ignore[misc]


@pytest.mark.unit
def test_load_recipe_file_optional_fields_default_to_none(tmp_path: Path) -> None:
    """Absent optional fields (enhancer_overrides, reject_threshold_overrides) default to None."""
    recipe_file = tmp_path / "recipe.json"
    recipe_file.write_text(json.dumps(_MINIMAL_RECIPE), encoding="utf-8")

    result = load_recipe_file(recipe_file)

    assert result.enhancer_overrides is None
    assert result.reject_threshold_overrides is None


# ===========================================================================
# discover_recipes (Sub-AC 6.3.2) tests
# ===========================================================================

# Helpers — distinct recipe dicts for multi-file tests.

_RECIPE_A: dict = {
    **_MINIMAL_RECIPE,
    "recipe_id": "recipe_trend_a_1",
    "trend_id": "trend_a",
}

_RECIPE_B: dict = {
    **_MINIMAL_RECIPE,
    "recipe_id": "recipe_trend_b_1",
    "trend_id": "trend_b",
}

_RECIPE_C: dict = {
    **_MINIMAL_RECIPE,
    "recipe_id": "recipe_trend_c_1",
    "trend_id": "trend_c",
}


# ---------------------------------------------------------------------------
# Sub-AC 6.3.2 — Test 1:
# 복수 유효 파일 포함 디렉터리에서 전체 RecipeModel 목록 반환
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_discover_recipes_multiple_files_returns_all_models(tmp_path: Path) -> None:
    """discover_recipes returns one RecipeModel per file for a multi-file directory."""
    # Write three recipe files in different supported formats.
    (tmp_path / "recipe_a.json").write_text(json.dumps(_RECIPE_A), encoding="utf-8")
    (tmp_path / "recipe_b.yaml").write_text(
        yaml.dump(_RECIPE_B, allow_unicode=True), encoding="utf-8"
    )
    (tmp_path / "recipe_c.yml").write_text(
        yaml.dump(_RECIPE_C, allow_unicode=True), encoding="utf-8"
    )

    results = discover_recipes(tmp_path)

    assert len(results) == 3
    assert all(isinstance(r, RecipeModel) for r in results)


@pytest.mark.unit
def test_discover_recipes_multiple_files_contains_all_recipe_ids(
    tmp_path: Path,
) -> None:
    """discover_recipes returns models with the correct recipe_ids from all files."""
    (tmp_path / "recipe_a.json").write_text(json.dumps(_RECIPE_A), encoding="utf-8")
    (tmp_path / "recipe_b.yaml").write_text(
        yaml.dump(_RECIPE_B, allow_unicode=True), encoding="utf-8"
    )

    results = discover_recipes(tmp_path)
    recipe_ids = {r.recipe_id for r in results}

    assert "recipe_trend_a_1" in recipe_ids
    assert "recipe_trend_b_1" in recipe_ids


@pytest.mark.unit
def test_discover_recipes_two_json_files_returns_two_models(tmp_path: Path) -> None:
    """discover_recipes with two JSON files returns exactly two RecipeModel instances."""
    (tmp_path / "alpha.json").write_text(json.dumps(_RECIPE_A), encoding="utf-8")
    (tmp_path / "beta.json").write_text(json.dumps(_RECIPE_B), encoding="utf-8")

    results = discover_recipes(tmp_path)

    assert len(results) == 2
    assert all(isinstance(r, RecipeModel) for r in results)


@pytest.mark.unit
def test_discover_recipes_two_yaml_files_returns_two_models(tmp_path: Path) -> None:
    """discover_recipes with two YAML files returns exactly two RecipeModel instances."""
    (tmp_path / "alpha.yaml").write_text(
        yaml.dump(_RECIPE_A, allow_unicode=True), encoding="utf-8"
    )
    (tmp_path / "beta.yaml").write_text(
        yaml.dump(_RECIPE_B, allow_unicode=True), encoding="utf-8"
    )

    results = discover_recipes(tmp_path)

    assert len(results) == 2


# ---------------------------------------------------------------------------
# Sub-AC 6.3.2 — Test 2:
# 새 파일 추가 후 재탐색 시 해당 recipe 포함 확인
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_discover_recipes_new_file_included_on_rediscovery(tmp_path: Path) -> None:
    """After writing a new recipe file, a second discover_recipes call includes it."""
    (tmp_path / "recipe_a.json").write_text(json.dumps(_RECIPE_A), encoding="utf-8")

    first_pass = discover_recipes(tmp_path)
    assert len(first_pass) == 1
    assert first_pass[0].recipe_id == "recipe_trend_a_1"

    # Add a second recipe file.
    (tmp_path / "recipe_b.yaml").write_text(
        yaml.dump(_RECIPE_B, allow_unicode=True), encoding="utf-8"
    )

    second_pass = discover_recipes(tmp_path)
    recipe_ids = {r.recipe_id for r in second_pass}

    assert len(second_pass) == 2
    assert "recipe_trend_a_1" in recipe_ids
    assert "recipe_trend_b_1" in recipe_ids


@pytest.mark.unit
def test_discover_recipes_adding_yml_file_included_on_rediscovery(
    tmp_path: Path,
) -> None:
    """After adding a .yml recipe file, rediscovery returns the new model."""
    (tmp_path / "recipe_a.json").write_text(json.dumps(_RECIPE_A), encoding="utf-8")

    initial = discover_recipes(tmp_path)
    assert len(initial) == 1

    (tmp_path / "recipe_c.yml").write_text(
        yaml.dump(_RECIPE_C, allow_unicode=True), encoding="utf-8"
    )

    updated = discover_recipes(tmp_path)
    recipe_ids = {r.recipe_id for r in updated}

    assert len(updated) == 2
    assert "recipe_trend_c_1" in recipe_ids


# ---------------------------------------------------------------------------
# Sub-AC 6.3.2 — Test 3:
# 빈 디렉터리에서 빈 리스트 반환
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_discover_recipes_empty_directory_returns_empty_list(tmp_path: Path) -> None:
    """discover_recipes on an empty directory returns an empty list."""
    result = discover_recipes(tmp_path)

    assert result == []


@pytest.mark.unit
def test_discover_recipes_directory_with_no_recipe_files_returns_empty_list(
    tmp_path: Path,
) -> None:
    """discover_recipes ignores non-recipe files and returns an empty list."""
    # Write a .txt and a .toml file — neither is a recognised recipe extension.
    (tmp_path / "notes.txt").write_text("not a recipe", encoding="utf-8")
    (tmp_path / "config.toml").write_text('key = "value"\n', encoding="utf-8")

    result = discover_recipes(tmp_path)

    assert result == []


# ---------------------------------------------------------------------------
# Sub-AC 6.3.2 — Additional contract tests
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_discover_recipes_returns_list_of_recipe_model_instances(
    tmp_path: Path,
) -> None:
    """discover_recipes return type is list[RecipeModel], never a list of dicts."""
    (tmp_path / "recipe_a.json").write_text(json.dumps(_RECIPE_A), encoding="utf-8")

    results = discover_recipes(tmp_path)

    assert isinstance(results, list)
    assert all(type(r) is RecipeModel for r in results)


@pytest.mark.unit
def test_discover_recipes_result_is_deterministic_on_repeated_calls(
    tmp_path: Path,
) -> None:
    """Repeated discover_recipes calls on the same directory return the same order."""
    (tmp_path / "recipe_a.json").write_text(json.dumps(_RECIPE_A), encoding="utf-8")
    (tmp_path / "recipe_b.yaml").write_text(
        yaml.dump(_RECIPE_B, allow_unicode=True), encoding="utf-8"
    )

    first = [r.recipe_id for r in discover_recipes(tmp_path)]
    second = [r.recipe_id for r in discover_recipes(tmp_path)]

    assert first == second


@pytest.mark.unit
def test_discover_recipes_single_valid_file_returns_one_model(tmp_path: Path) -> None:
    """discover_recipes with a single valid file returns a one-element list."""
    (tmp_path / "recipe_only.json").write_text(
        json.dumps(_MINIMAL_RECIPE), encoding="utf-8"
    )

    results = discover_recipes(tmp_path)

    assert len(results) == 1
    assert isinstance(results[0], RecipeModel)
    assert results[0].recipe_id == "recipe_trend001_1"


# ===========================================================================
# discover_recipes (Sub-AC 6.3.3) — file-level error isolation
# ===========================================================================


# ---------------------------------------------------------------------------
# Sub-AC 6.3.3 — Test 1:
# 유효 파일과 스키마 위반 파일 혼재 → 유효 파일만 반환
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_discover_recipes_schema_invalid_file_is_skipped(tmp_path: Path) -> None:
    """A schema-invalid file is skipped; the valid file is still returned."""
    (tmp_path / "recipe_a.json").write_text(json.dumps(_RECIPE_A), encoding="utf-8")
    # Schema violation: candidate_count missing entirely.
    invalid = {k: v for k, v in _RECIPE_B.items() if k != "candidate_count"}
    (tmp_path / "recipe_b_invalid.json").write_text(
        json.dumps(invalid), encoding="utf-8"
    )

    results = discover_recipes(tmp_path)

    assert len(results) == 1
    assert results[0].recipe_id == "recipe_trend_a_1"


@pytest.mark.unit
def test_discover_recipes_schema_invalid_file_does_not_propagate_exception(
    tmp_path: Path,
) -> None:
    """discover_recipes does not raise even when a schema-invalid file is present."""
    invalid = {k: v for k, v in _RECIPE_A.items() if k != "trend_id"}
    (tmp_path / "invalid.json").write_text(json.dumps(invalid), encoding="utf-8")

    # Must not raise.
    results = discover_recipes(tmp_path)

    assert results == []


# ---------------------------------------------------------------------------
# Sub-AC 6.3.3 — Test 2:
# 깨진 JSON 파일 혼재 → 유효 파일만 반환, 예외 전파 없음
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_discover_recipes_broken_json_is_skipped_returns_valid_files(
    tmp_path: Path,
) -> None:
    """A broken-JSON file is skipped; valid files are still returned."""
    (tmp_path / "recipe_a.json").write_text(json.dumps(_RECIPE_A), encoding="utf-8")
    (tmp_path / "broken.json").write_text('{"recipe_id": "r_broken",', encoding="utf-8")

    results = discover_recipes(tmp_path)

    assert len(results) == 1
    assert results[0].recipe_id == "recipe_trend_a_1"


@pytest.mark.unit
def test_discover_recipes_broken_json_does_not_propagate_exception(
    tmp_path: Path,
) -> None:
    """discover_recipes does not raise even when a broken-JSON file is present."""
    (tmp_path / "broken.json").write_text("{bad json", encoding="utf-8")

    # Must not raise.
    results = discover_recipes(tmp_path)

    assert results == []


# ---------------------------------------------------------------------------
# Sub-AC 6.3.3 — Test 3:
# 깨진 YAML 파일 혼재 → 유효 파일만 반환, 예외 전파 없음
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_discover_recipes_broken_yaml_is_skipped_returns_valid_files(
    tmp_path: Path,
) -> None:
    """A broken-YAML file is skipped; valid files are still returned."""
    (tmp_path / "recipe_a.yaml").write_text(
        yaml.dump(_RECIPE_A, allow_unicode=True), encoding="utf-8"
    )
    # YAML with invalid tab indentation.
    (tmp_path / "broken.yaml").write_text(
        "recipe_id: r_broken\nstyle_params:\n\tmodel: flux\n",
        encoding="utf-8",
    )

    results = discover_recipes(tmp_path)

    assert len(results) == 1
    assert results[0].recipe_id == "recipe_trend_a_1"


@pytest.mark.unit
def test_discover_recipes_broken_yaml_does_not_propagate_exception(
    tmp_path: Path,
) -> None:
    """discover_recipes does not raise even when a broken-YAML file is present."""
    (tmp_path / "broken.yml").write_text(
        "recipe_id: ok\nstyle_params:\n\tmodel: flux\n",
        encoding="utf-8",
    )

    # Must not raise.
    results = discover_recipes(tmp_path)

    assert results == []


# ---------------------------------------------------------------------------
# Sub-AC 6.3.3 — Test 4:
# 여러 무효 파일 + 여러 유효 파일 혼재 → 유효 파일 수만큼만 반환
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_discover_recipes_multiple_invalid_files_returns_only_valid(
    tmp_path: Path,
) -> None:
    """Only valid files are returned when multiple invalid files are mixed in."""
    # Two valid files.
    (tmp_path / "recipe_a.json").write_text(json.dumps(_RECIPE_A), encoding="utf-8")
    (tmp_path / "recipe_b.yaml").write_text(
        yaml.dump(_RECIPE_B, allow_unicode=True), encoding="utf-8"
    )
    # Two invalid files.
    (tmp_path / "broken.json").write_text("{truncated", encoding="utf-8")
    invalid = {k: v for k, v in _RECIPE_C.items() if k != "active"}
    (tmp_path / "invalid.yaml").write_text(
        yaml.dump(invalid, allow_unicode=True), encoding="utf-8"
    )

    results = discover_recipes(tmp_path)

    assert len(results) == 2
    recipe_ids = {r.recipe_id for r in results}
    assert "recipe_trend_a_1" in recipe_ids
    assert "recipe_trend_b_1" in recipe_ids


@pytest.mark.unit
def test_discover_recipes_count_equals_valid_file_count(tmp_path: Path) -> None:
    """Result length equals the number of valid files when invalid files are present."""
    # Three valid files.
    (tmp_path / "recipe_a.json").write_text(json.dumps(_RECIPE_A), encoding="utf-8")
    (tmp_path / "recipe_b.yaml").write_text(
        yaml.dump(_RECIPE_B, allow_unicode=True), encoding="utf-8"
    )
    (tmp_path / "recipe_c.yml").write_text(
        yaml.dump(_RECIPE_C, allow_unicode=True), encoding="utf-8"
    )
    # One invalid file (schema violation — missing prompt_template).
    schema_bad = {k: v for k, v in _RECIPE_A.items() if k != "prompt_template"}
    schema_bad["recipe_id"] = "recipe_bad"
    (tmp_path / "recipe_bad.json").write_text(json.dumps(schema_bad), encoding="utf-8")

    results = discover_recipes(tmp_path)

    # Exactly 3 valid files, 1 invalid file → 3 models returned (1 missing).
    assert len(results) == 3


# ---------------------------------------------------------------------------
# Sub-AC 6.3.3 — Test 5:
# 모든 파일이 무효 → 빈 리스트 반환, 예외 전파 없음
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_discover_recipes_all_invalid_returns_empty_list(tmp_path: Path) -> None:
    """When every file in the directory is invalid, discover_recipes returns []."""
    # Three invalid files of different failure modes.
    (tmp_path / "broken.json").write_text("{bad json here", encoding="utf-8")
    missing_field = {k: v for k, v in _RECIPE_A.items() if k != "recipe_id"}
    (tmp_path / "missing_field.yaml").write_text(
        yaml.dump(missing_field, allow_unicode=True), encoding="utf-8"
    )
    (tmp_path / "broken.yml").write_text(
        "recipe_id: ok\nstyle_params:\n\tmodel: flux\n",
        encoding="utf-8",
    )

    # Must not raise and must return an empty list.
    results = discover_recipes(tmp_path)

    assert results == []
