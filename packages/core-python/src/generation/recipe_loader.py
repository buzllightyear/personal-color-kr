"""Recipe file loader with schema validation — ``load_recipe_file`` (Sub-AC 6.3.1).

Domain context
--------------
A ``generation_recipe`` lives on disk as a JSON or YAML file authored by the
operator.  ``load_recipe_file`` is the single entry-point that reads, parses,
and fully validates that file against the ``RecipeModel`` schema, returning a
ready-to-use immutable model or raising a precise exception.

Generation pipeline context
---------------------------
The recipe is the *operator taste* entry point for the generation pipeline::

    raw_generation (commodity AI, guided by recipe)
    → enhancer (de-slop, guided by recipe.enhancer_overrides)
    → reject_filter (guided by recipe.reject_threshold_overrides)
    → user_pick

Design decisions
----------------
- This function combines the file I/O step (previously Sub-AC 6.2: parse to
  dict) with Pydantic schema validation (Sub-AC 6.1: ``validate_recipe``) into
  one *atomic* entry point so all callers receive either a valid, immutable
  ``RecipeModel`` or a precise exception — never a structurally unsafe dict.
- File I/O is delegated to the private helper ``_parse_file_to_dict`` to keep
  the two concerns testable independently.
- ``FileNotFoundError`` from ``Path.read_text`` propagates directly — operator
  tooling receives the standard Python exception with the full path in the
  message.
- ``pydantic.ValidationError`` from ``validate_recipe`` propagates directly so
  callers can inspect per-field error details (location, message, type).
- Unsupported file extensions raise ``ValueError`` *before* any I/O is
  attempted, failing fast at config-load time.
- ``yaml.safe_load`` is used (not ``yaml.full_load`` / ``yaml.load``) to
  avoid arbitrary Python object deserialisation from operator-supplied files.
- ``Path`` is the canonical argument type (not ``str``) to encourage callers
  to resolve paths explicitly, keeping the function free of implicit cwd
  dependence.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import yaml

from .recipe_model import RecipeModel, validate_recipe

logger = logging.getLogger(__name__)

__all__ = ["load_recipe_file", "discover_recipes"]

# Supported extension sets — lower-cased for case-insensitive comparison.
_JSON_EXTENSIONS: frozenset[str] = frozenset({".json"})
_YAML_EXTENSIONS: frozenset[str] = frozenset({".yaml", ".yml"})


def _parse_file_to_dict(path: Path) -> dict[str, Any]:
    """Read a JSON or YAML file at *path* and return the parsed contents as a dict.

    This is an internal helper — external callers should use
    ``load_recipe_file`` which adds full Pydantic schema validation on top.

    Parameters
    ----------
    path:
        Absolute or relative ``pathlib.Path`` to the recipe file.

    Returns
    -------
    dict[str, Any]
        The raw parsed contents — no Pydantic validation is performed here.

    Raises
    ------
    FileNotFoundError
        If *path* does not exist or is not a regular file.
    json.JSONDecodeError
        If *path* has a ``.json`` extension but its contents are not valid JSON.
    yaml.YAMLError
        If *path* has a ``.yaml`` / ``.yml`` extension but its contents are
        not valid YAML.
    ValueError
        If *path* has an unsupported file extension, or if the top-level
        parsed value is not a ``dict``.
    """
    ext = path.suffix.lower()

    if ext not in _JSON_EXTENSIONS and ext not in _YAML_EXTENSIONS:
        raise ValueError(
            f"Unsupported recipe file extension '{path.suffix}'. "
            f"Expected one of: .json, .yaml, .yml"
        )

    # ``Path.read_text`` raises ``FileNotFoundError`` when the file does not
    # exist — we let this propagate so callers receive the standard Python
    # exception with the full path in the message.
    raw = path.read_text(encoding="utf-8")

    if ext in _JSON_EXTENSIONS:
        # ``json.loads`` raises ``json.JSONDecodeError`` on broken JSON syntax.
        result: Any = json.loads(raw)
    else:
        # ``yaml.safe_load`` raises ``yaml.YAMLError`` on broken YAML syntax.
        result = yaml.safe_load(raw)

    if not isinstance(result, dict):
        raise ValueError(
            f"Recipe file '{path}' did not parse to a dict — "
            f"got {type(result).__name__}. "
            "A recipe file must be a YAML/JSON mapping (object) at the top level."
        )

    return result


def load_recipe_file(path: Path) -> RecipeModel:
    """Load a recipe file from *path*, parse it, and validate against ``RecipeModel``.

    This is the single public entry point for operator tooling that ingests
    recipe configs from YAML or JSON files on disk.  It performs both file I/O
    and Pydantic schema validation atomically, ensuring that the returned
    ``RecipeModel`` is always fully valid and immutable.

    Supported formats
    -----------------
    - ``.json`` — standard JSON object.
    - ``.yaml`` / ``.yml`` — YAML mapping.  Extension matching is
      case-insensitive, so ``.YAML`` and ``.YML`` are also accepted.

    Parameters
    ----------
    path:
        Absolute or relative ``pathlib.Path`` to the recipe file.  The caller
        is responsible for resolving the path before passing it in.

    Returns
    -------
    RecipeModel
        A fully validated, immutable recipe instance ready for use in the
        generation pipeline.

    Raises
    ------
    FileNotFoundError
        If *path* does not exist or is not a regular file.
    pydantic.ValidationError
        If the file contents are missing required fields, contain values of
        the wrong type, or violate any ``RecipeModel`` field constraint
        (e.g. ``candidate_count < 1``, empty required string).  The error
        carries a structured list of per-field error details compatible with
        the Pydantic v2 ``ValidationError`` interface.
    json.JSONDecodeError
        If *path* has a ``.json`` extension but its contents are not valid
        JSON syntax.
    yaml.YAMLError
        If *path* has a ``.yaml`` / ``.yml`` extension but its contents are
        not valid YAML syntax.
    ValueError
        If *path* has an unsupported file extension, or if the top-level
        parsed value is not a dict.

    Examples
    --------
    >>> recipe = load_recipe_file(Path("recipes/trend_aurora_v1.yaml"))
    >>> recipe.recipe_id
    'recipe_aurora_1'
    >>> recipe.candidate_count
    4
    """
    data = _parse_file_to_dict(path)
    # ``validate_recipe`` raises ``pydantic.ValidationError`` when any
    # required field is missing, has the wrong type, or violates a constraint.
    return validate_recipe(data)


def discover_recipes(directory: Path) -> list[RecipeModel]:
    """Discover all recipe files in *directory* and return validated ``RecipeModel`` instances.

    Enumerates JSON and YAML recipe files in *directory* (non-recursive) using
    ``Path.glob``, loads each file via ``load_recipe_file``, and returns the
    aggregated list.  Invalid files are skipped with a warning log — the
    function never raises an exception due to a bad individual file.

    Parameters
    ----------
    directory:
        Path to the directory containing operator-authored recipe files.
        Only direct children are discovered (non-recursive).

    Returns
    -------
    list[RecipeModel]
        A list of fully validated, immutable ``RecipeModel`` instances — one
        per *valid* recipe file found.  Returns an empty list if the directory
        contains no recognised recipe files, or if all recognised files are
        invalid.

    Notes
    -----
    - Recognised extensions: ``.json``, ``.yaml``, ``.yml`` (case-insensitive
      via ``path.suffix.lower()`` inside ``load_recipe_file``).
    - Results are sorted by file name to ensure a stable, deterministic order
      across invocations on the same directory contents.
    - **File-level error isolation (Sub-AC 6.3.3)**: any exception raised by
      ``load_recipe_file`` for a single file is caught at the file level,
      logged as a warning, and the file is skipped.  The remaining valid files
      are still returned and no exception is propagated to the caller.
      Caught exception types: ``FileNotFoundError``, ``ValueError``,
      ``json.JSONDecodeError``, ``yaml.YAMLError``, and
      ``pydantic.ValidationError``.

    Examples
    --------
    >>> recipes = discover_recipes(Path("recipes/"))
    >>> [r.recipe_id for r in recipes]
    ['recipe_aurora_1', 'recipe_blooming_2']
    """
    # Collect paths matching each supported extension pattern, then sort for
    # deterministic ordering.  Using three separate globs avoids the need for a
    # case-insensitive glob implementation while still covering all supported
    # extension variants.
    recipe_files: list[Path] = []
    for pattern in ("*.json", "*.yaml", "*.yml"):
        recipe_files.extend(directory.glob(pattern))

    # Stable ordering by file name so callers get consistent results.
    recipe_files.sort(key=lambda p: p.name)

    # Sub-AC 6.3.3: load each file independently, isolating errors at the file
    # level so that a single bad file cannot prevent valid files from loading.
    recipes: list[RecipeModel] = []
    for recipe_file in recipe_files:
        try:
            recipes.append(load_recipe_file(recipe_file))
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "discover_recipes: skipping '%s' due to load error: %s: %s",
                recipe_file,
                type(exc).__name__,
                exc,
            )

    return recipes
