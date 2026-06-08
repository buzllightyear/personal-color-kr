"""RecipeModel — Pydantic schema for a trend-based generation recipe (Sub-AC 6.1).

Domain context
--------------
A ``generation_recipe`` is the operator-authored specification that drives a
single trend's photo generation campaign. It binds together:

  - The upstream prompt template and style parameters for the commodity AI
    (Fal.ai / Replicate) call.
  - Personal-color modifiers that personalise the prompt per seasonal category
    (봄/여름/가을/겨울).
  - The candidate count — how many raw images the commodity AI generates per
    user selfie before the enhancer + reject filter run.
  - Optional per-recipe overrides for the enhancer and reject-filter thresholds
    (Seed constraint: "enhancer 파라미터는 per-recipe config 허용 (global
    default + recipe-level override)" and "reject_filter 임계값은 per-recipe
    설정 가능").
  - Provenance fields (trend_id FK, created_by operator FK, created_at, active).

Pipeline position
-----------------
The recipe is the *operator taste* entry point for the generation pipeline::

    raw_generation (commodity AI, guided by recipe)
    → enhancer (de-slop, guided by recipe.enhancer_overrides)
    → reject_filter (guided by recipe.reject_threshold_overrides)
    → user_pick

Design decisions
----------------
- Pydantic v2 ``BaseModel`` provides field-level type coercion and a
  ``ValidationError`` raised on missing required fields or wrong types —
  satisfying the Sub-AC 6.1 test requirements exactly.
- ``model_config = ConfigDict(frozen=True)`` enforces immutability post-
  construction, matching the project-wide coding-style rule (immutable data
  structures preferred).
- ``personal_color_modifiers`` maps the four 퍼스널컬러 categories to a
  prompt-fragment string. This allows the same recipe to produce different
  prompts for 봄 vs 겨울 users without forking recipes.
- ``enhancer_overrides`` and ``reject_threshold_overrides`` are
  ``Optional[dict[str, object]]`` rather than typed sub-models so the
  operator can add new keys without a schema migration — consistent with
  the Seed's "코드 수정 없이 config로 갱신" requirement.
- ``candidate_count`` must be a positive integer (minimum 1). Generating
  zero candidates is a logical error that should be caught at config time,
  not at runtime.
- ``created_at`` is stored as a UTC ISO-8601 string rather than a Python
  datetime to keep the model JSON-serialisable without a custom encoder and
  to avoid timezone-aware vs naive confusion across the stack.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError

__all__ = [
    "RecipeModel",
    "validate_recipe",
    "ValidationError",
]


class RecipeModel(BaseModel):
    """Operator-authored specification for a trend-based photo generation recipe.

    Required fields
    ---------------
    recipe_id:
        Unique identifier for this recipe. Convention: ``"recipe_{trend_id}_{seq}"``.
    trend_id:
        FK to the ``trend`` entity this recipe implements. A recipe without a
        trend anchor is orphaned and must not be published.
    prompt_template:
        Jinja-style (or plain string) template handed to the commodity AI.
        May contain ``{personal_color_modifier}`` placeholder that is filled by
        the ``personal_color_modifiers`` mapping at generation time.
    style_params:
        Vendor-agnostic style dictionary passed through to the commodity AI
        adapter (e.g. ``{"model": "flux", "strength": 0.75}``). Must be a
        ``dict``; an empty dict is valid for recipes that rely entirely on the
        prompt template.
    personal_color_modifiers:
        Mapping from personal-color category string (``"봄"``, ``"여름"``,
        ``"가을"``, ``"겨울"``) to a prompt-modifier string. The generation
        caller uses this to fill the ``{personal_color_modifier}`` slot in
        ``prompt_template``. An empty dict is valid (recipe targets all users
        identically).
    candidate_count:
        Number of raw images to generate per user selfie before the enhancer
        and reject filter run. Must be >= 1. Typical range: 3-6.
    created_by:
        FK to the operator singleton who authored this recipe. In v1 this is
        always the single operator ID; the field is kept for audit provenance.
    created_at:
        UTC ISO-8601 timestamp string of recipe creation (e.g.
        ``"2026-06-01T09:00:00Z"``). Stored as a string to avoid
        timezone-aware / naive Python datetime friction.
    active:
        Whether this recipe is available for new generation runs. Inactive
        recipes are kept for audit history but not presented to users.

    Optional fields
    ---------------
    enhancer_overrides:
        Per-recipe overrides for the server-side enhancer parameters (e.g.
        ``{"sharpness_factor": 1.5}``). ``None`` means the global enhancer
        defaults apply. Keys and values are unconstrained — the enhancer
        module owns their interpretation.
    reject_threshold_overrides:
        Per-recipe overrides for the reject-filter thresholds (e.g.
        ``{"identity_threshold": 0.70, "uncanny_threshold": 0.40}``).
        ``None`` means global reject-filter defaults apply.
    """

    model_config = ConfigDict(frozen=True)

    recipe_id: str = Field(
        ...,
        min_length=1,
        description="Unique recipe identifier.",
    )
    trend_id: str = Field(
        ...,
        min_length=1,
        description="FK to the trend entity this recipe implements.",
    )
    prompt_template: str = Field(
        ...,
        min_length=1,
        description="Prompt template for the commodity AI generation call.",
    )
    style_params: dict[str, Any] = Field(
        ...,
        description=(
            "Vendor-agnostic style parameters passed to the commodity AI adapter."
        ),
    )
    personal_color_modifiers: dict[str, str] = Field(
        ...,
        description=(
            "Mapping from personal-color category (봄/여름/가을/겨울) "
            "to a prompt-modifier string."
        ),
    )
    candidate_count: int = Field(
        ...,
        ge=1,
        le=8,
        description="Number of raw images to generate per selfie (minimum 1, maximum 8).",
    )
    created_by: str = Field(
        ...,
        min_length=1,
        description="FK to the operator singleton who authored this recipe.",
    )
    created_at: str = Field(
        ...,
        min_length=1,
        description="UTC ISO-8601 timestamp string of recipe creation.",
    )
    active: bool = Field(
        ...,
        description="Whether this recipe is available for new generation runs.",
    )
    enhancer_overrides: dict[str, Any] | None = Field(
        default=None,
        description=(
            "Optional per-recipe overrides for server-side enhancer parameters."
        ),
    )
    reject_threshold_overrides: dict[str, Any] | None = Field(
        default=None,
        description=(
            "Optional per-recipe overrides for reject-filter threshold values."
        ),
    )


def validate_recipe(data: dict[str, Any]) -> RecipeModel:
    """Validate a raw dictionary and return a ``RecipeModel`` if valid.

    This is the public entry point for operator tooling that ingests recipe
    configs from YAML / JSON / API payloads. It wraps the Pydantic constructor
    to give callers a single function contract without exposing Pydantic's
    ``model_validate`` directly.

    Parameters
    ----------
    data:
        Raw dictionary of recipe fields (e.g. parsed from a YAML config file
        or a POST request body). Extra keys are ignored by default Pydantic
        behaviour — the model only validates the declared fields.

    Returns
    -------
    RecipeModel
        An immutable, fully-validated recipe instance.

    Raises
    ------
    pydantic.ValidationError
        If any required field is missing, has the wrong type, or violates a
        constraint (e.g. ``candidate_count < 1``). The error carries a
        structured list of per-field error details compatible with the
        Pydantic v2 ``ValidationError`` interface.

    Examples
    --------
    >>> recipe = validate_recipe({
    ...     "recipe_id": "recipe_trend001_1",
    ...     "trend_id": "trend001",
    ...     "prompt_template": "A selfie of a {personal_color_modifier} person.",
    ...     "style_params": {"model": "flux", "strength": 0.75},
    ...     "personal_color_modifiers": {"봄": "warm spring", "겨울": "cool winter"},
    ...     "candidate_count": 4,
    ...     "created_by": "operator_singleton",
    ...     "created_at": "2026-06-01T09:00:00Z",
    ...     "active": True,
    ... })
    >>> recipe.recipe_id
    'recipe_trend001_1'
    """
    return RecipeModel.model_validate(data)
