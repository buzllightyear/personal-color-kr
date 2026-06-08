"""AC19: personal_color → recipe modifier application.

Acceptance criteria verified
-----------------------------
AC19: personal_color 카테고리가 recipe.personal_color_modifiers 맵에서
      해당 modifier를 조회하여 생성 파라미터에 적용.
      카테고리별 다른 modifier 적용 검증.
"""

from __future__ import annotations

import pytest

from api.generation.personal_color_modifier import (
    apply_personal_color_to_prompt,
    normalize_to_korean,
    resolve_modifier_from_recipe,
)


# ---------------------------------------------------------------------------
# Sample recipe modifiers (mirroring recipe YAML structure)
# ---------------------------------------------------------------------------

_MODIFIERS = {
    "봄": "warm golden undertones",
    "여름": "cool rose undertones",
    "가을": "deep amber undertones",
    "겨울": "crisp cool undertones",
}


# ---------------------------------------------------------------------------
# AC19: resolve_modifier_from_recipe with Korean keys
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize(
    "korean_cat, expected_modifier",
    [
        ("봄", "warm golden undertones"),
        ("여름", "cool rose undertones"),
        ("가을", "deep amber undertones"),
        ("겨울", "crisp cool undertones"),
    ],
)
def test_korean_category_resolves_correct_modifier(
    korean_cat: str,
    expected_modifier: str,
) -> None:
    """Each Korean personal_color category maps to its unique modifier."""
    modifier = resolve_modifier_from_recipe(korean_cat, _MODIFIERS)
    assert modifier == expected_modifier


@pytest.mark.unit
def test_each_category_produces_different_modifier() -> None:
    """All 4 categories produce distinct modifiers (not the same string)."""
    results = {
        cat: resolve_modifier_from_recipe(cat, _MODIFIERS)
        for cat in ["봄", "여름", "가을", "겨울"]
    }
    # All 4 modifiers must be distinct
    assert len(set(results.values())) == 4, (
        f"Expected 4 distinct modifiers, got: {results}"
    )


# ---------------------------------------------------------------------------
# AC19: English slugs are normalized to Korean
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize(
    "english_cat, expected_korean",
    [
        ("spring", "봄"),
        ("summer", "여름"),
        ("autumn", "가을"),
        ("winter", "겨울"),
    ],
)
def test_english_category_normalized_to_korean(
    english_cat: str,
    expected_korean: str,
) -> None:
    """English category slugs normalize to Korean labels."""
    assert normalize_to_korean(english_cat) == expected_korean


@pytest.mark.unit
@pytest.mark.parametrize(
    "english_cat, expected_modifier",
    [
        ("spring", "warm golden undertones"),
        ("summer", "cool rose undertones"),
        ("autumn", "deep amber undertones"),
        ("winter", "crisp cool undertones"),
    ],
)
def test_english_slug_resolves_modifier_via_recipe(
    english_cat: str,
    expected_modifier: str,
) -> None:
    """English category slug resolves correct modifier from recipe."""
    modifier = resolve_modifier_from_recipe(english_cat, _MODIFIERS)
    assert modifier == expected_modifier


# ---------------------------------------------------------------------------
# AC19: prompt template substitution
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_apply_personal_color_to_prompt_fills_placeholder() -> None:
    """The personal_color_modifier placeholder in the prompt is filled."""
    template = "A selfie with {personal_color_modifier} lighting."
    result = apply_personal_color_to_prompt(template, "봄", _MODIFIERS)
    assert result == "A selfie with warm golden undertones lighting."


@pytest.mark.unit
def test_different_categories_produce_different_prompts() -> None:
    """봄 and 겨울 produce different final prompts from the same template."""
    template = "A selfie with {personal_color_modifier} lighting."
    spring_prompt = apply_personal_color_to_prompt(template, "봄", _MODIFIERS)
    winter_prompt = apply_personal_color_to_prompt(template, "겨울", _MODIFIERS)
    assert spring_prompt != winter_prompt


@pytest.mark.unit
def test_unknown_category_raises_value_error() -> None:
    """Unknown personal_color category raises ValueError."""
    with pytest.raises(ValueError, match="Unknown personal color category"):
        resolve_modifier_from_recipe("unknown_category", _MODIFIERS)


@pytest.mark.unit
def test_recipe_without_category_returns_none() -> None:
    """Category not in recipe modifiers returns None (wildcard recipe)."""
    partial_modifiers = {"봄": "warm tone"}  # Only 봄, no 겨울
    result = resolve_modifier_from_recipe("겨울", partial_modifiers)
    assert result is None
