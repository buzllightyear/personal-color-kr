"""Personal color → recipe modifier application (AC19).

Maps personal_color categories to recipe modifiers for prompt generation.

The wedge_hook returns English slugs ("spring"/"summer"/"autumn"/"winter").
The recipe uses Korean keys ("봄"/"여름"/"가을"/"겨울").

This module bridges them: given a raw selfie personal_color category
(English or Korean), it resolves the corresponding modifier from
recipe.personal_color_modifiers.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Category normalization mapping
# ---------------------------------------------------------------------------

#: English slug → Korean category label
EN_TO_KR: dict[str, str] = {
    "spring": "봄",
    "summer": "여름",
    "autumn": "가을",
    "winter": "겨울",
}

#: Korean label → English slug
KR_TO_EN: dict[str, str] = {v: k for k, v in EN_TO_KR.items()}


def normalize_to_korean(category: str) -> str:
    """Normalize personal color category to Korean label.

    Accepts either English ("spring") or Korean ("봄") input.
    Returns the Korean label.

    Raises ValueError for unrecognized categories.
    """
    if category in EN_TO_KR:
        return EN_TO_KR[category]
    if category in KR_TO_EN:
        return category  # already Korean
    raise ValueError(
        f"Unknown personal color category: {category!r}. "
        f"Expected one of: {sorted(EN_TO_KR)} (English) or "
        f"{sorted(KR_TO_EN)} (Korean)."
    )


# ---------------------------------------------------------------------------
# Modifier resolution
# ---------------------------------------------------------------------------


def resolve_modifier_from_recipe(
    personal_color: str,
    personal_color_modifiers: dict[str, str],
) -> str | None:
    """Look up the recipe modifier for a personal_color category.

    Parameters
    ----------
    personal_color:
        Personal color category — English ("spring") or Korean ("봄").
    personal_color_modifiers:
        Mapping from Korean category to modifier string
        (from recipe.personal_color_modifiers).

    Returns
    -------
    str | None
        The modifier string, or None if the category has no entry in the
        recipe (recipe does not target this category).
    """
    korean = normalize_to_korean(personal_color)
    return personal_color_modifiers.get(korean)


def apply_personal_color_to_prompt(
    prompt_template: str,
    personal_color: str,
    personal_color_modifiers: dict[str, str],
) -> str:
    """Fill the {personal_color_modifier} slot in a prompt template.

    Parameters
    ----------
    prompt_template:
        Template string (may contain ``{personal_color_modifier}``).
    personal_color:
        User's personal color category (English or Korean).
    personal_color_modifiers:
        Recipe modifier mapping.

    Returns
    -------
    str
        Prompt with modifier applied. If the modifier is not found or the
        template has no placeholder, returns the template unchanged or with
        empty string substituted.
    """
    modifier = resolve_modifier_from_recipe(personal_color, personal_color_modifiers)
    if modifier is None:
        modifier = ""
    return prompt_template.replace("{personal_color_modifier}", modifier)


__all__ = [
    "EN_TO_KR",
    "KR_TO_EN",
    "normalize_to_korean",
    "resolve_modifier_from_recipe",
    "apply_personal_color_to_prompt",
]
