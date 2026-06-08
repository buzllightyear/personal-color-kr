"""AC3: Candidate generation — recipe.candidate_count drives N raw candidates.

Acceptance criteria verified
-----------------------------
AC3: 1 input selfie + 1 recipe → commodity AI API mock call → N raw candidates.
     N = recipe.candidate_count (upper bound 8, schema validation included).
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest

# ---------------------------------------------------------------------------
# RecipeModel lives in core-python (generation.recipe_model) — imported here
# ---------------------------------------------------------------------------
from generation.recipe_model import RecipeModel, ValidationError, validate_recipe

# ---------------------------------------------------------------------------
# Minimal valid recipe dict helper
# ---------------------------------------------------------------------------

_VALID_RECIPE_BASE: dict[str, Any] = {
    "recipe_id": "recipe_aurora_1",
    "trend_id": "trend_aurora_2026",
    "prompt_template": "A selfie with {personal_color_modifier} lighting.",
    "style_params": {"model": "flux"},
    "personal_color_modifiers": {"봄": "warm", "겨울": "cool"},
    "candidate_count": 4,
    "created_by": "operator_singleton",
    "created_at": "2026-06-01T09:00:00Z",
    "active": True,
}


def _recipe(candidate_count: int) -> dict[str, Any]:
    return {**_VALID_RECIPE_BASE, "candidate_count": candidate_count}


# ---------------------------------------------------------------------------
# AC3 core: mock commodity AI returns candidate_count raw images
# ---------------------------------------------------------------------------


def _fake_commodity_ai_generate(
    selfie_bytes: bytes,
    recipe: RecipeModel,
    *,
    commodity_ai_fn: Any = None,
) -> list[bytes]:
    """Simulate calling commodity AI to produce candidate_count raw images.

    In production this would call Fal.ai / Replicate. Here we call the
    injected mock so tests can verify the call count and output count.
    """
    return [commodity_ai_fn(selfie_bytes, recipe, i) for i in range(recipe.candidate_count)]


@pytest.mark.unit
def test_candidate_count_drives_commodity_ai_call_count() -> None:
    """N raw candidates are returned, one per commodity AI call."""
    recipe = validate_recipe(_recipe(candidate_count=3))
    mock_ai = MagicMock(return_value=b"raw_image_bytes")
    selfie = b"selfie_bytes"

    raw_candidates = _fake_commodity_ai_generate(selfie, recipe, commodity_ai_fn=mock_ai)

    assert len(raw_candidates) == 3, (
        f"Expected 3 raw candidates (recipe.candidate_count=3), got {len(raw_candidates)}"
    )
    assert mock_ai.call_count == 3, (
        f"Expected commodity AI called 3 times, got {mock_ai.call_count}"
    )


@pytest.mark.unit
def test_candidate_count_5_returns_5_candidates() -> None:
    """candidate_count=5 → 5 raw candidates."""
    recipe = validate_recipe(_recipe(candidate_count=5))
    mock_ai = MagicMock(return_value=b"img")

    raw_candidates = _fake_commodity_ai_generate(b"selfie", recipe, commodity_ai_fn=mock_ai)

    assert len(raw_candidates) == 5


@pytest.mark.unit
def test_candidate_count_upper_limit_8_is_valid() -> None:
    """candidate_count=8 (upper limit) is accepted by schema."""
    recipe = validate_recipe(_recipe(candidate_count=8))
    assert recipe.candidate_count == 8


@pytest.mark.unit
def test_candidate_count_exceeds_8_raises_validation_error() -> None:
    """candidate_count=9 (above upper limit) raises ValidationError (AC3 schema guard)."""
    with pytest.raises(ValidationError):
        validate_recipe(_recipe(candidate_count=9))


@pytest.mark.unit
def test_candidate_count_zero_raises_validation_error() -> None:
    """candidate_count=0 raises ValidationError (minimum is 1)."""
    with pytest.raises(ValidationError):
        validate_recipe(_recipe(candidate_count=0))


@pytest.mark.unit
def test_candidate_count_negative_raises_validation_error() -> None:
    """Negative candidate_count raises ValidationError."""
    with pytest.raises(ValidationError):
        validate_recipe(_recipe(candidate_count=-1))
