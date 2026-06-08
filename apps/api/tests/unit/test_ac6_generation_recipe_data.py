"""AC6: generation_recipe data separation — recipe is code-external JSON/YAML.

Acceptance criteria verified
-----------------------------
AC6: recipe가 코드 밖 JSON/YAML. 신규 recipe 파일 추가만으로 새 트렌드 생성 가능.
     recipe 스키마 검증(candidate_count 상한 포함) 테스트.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from generation.recipe_loader import discover_recipes, load_recipe_file
from generation.recipe_model import RecipeModel, validate_recipe


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_VALID_RECIPE_DICT = {
    "recipe_id": "recipe_test_1",
    "trend_id": "trend_test",
    "prompt_template": "A selfie with {personal_color_modifier} look.",
    "style_params": {"model": "flux"},
    "personal_color_modifiers": {"봄": "warm", "겨울": "cool"},
    "candidate_count": 4,
    "created_by": "operator_singleton",
    "created_at": "2026-06-01T09:00:00Z",
    "active": True,
}


# ---------------------------------------------------------------------------
# AC6: load recipe from YAML file
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_load_recipe_from_yaml_file(tmp_path: Path) -> None:
    """A valid recipe YAML file loads and validates without errors."""
    import yaml

    recipe_file = tmp_path / "trend_test_v1.yaml"
    recipe_file.write_text(yaml.dump(_VALID_RECIPE_DICT), encoding="utf-8")

    recipe = load_recipe_file(recipe_file)

    assert isinstance(recipe, RecipeModel)
    assert recipe.recipe_id == "recipe_test_1"
    assert recipe.candidate_count == 4


@pytest.mark.unit
def test_load_recipe_from_json_file(tmp_path: Path) -> None:
    """A valid recipe JSON file loads and validates without errors."""
    recipe_file = tmp_path / "trend_test_v1.json"
    recipe_file.write_text(json.dumps(_VALID_RECIPE_DICT), encoding="utf-8")

    recipe = load_recipe_file(recipe_file)

    assert isinstance(recipe, RecipeModel)
    assert recipe.recipe_id == "recipe_test_1"


@pytest.mark.unit
def test_new_recipe_file_adds_new_trend_without_code_change(tmp_path: Path) -> None:
    """Adding a new recipe file to the directory makes it discoverable."""
    import yaml

    # Write two recipe files with distinct recipe_ids
    recipe_1 = {**_VALID_RECIPE_DICT, "recipe_id": "recipe_aurora_1", "trend_id": "trend_aurora"}
    recipe_2 = {**_VALID_RECIPE_DICT, "recipe_id": "recipe_blooming_1", "trend_id": "trend_blooming"}

    (tmp_path / "aurora.yaml").write_text(yaml.dump(recipe_1), encoding="utf-8")
    (tmp_path / "blooming.yaml").write_text(yaml.dump(recipe_2), encoding="utf-8")

    recipes = discover_recipes(tmp_path)
    recipe_ids = {r.recipe_id for r in recipes}

    assert "recipe_aurora_1" in recipe_ids
    assert "recipe_blooming_1" in recipe_ids


# ---------------------------------------------------------------------------
# AC6: schema validation — candidate_count upper bound = 8
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_schema_rejects_candidate_count_greater_than_8() -> None:
    """candidate_count > 8 raises ValidationError (hard upper limit = 8)."""
    bad_recipe = {**_VALID_RECIPE_DICT, "candidate_count": 9}
    with pytest.raises(ValidationError):
        validate_recipe(bad_recipe)


@pytest.mark.unit
def test_schema_accepts_candidate_count_exactly_8() -> None:
    """candidate_count = 8 is valid (upper bound is inclusive)."""
    recipe = validate_recipe({**_VALID_RECIPE_DICT, "candidate_count": 8})
    assert recipe.candidate_count == 8


@pytest.mark.unit
def test_schema_rejects_missing_required_field() -> None:
    """Missing required field (e.g. trend_id) raises ValidationError."""
    bad_recipe = {k: v for k, v in _VALID_RECIPE_DICT.items() if k != "trend_id"}
    with pytest.raises(ValidationError):
        validate_recipe(bad_recipe)


@pytest.mark.unit
def test_yaml_file_with_candidate_count_9_raises_on_load(tmp_path: Path) -> None:
    """YAML file with candidate_count=9 raises ValidationError on load."""
    import yaml

    bad_recipe = {**_VALID_RECIPE_DICT, "candidate_count": 9}
    recipe_file = tmp_path / "bad_recipe.yaml"
    recipe_file.write_text(yaml.dump(bad_recipe), encoding="utf-8")

    with pytest.raises(ValidationError):
        load_recipe_file(recipe_file)


@pytest.mark.unit
def test_existing_recipe_file_is_valid() -> None:
    """The existing config/recipes/trend_aurora_v1.yaml is valid."""
    # Resolve from apps/api root
    recipe_path = (
        Path(__file__).parent.parent.parent  # apps/api/
        / "config"
        / "recipes"
        / "trend_aurora_v1.yaml"
    )
    if recipe_path.exists():
        recipe = load_recipe_file(recipe_path)
        assert isinstance(recipe, RecipeModel)
        assert recipe.candidate_count <= 8
    else:
        pytest.skip("Config recipe file not found — skipping")
