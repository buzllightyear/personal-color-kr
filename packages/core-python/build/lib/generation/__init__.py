"""Generation module — trend-based photo generation pipeline entities.

Exports:
    RecipeModel: Pydantic model for a generation recipe (Sub-AC 6.1).
    validate_recipe: Validate a raw dict against RecipeModel (Sub-AC 6.1).
    load_recipe_file: Load and validate a JSON or YAML recipe file into a
        RecipeModel (Sub-AC 6.3.1). Raises FileNotFoundError for missing
        paths and pydantic.ValidationError for schema violations.
    discover_recipes: Discover all recipe files in a directory and return a
        list of RecipeModel instances (Sub-AC 6.3.2).
    VoiceConfig: Pydantic model for the single-POV operator voice (Sub-AC 13b-1).
    validate_voice_config: Validate a raw dict against VoiceConfig (Sub-AC 13b-1).
"""

from .recipe_loader import discover_recipes, load_recipe_file
from .recipe_model import RecipeModel, validate_recipe
from .voice_config import VoiceConfig, validate_voice_config

__all__ = [
    "RecipeModel",
    "validate_recipe",
    "load_recipe_file",
    "discover_recipes",
    "VoiceConfig",
    "validate_voice_config",
]
