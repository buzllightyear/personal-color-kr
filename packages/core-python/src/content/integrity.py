"""Prebuilt-content integrity validator (Sub-AC 4.1, content_integrity concept).

This module is the *integration verifier* for the prebuilt content
catalogue. It does not own any content data — it only consumes existing
modules (``content.guides``, etc.) and reports structural defects as
:class:`ValidationError` records.

The function is deliberately tolerant about its *input shape*: it accepts
either fully-constructed :class:`~content.guides.Guide` dataclasses (the
runtime catalogue) **or** raw dict-shaped guide payloads (what a future
CMS rewrite would feed in before any Guide constructor has had a chance
to validate them). This is what makes the function useful as a
*content-rewrite gate*: it must catch a missing field in a dict that
hasn't been wrapped in :class:`Guide` yet — otherwise the only way to
notice the breakage would be the constructor's hard-raise at module
import, which is too late for a CMS pipeline.

Design notes:

  - **Return a list, do not raise.** A validator that raises on the
    first defect is useless for content review — the editor has to fix
    one mistake, re-run, fix another, re-run. Returning every defect at
    once mirrors how compiler diagnostics work and matches the
    ``content_integrity`` concept in the Seed ontology ("검증 결과").

  - **Immutable error records.** :class:`ValidationError` is a frozen
    dataclass so the result list can be deduplicated / hashed by callers
    (e.g., the pre-build harness in Sub-AC 4.2) without having to copy.

  - **No module-level mutation, no I/O.** Pure-function shape: same
    input → same output, no global state.

  - **Image-path semantics.** The Seed AC names ``이미지 경로`` —
    "image path". The current ``Guide`` dataclass does not yet expose
    an ``image_path`` field, but a content rewrite that adds image
    assets *should* be caught the moment it produces a malformed
    payload. So we validate ``image_path`` defensively: if the
    field/key is present (and non-``None``), it must be a non-empty
    string with an allowed image extension and a sane prefix. If it's
    absent, that is accepted — the field is optional.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Iterable

from content.curations import (
    CurationItem,
    CurationItemKind,
    FirstCuration,
    WordingTone,
    load_all_first_curations,
)
from content.guides import Guide, GuideCategory, load_all_guides
from content.magazines import load_all_magazines
from personal_color.season_classifier import Season

# ---------------------------------------------------------------------------
# Result record
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ValidationError:
    """One defect discovered by :func:`validate_guides`.

    Attributes:
        index: 0-based position of the offending item in the input
            iterable. The validator preserves input order so this is
            stable across re-runs.
        field: Name of the field that failed validation. Uses dot-paths
            for nested entries (e.g., ``"palette[2]"``).
        message: Human-readable, Korean-friendly description of the
            defect. Composed as ``"<field>: <reason>"`` at the callsite
            for prefix-friendly grepping.
    """

    index: int
    field: str
    message: str


# ---------------------------------------------------------------------------
# Required-field contract — kept as a module-level constant so the test
# suite can assert the contract directly (no hardcoded mirror in tests).
# ---------------------------------------------------------------------------


REQUIRED_FIELDS: tuple[str, ...] = (
    "season",
    "category",
    "title",
    "summary",
    "body",
)

ALLOWED_IMAGE_EXTENSIONS: tuple[str, ...] = (
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".svg",
)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def validate_guides(guides: Iterable[Any]) -> list[ValidationError]:
    """Validate a sequence of guide-shaped items for content integrity.

    The validator accepts either :class:`~content.guides.Guide`
    dataclasses (the runtime catalogue surface) or raw dicts (a CMS
    payload before it has been wrapped). For each item it reports:

      1. Every missing required field (``season``, ``category``,
         ``title``, ``summary``, ``body``).
      2. Required string fields that are present but empty / whitespace.
      3. ``season`` values that aren't a :class:`Season` enum, the
         Season's slug, or its Korean label.
      4. ``category`` values that aren't a :class:`GuideCategory` enum,
         the category's slug, or its Korean label.
      5. ``palette`` entries that aren't valid ``#RRGGBB`` hex strings.
      6. ``image_path`` values (when the field/key is present) that
         aren't strings with an allowed image extension and a sane
         prefix (``assets/`` or ``/``).

    Args:
        guides: Iterable of guide-shaped items — :class:`Guide`
            instances and/or ``dict`` payloads can be mixed freely.

    Returns:
        A list of :class:`ValidationError` records, one per defect, in
        input order. An empty list means the catalogue is integrity-
        clean.

    Raises:
        TypeError: only if ``guides`` itself is not iterable. Per-item
            type problems are reported in the result list, never
            raised.
    """
    if guides is None or isinstance(guides, (str, bytes)):
        # Strings / None are technically iterable-or-falsy, but treating
        # them as the "list of guides" almost always means a caller bug.
        raise TypeError(
            "guides must be a non-string iterable of guide-shaped items, "
            f"got {type(guides).__name__}"
        )

    errors: list[ValidationError] = []
    for index, raw_guide in enumerate(guides):
        errors.extend(_validate_one_guide(index, raw_guide))
    return errors


# ---------------------------------------------------------------------------
# Per-item validation
# ---------------------------------------------------------------------------


def _validate_one_guide(index: int, item: Any) -> list[ValidationError]:
    """Return every defect found in a single guide-shaped item."""
    errors: list[ValidationError] = []

    # Unified getter that works for both dicts (CMS payloads) and
    # objects with attribute access (Guide dataclasses).
    if isinstance(item, dict):

        def getter(name: str) -> Any:
            return item.get(name, _MISSING)

        def has(name: str) -> bool:
            return name in item

    else:

        def getter(name: str) -> Any:
            return getattr(item, name, _MISSING)

        def has(name: str) -> bool:
            return hasattr(item, name)

    # 1. Required-field presence
    for field in REQUIRED_FIELDS:
        value = getter(field)
        if value is _MISSING or value is None:
            errors.append(
                ValidationError(
                    index=index,
                    field=field,
                    message=f"{field}: required field is missing",
                )
            )
            continue

        # 2. String fields must be non-empty after strip
        if field in ("title", "summary", "body"):
            if not isinstance(value, str):
                errors.append(
                    ValidationError(
                        index=index,
                        field=field,
                        message=(
                            f"{field}: must be a string, " f"got {type(value).__name__}"
                        ),
                    )
                )
            elif not value.strip():
                errors.append(
                    ValidationError(
                        index=index,
                        field=field,
                        message=f"{field}: must be a non-empty string",
                    )
                )

    # 3. season: enum, slug, or Korean label
    season_value = getter("season")
    if season_value is not _MISSING and season_value is not None:
        if not _is_valid_season(season_value):
            errors.append(
                ValidationError(
                    index=index,
                    field="season",
                    message=(
                        f"season: must be Season enum / slug / Korean label, "
                        f"got {season_value!r}"
                    ),
                )
            )

    # 4. category: enum, slug, or Korean label
    category_value = getter("category")
    if category_value is not _MISSING and category_value is not None:
        if not _is_valid_category(category_value):
            errors.append(
                ValidationError(
                    index=index,
                    field="category",
                    message=(
                        "category: must be GuideCategory enum / slug / "
                        f"Korean label, got {category_value!r}"
                    ),
                )
            )

    # 5. palette (optional)
    palette = getter("palette")
    if palette is not _MISSING and palette is not None:
        if not isinstance(palette, (tuple, list)):
            errors.append(
                ValidationError(
                    index=index,
                    field="palette",
                    message=(
                        f"palette: must be tuple/list of #RRGGBB strings, "
                        f"got {type(palette).__name__}"
                    ),
                )
            )
        else:
            for pos, hex_code in enumerate(palette):
                if not _is_valid_hex_color(hex_code):
                    errors.append(
                        ValidationError(
                            index=index,
                            field=f"palette[{pos}]",
                            message=(
                                f"palette[{pos}]: not a valid #RRGGBB color, "
                                f"got {hex_code!r}"
                            ),
                        )
                    )

    # 6. image_path (optional — but if present, must be well-formed)
    if has("image_path"):
        image_path = getter("image_path")
        if image_path is not None:
            errors.extend(
                _validate_image_path(index, "image_path", image_path),
            )

    return errors


def _validate_image_path(
    index: int,
    field: str,
    value: Any,
) -> list[ValidationError]:
    """Validate one image path. Returns 0 or 1 ValidationError."""
    if not isinstance(value, str):
        return [
            ValidationError(
                index=index,
                field=field,
                message=(
                    f"{field}: must be a string path, " f"got {type(value).__name__}"
                ),
            )
        ]

    stripped = value.strip()
    if not stripped:
        return [
            ValidationError(
                index=index,
                field=field,
                message=f"{field}: must be a non-empty string path",
            )
        ]

    lowered = stripped.lower()
    if not any(lowered.endswith(ext) for ext in ALLOWED_IMAGE_EXTENSIONS):
        return [
            ValidationError(
                index=index,
                field=field,
                message=(
                    f"{field}: extension must be one of "
                    f"{', '.join(ALLOWED_IMAGE_EXTENSIONS)}, got {value!r}"
                ),
            )
        ]

    # Reject obviously-broken prefixes. The catalogue is locally bundled
    # so a remote URL or a Windows-style backslash path is almost
    # certainly a CMS-pipeline mistake.
    if "\\" in stripped:
        return [
            ValidationError(
                index=index,
                field=field,
                message=(f"{field}: path must use forward slashes, got {value!r}"),
            )
        ]
    if stripped.startswith(("http://", "https://", "//")):
        return [
            ValidationError(
                index=index,
                field=field,
                message=(
                    f"{field}: remote URLs are not allowed for bundled "
                    f"image assets, got {value!r}"
                ),
            )
        ]

    return []


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


# Sentinel that lets us distinguish "field absent" from "field present
# with a value of None" (the latter is a real defect, the former too).
_MISSING: object = object()


def _is_valid_hex_color(value: Any) -> bool:
    """Strict ``#RRGGBB`` validator — mirrors guides.py / curations.py."""
    if not isinstance(value, str):
        return False
    if len(value) != 7 or not value.startswith("#"):
        return False
    return all(c in "0123456789abcdefABCDEF" for c in value[1:])


def _is_valid_season(value: Any) -> bool:
    """Accept a :class:`Season` enum, its slug, or its Korean label."""
    if isinstance(value, Season):
        return True
    if not isinstance(value, str):
        return False
    candidate = value.strip()
    if not candidate:
        return False
    candidate_lower = candidate.lower()
    for season in Season:
        if candidate_lower == season.slug.lower():
            return True
        if candidate == season.korean:
            return True
    return False


def _is_valid_category(value: Any) -> bool:
    """Accept a :class:`GuideCategory` enum, its slug, or Korean label."""
    if isinstance(value, GuideCategory):
        return True
    if not isinstance(value, str):
        return False
    candidate = value.strip()
    if not candidate:
        return False
    candidate_lower = candidate.lower()
    for category in GuideCategory:
        if candidate_lower == category.slug.lower():
            return True
        if candidate == category.label:
            return True
    return False


# ===========================================================================
# Sub-AC 4.2 — validate_curations
# ===========================================================================
#
# Mirror of the validate_guides design, scoped to the first-curation
# catalogue. Same rules apply:
#
#   - Returns a list of :class:`ValidationError`, never raises on per-item
#     defects.
#   - Accepts both runtime :class:`FirstCuration`/:class:`CurationItem`
#     dataclasses *and* raw dict payloads (CMS-rewrite input), so the
#     validator works as a pre-build content gate before any constructor
#     has had a chance to hard-raise.
#   - Reports every missing required field in a single pass (compiler-style
#     diagnostics).
#
# The extra responsibility — what makes this distinct from
# :func:`validate_guides` — is **cross-catalogue reference checking**.
# Curation items may carry an optional ``guide_id`` field that deep-links
# the post-payment unlock screen into a full guide. The natural identity
# of a Guide is ``"<season_slug>:<category_slug>"`` (the same composite
# key :func:`content.guides.load_guide` uses), so when the caller supplies
# a ``guides`` argument the validator builds the known-id set from that
# catalogue and flags any ``guide_id`` that does not resolve. When the
# caller omits ``guides`` the validator still performs shape checks on
# the ``guide_id`` value itself (must be a non-empty string), but skips
# the cross-reference check — exactly the same "optional argument =
# optional check" pattern used by ``image_path`` on the guide side.
# ---------------------------------------------------------------------------


REQUIRED_CURATION_FIELDS: tuple[str, ...] = (
    "season",
    "headline",
    "editor_signature",
    "mood_keywords",
    "cover_palette",
    "items",
)

REQUIRED_CURATION_ITEM_FIELDS: tuple[str, ...] = (
    "kind",
    "tone",
    "title",
    "blurb",
)


def validate_curations(
    curations: Iterable[Any],
    guides: Iterable[Any] | None = None,
) -> list[ValidationError]:
    """Validate a sequence of curation packages for content integrity.

    The validator accepts either :class:`~content.curations.FirstCuration`
    dataclasses (runtime catalogue surface) or raw dicts (CMS payload
    before construction). For each curation package it reports:

      1. Every missing required field on the package
         (``season``, ``headline``, ``editor_signature``,
         ``mood_keywords``, ``cover_palette``, ``items``).
      2. Required string fields that are present but empty / whitespace.
      3. ``season`` values that aren't a :class:`Season` enum, slug, or
         Korean label.
      4. ``mood_keywords`` and ``cover_palette`` shape / content defects
         (wrong container type, empty, malformed hex codes).
      5. For every entry in ``items``: every missing required field
         (``kind``, ``tone``, ``title``, ``blurb``), empty / non-string
         title or blurb values, and — when the optional ``guide_id``
         key is present — a non-string, empty, or unresolved reference.

    Args:
        curations: Iterable of curation-shaped items —
            :class:`FirstCuration` instances and/or ``dict`` payloads can
            be mixed freely.
        guides: Optional iterable of guide-shaped items used to build the
            set of known ``guide_id`` references. When supplied, any
            ``guide_id`` on a curation item that does not resolve against
            this set is reported. When ``None`` (the default), the cross-
            reference check is skipped — the validator still flags
            structurally-broken ``guide_id`` values (non-string, empty).

    Returns:
        A list of :class:`ValidationError` records, one per defect, in
        input order. An empty list means the catalogue is integrity-clean.

    Raises:
        TypeError: only if ``curations`` (or ``guides``, when provided)
            is not iterable. Per-item type problems are reported in the
            result list, never raised.
    """
    if curations is None or isinstance(curations, (str, bytes)):
        raise TypeError(
            "curations must be a non-string iterable of curation-shaped "
            f"items, got {type(curations).__name__}"
        )

    known_guide_ids: set[str] | None = None
    if guides is not None:
        if isinstance(guides, (str, bytes)):
            raise TypeError(
                "guides must be a non-string iterable of guide-shaped "
                f"items, got {type(guides).__name__}"
            )
        known_guide_ids = _collect_guide_ids(guides)

    errors: list[ValidationError] = []
    for index, raw_curation in enumerate(curations):
        errors.extend(
            _validate_one_curation(index, raw_curation, known_guide_ids),
        )
    return errors


# ---------------------------------------------------------------------------
# Per-curation validation
# ---------------------------------------------------------------------------


def _validate_one_curation(
    index: int,
    item: Any,
    known_guide_ids: set[str] | None,
) -> list[ValidationError]:
    """Return every defect found in a single curation-shaped package."""
    errors: list[ValidationError] = []

    # 1. Required-field presence on the package
    for field in REQUIRED_CURATION_FIELDS:
        value = _read_field(item, field)
        if value is _MISSING or value is None:
            errors.append(
                ValidationError(
                    index=index,
                    field=field,
                    message=f"{field}: required field is missing",
                )
            )
            continue

        if field in ("headline", "editor_signature"):
            if not isinstance(value, str):
                errors.append(
                    ValidationError(
                        index=index,
                        field=field,
                        message=(
                            f"{field}: must be a string, " f"got {type(value).__name__}"
                        ),
                    )
                )
            elif not value.strip():
                errors.append(
                    ValidationError(
                        index=index,
                        field=field,
                        message=f"{field}: must be a non-empty string",
                    )
                )

    # 2. season: enum, slug, or Korean label
    season_value = _read_field(item, "season")
    if season_value is not _MISSING and season_value is not None:
        if not _is_valid_season(season_value):
            errors.append(
                ValidationError(
                    index=index,
                    field="season",
                    message=(
                        f"season: must be Season enum / slug / Korean label, "
                        f"got {season_value!r}"
                    ),
                )
            )

    # 3. mood_keywords
    mood_keywords = _read_field(item, "mood_keywords")
    if mood_keywords is not _MISSING and mood_keywords is not None:
        if not isinstance(mood_keywords, (tuple, list)):
            errors.append(
                ValidationError(
                    index=index,
                    field="mood_keywords",
                    message=(
                        "mood_keywords: must be tuple/list of strings, "
                        f"got {type(mood_keywords).__name__}"
                    ),
                )
            )
        elif len(mood_keywords) == 0:
            errors.append(
                ValidationError(
                    index=index,
                    field="mood_keywords",
                    message="mood_keywords: must contain at least one word",
                )
            )
        else:
            for pos, keyword in enumerate(mood_keywords):
                if not isinstance(keyword, str) or not keyword.strip():
                    errors.append(
                        ValidationError(
                            index=index,
                            field=f"mood_keywords[{pos}]",
                            message=(
                                f"mood_keywords[{pos}]: must be a "
                                f"non-empty string, got {keyword!r}"
                            ),
                        )
                    )

    # 4. cover_palette
    cover_palette = _read_field(item, "cover_palette")
    if cover_palette is not _MISSING and cover_palette is not None:
        if not isinstance(cover_palette, (tuple, list)):
            errors.append(
                ValidationError(
                    index=index,
                    field="cover_palette",
                    message=(
                        "cover_palette: must be tuple/list of #RRGGBB "
                        f"strings, got {type(cover_palette).__name__}"
                    ),
                )
            )
        else:
            for pos, hex_code in enumerate(cover_palette):
                if not _is_valid_hex_color(hex_code):
                    errors.append(
                        ValidationError(
                            index=index,
                            field=f"cover_palette[{pos}]",
                            message=(
                                f"cover_palette[{pos}]: not a valid "
                                f"#RRGGBB color, got {hex_code!r}"
                            ),
                        )
                    )

    # 5. items — recurse per-entry
    items = _read_field(item, "items")
    if items is not _MISSING and items is not None:
        if not isinstance(items, (tuple, list)):
            errors.append(
                ValidationError(
                    index=index,
                    field="items",
                    message=(
                        "items: must be tuple/list of curation-item entries, "
                        f"got {type(items).__name__}"
                    ),
                )
            )
        else:
            for pos, child in enumerate(items):
                errors.extend(
                    _validate_one_curation_item(
                        index,
                        pos,
                        child,
                        known_guide_ids,
                    ),
                )

    return errors


def _validate_one_curation_item(
    parent_index: int,
    pos: int,
    item: Any,
    known_guide_ids: set[str] | None,
) -> list[ValidationError]:
    """Return every defect found in a single curation item."""
    errors: list[ValidationError] = []
    prefix = f"items[{pos}]"

    for field in REQUIRED_CURATION_ITEM_FIELDS:
        value = _read_field(item, field)
        if value is _MISSING or value is None:
            errors.append(
                ValidationError(
                    index=parent_index,
                    field=f"{prefix}.{field}",
                    message=(f"{prefix}.{field}: required field is missing"),
                )
            )
            continue

        if field in ("title", "blurb"):
            if not isinstance(value, str):
                errors.append(
                    ValidationError(
                        index=parent_index,
                        field=f"{prefix}.{field}",
                        message=(
                            f"{prefix}.{field}: must be a string, "
                            f"got {type(value).__name__}"
                        ),
                    )
                )
            elif not value.strip():
                errors.append(
                    ValidationError(
                        index=parent_index,
                        field=f"{prefix}.{field}",
                        message=f"{prefix}.{field}: must be a non-empty string",
                    )
                )
        elif field == "kind":
            if not _is_valid_curation_kind(value):
                errors.append(
                    ValidationError(
                        index=parent_index,
                        field=f"{prefix}.kind",
                        message=(
                            f"{prefix}.kind: must be CurationItemKind "
                            f"enum / slug / Korean label, got {value!r}"
                        ),
                    )
                )
        elif field == "tone":
            if not _is_valid_wording_tone(value):
                errors.append(
                    ValidationError(
                        index=parent_index,
                        field=f"{prefix}.tone",
                        message=(
                            f"{prefix}.tone: must be WordingTone enum / "
                            f"slug / Korean label, got {value!r}"
                        ),
                    )
                )

    # guide_id reference (optional — but if present, must be well-formed
    # and, when guides were supplied, must resolve).
    if _has_field_present(item, "guide_id"):
        guide_id = _read_field(item, "guide_id")
        if guide_id is None:
            errors.append(
                ValidationError(
                    index=parent_index,
                    field=f"{prefix}.guide_id",
                    message=(
                        f"{prefix}.guide_id: must be a non-empty string, " "got None"
                    ),
                )
            )
        elif not isinstance(guide_id, str):
            errors.append(
                ValidationError(
                    index=parent_index,
                    field=f"{prefix}.guide_id",
                    message=(
                        f"{prefix}.guide_id: must be a string, "
                        f"got {type(guide_id).__name__}"
                    ),
                )
            )
        elif not guide_id.strip():
            errors.append(
                ValidationError(
                    index=parent_index,
                    field=f"{prefix}.guide_id",
                    message=f"{prefix}.guide_id: must be a non-empty string",
                )
            )
        elif known_guide_ids is not None and guide_id not in known_guide_ids:
            errors.append(
                ValidationError(
                    index=parent_index,
                    field=f"{prefix}.guide_id",
                    message=(
                        f"{prefix}.guide_id: references unknown guide "
                        f"{guide_id!r} (expected one of "
                        f"{sorted(known_guide_ids)})"
                    ),
                )
            )

    return errors


# ---------------------------------------------------------------------------
# Cross-catalogue helpers — guide id derivation + enum-shaped value checks
# ---------------------------------------------------------------------------


def _collect_guide_ids(guides: Iterable[Any]) -> set[str]:
    """Build the set of canonical guide ids from a guide iterable.

    Identity is ``"<season_slug>:<category_slug>"`` — the same composite
    key :func:`content.guides.load_guide` keys on. Entries whose season
    or category cannot be canonicalised are silently skipped: they would
    fail :func:`validate_guides` anyway, and silently skipping them keeps
    a bad row in the guide catalogue from masking *every* curation
    reference as broken.
    """
    ids: set[str] = set()
    for guide in guides:
        season_slug = _to_season_slug(_read_field(guide, "season"))
        category_slug = _to_category_slug(_read_field(guide, "category"))
        if season_slug is None or category_slug is None:
            continue
        ids.add(f"{season_slug}:{category_slug}")
    return ids


def _to_season_slug(value: Any) -> str | None:
    """Return the canonical Season slug for an enum, slug, or Korean label."""
    if value is _MISSING or value is None:
        return None
    if isinstance(value, Season):
        return value.slug
    if not isinstance(value, str):
        return None
    candidate = value.strip()
    if not candidate:
        return None
    candidate_lower = candidate.lower()
    for season in Season:
        if candidate_lower == season.slug.lower():
            return season.slug
        if candidate == season.korean:
            return season.slug
    return None


def _to_category_slug(value: Any) -> str | None:
    """Return the canonical GuideCategory slug for enum / slug / Korean label."""
    if value is _MISSING or value is None:
        return None
    if isinstance(value, GuideCategory):
        return value.slug
    if not isinstance(value, str):
        return None
    candidate = value.strip()
    if not candidate:
        return None
    candidate_lower = candidate.lower()
    for category in GuideCategory:
        if candidate_lower == category.slug.lower():
            return category.slug
        if candidate == category.label:
            return category.slug
    return None


def _is_valid_curation_kind(value: Any) -> bool:
    """Accept :class:`CurationItemKind` enum, its slug, or Korean label."""
    if isinstance(value, CurationItemKind):
        return True
    if not isinstance(value, str):
        return False
    candidate = value.strip()
    if not candidate:
        return False
    candidate_lower = candidate.lower()
    for kind in CurationItemKind:
        if candidate_lower == kind.slug.lower():
            return True
        if candidate == kind.label:
            return True
    return False


def _is_valid_wording_tone(value: Any) -> bool:
    """Accept :class:`WordingTone` enum, its slug, or Korean label."""
    if isinstance(value, WordingTone):
        return True
    if not isinstance(value, str):
        return False
    candidate = value.strip()
    if not candidate:
        return False
    candidate_lower = candidate.lower()
    for tone in WordingTone:
        if candidate_lower == tone.slug.lower():
            return True
        if candidate == tone.label:
            return True
    return False


def _read_field(item: Any, name: str) -> Any:
    """Unified getter for dicts and dataclass-style objects.

    Returns the sentinel :data:`_MISSING` when the field is absent so the
    caller can distinguish "missing" from "present-but-None".
    """
    if isinstance(item, dict):
        return item.get(name, _MISSING)
    return getattr(item, name, _MISSING)


def _has_field_present(item: Any, name: str) -> bool:
    """Return True if the field key/attribute exists on the item."""
    if isinstance(item, dict):
        return name in item
    return hasattr(item, name)


# ===========================================================================
# Sub-AC 4.3 — validate_magazines
# ===========================================================================
#
# Mirror of the validate_guides / validate_curations design, scoped to the
# monthly magazine catalogue (``content.magazines``). Same rules apply:
#
#   - Returns a list of :class:`ValidationError`, never raises on per-item
#     defects.
#   - Accepts both runtime :class:`Magazine` / :class:`MagazineArticle`
#     dataclasses *and* raw dict payloads (CMS-rewrite input), so the
#     validator works as a pre-build content gate before any constructor
#     has had a chance to hard-raise.
#   - Reports every missing required field in a single pass.
#
# The extra responsibility — what makes this distinct from the previous
# two validators — is **cross-catalogue ``curation_id`` reference checking
# against the first-curation catalogue**. The Seed ontology binds magazine
# issues to curation packages: each issue (or each per-season article
# inside it) may carry an optional ``curation_id`` that deep-links a
# reader into the curation surface they unlocked at payment.
#
# The natural identity of a :class:`FirstCuration` is its **Season slug**
# (the catalogue contains exactly one curation per Season — see
# ``content/curations.py``). So when the caller supplies a ``curations``
# argument the validator builds the known-id set as the set of season
# slugs present in the catalogue, and flags any ``curation_id`` that does
# not resolve. When the caller omits ``curations`` the validator still
# performs shape checks on the ``curation_id`` value itself (must be a
# non-empty string), but skips the cross-reference check — exactly the
# same "optional argument = optional check" pattern used by ``guide_id``
# on the curation side and ``image_path`` on the guide side.
# ---------------------------------------------------------------------------


REQUIRED_MAGAZINE_FIELDS: tuple[str, ...] = (
    "month",
    "issue_title",
    "cover_headline",
    "editor_letter",
    "articles",
)

REQUIRED_MAGAZINE_ARTICLE_FIELDS: tuple[str, ...] = (
    "season",
    "title",
    "summary",
    "body",
)


def validate_magazines(
    magazines: Iterable[Any],
    curations: Iterable[Any] | None = None,
) -> list[ValidationError]:
    """Validate a sequence of magazine issues for content integrity.

    The validator accepts either :class:`~content.magazines.Magazine` /
    :class:`~content.magazines.MagazineArticle` dataclasses (runtime
    catalogue surface) or raw dicts (CMS payload before construction).
    For each magazine issue it reports:

      1. Every missing required field on the issue
         (``month``, ``issue_title``, ``cover_headline``,
         ``editor_letter``, ``articles``).
      2. Required string fields that are present but empty / whitespace.
      3. ``month`` values that don't match the ``YYYY-MM`` shape (so a
         CMS pipeline that drops to ``"2026-5"`` or ``"2026/05"`` is
         caught before the constructor would re-raise).
      4. ``articles`` shape (must be tuple/list).
      5. For every entry in ``articles``: every missing required field
         (``season``, ``title``, ``summary``, ``body``), invalid
         ``season`` value, and empty / non-string ``title`` / ``summary``
         / ``body``.
      6. Optional ``curation_id`` on the issue *and* on every article —
         when the field/key is present, it must be a non-empty string;
         and when ``curations`` is supplied it must resolve against the
         set of known curation ids (the season slug, since the
         first-curation catalogue is keyed 1:1 on Season).

    Args:
        magazines: Iterable of magazine-shaped items —
            :class:`Magazine` instances and/or ``dict`` payloads can be
            mixed freely.
        curations: Optional iterable of curation-shaped items used to
            build the set of known ``curation_id`` references. When
            supplied, any ``curation_id`` on a magazine issue or article
            that does not resolve against this set is reported. When
            ``None`` (the default), the cross-reference check is skipped
            — the validator still flags structurally-broken
            ``curation_id`` values (non-string, empty).

    Returns:
        A list of :class:`ValidationError` records, one per defect, in
        input order. An empty list means the catalogue is integrity-
        clean.

    Raises:
        TypeError: only if ``magazines`` (or ``curations``, when
            provided) is not iterable. Per-item type problems are
            reported in the result list, never raised.
    """
    if magazines is None or isinstance(magazines, (str, bytes)):
        raise TypeError(
            "magazines must be a non-string iterable of magazine-shaped "
            f"items, got {type(magazines).__name__}"
        )

    known_curation_ids: set[str] | None = None
    if curations is not None:
        if isinstance(curations, (str, bytes)):
            raise TypeError(
                "curations must be a non-string iterable of curation-shaped "
                f"items, got {type(curations).__name__}"
            )
        known_curation_ids = _collect_curation_ids(curations)

    errors: list[ValidationError] = []
    for index, raw_magazine in enumerate(magazines):
        errors.extend(
            _validate_one_magazine(index, raw_magazine, known_curation_ids),
        )
    return errors


# ---------------------------------------------------------------------------
# Per-magazine validation
# ---------------------------------------------------------------------------


def _validate_one_magazine(
    index: int,
    item: Any,
    known_curation_ids: set[str] | None,
) -> list[ValidationError]:
    """Return every defect found in a single magazine-shaped issue."""
    errors: list[ValidationError] = []

    # 1. Required-field presence on the issue
    for field in REQUIRED_MAGAZINE_FIELDS:
        value = _read_field(item, field)
        if value is _MISSING or value is None:
            errors.append(
                ValidationError(
                    index=index,
                    field=field,
                    message=f"{field}: required field is missing",
                )
            )
            continue

        if field in ("issue_title", "cover_headline", "editor_letter"):
            if not isinstance(value, str):
                errors.append(
                    ValidationError(
                        index=index,
                        field=field,
                        message=(
                            f"{field}: must be a string, " f"got {type(value).__name__}"
                        ),
                    )
                )
            elif not value.strip():
                errors.append(
                    ValidationError(
                        index=index,
                        field=field,
                        message=f"{field}: must be a non-empty string",
                    )
                )

    # 2. month shape (YYYY-MM)
    month_value = _read_field(item, "month")
    if month_value is not _MISSING and month_value is not None:
        if not isinstance(month_value, str):
            errors.append(
                ValidationError(
                    index=index,
                    field="month",
                    message=(
                        f"month: must be a 'YYYY-MM' string, "
                        f"got {type(month_value).__name__}"
                    ),
                )
            )
        elif not _is_valid_yyyy_mm(month_value):
            errors.append(
                ValidationError(
                    index=index,
                    field="month",
                    message=(
                        f"month: must be a 'YYYY-MM' string, " f"got {month_value!r}"
                    ),
                )
            )

    # 3. articles — recurse per-entry
    articles = _read_field(item, "articles")
    if articles is not _MISSING and articles is not None:
        if not isinstance(articles, (tuple, list)):
            errors.append(
                ValidationError(
                    index=index,
                    field="articles",
                    message=(
                        "articles: must be tuple/list of article entries, "
                        f"got {type(articles).__name__}"
                    ),
                )
            )
        else:
            for pos, child in enumerate(articles):
                errors.extend(
                    _validate_one_magazine_article(
                        index,
                        pos,
                        child,
                        known_curation_ids,
                    ),
                )

    # 4. Optional curation_id on the issue itself
    if _has_field_present(item, "curation_id"):
        errors.extend(
            _validate_curation_id_field(
                index=index,
                field_path="curation_id",
                value=_read_field(item, "curation_id"),
                known_curation_ids=known_curation_ids,
            )
        )

    return errors


def _validate_one_magazine_article(
    parent_index: int,
    pos: int,
    item: Any,
    known_curation_ids: set[str] | None,
) -> list[ValidationError]:
    """Return every defect found in a single magazine article."""
    errors: list[ValidationError] = []
    prefix = f"articles[{pos}]"

    for field in REQUIRED_MAGAZINE_ARTICLE_FIELDS:
        value = _read_field(item, field)
        if value is _MISSING or value is None:
            errors.append(
                ValidationError(
                    index=parent_index,
                    field=f"{prefix}.{field}",
                    message=(f"{prefix}.{field}: required field is missing"),
                )
            )
            continue

        if field in ("title", "summary", "body"):
            if not isinstance(value, str):
                errors.append(
                    ValidationError(
                        index=parent_index,
                        field=f"{prefix}.{field}",
                        message=(
                            f"{prefix}.{field}: must be a string, "
                            f"got {type(value).__name__}"
                        ),
                    )
                )
            elif not value.strip():
                errors.append(
                    ValidationError(
                        index=parent_index,
                        field=f"{prefix}.{field}",
                        message=(f"{prefix}.{field}: must be a non-empty string"),
                    )
                )
        elif field == "season":
            if not _is_valid_season(value):
                errors.append(
                    ValidationError(
                        index=parent_index,
                        field=f"{prefix}.season",
                        message=(
                            f"{prefix}.season: must be Season enum / "
                            f"slug / Korean label, got {value!r}"
                        ),
                    )
                )

    # Optional per-article curation_id
    if _has_field_present(item, "curation_id"):
        errors.extend(
            _validate_curation_id_field(
                index=parent_index,
                field_path=f"{prefix}.curation_id",
                value=_read_field(item, "curation_id"),
                known_curation_ids=known_curation_ids,
            )
        )

    return errors


# ---------------------------------------------------------------------------
# curation_id helpers
# ---------------------------------------------------------------------------


def _validate_curation_id_field(
    index: int,
    field_path: str,
    value: Any,
    known_curation_ids: set[str] | None,
) -> list[ValidationError]:
    """Shared shape + cross-reference checker for a single ``curation_id``.

    The same rules apply whether the field appears on an issue or on an
    individual article, so the logic is factored once and the caller
    supplies the dot-pathed ``field_path``.
    """
    if value is None:
        return [
            ValidationError(
                index=index,
                field=field_path,
                message=(f"{field_path}: must be a non-empty string, got None"),
            )
        ]
    if not isinstance(value, str):
        return [
            ValidationError(
                index=index,
                field=field_path,
                message=(
                    f"{field_path}: must be a string, " f"got {type(value).__name__}"
                ),
            )
        ]
    if not value.strip():
        return [
            ValidationError(
                index=index,
                field=field_path,
                message=f"{field_path}: must be a non-empty string",
            )
        ]
    if known_curation_ids is not None and value not in known_curation_ids:
        return [
            ValidationError(
                index=index,
                field=field_path,
                message=(
                    f"{field_path}: references unknown curation "
                    f"{value!r} (expected one of "
                    f"{sorted(known_curation_ids)})"
                ),
            )
        ]
    return []


def _collect_curation_ids(curations: Iterable[Any]) -> set[str]:
    """Build the set of canonical curation ids from a curation iterable.

    Identity is the Season slug — the first-curation catalogue is keyed
    1:1 on Season, so the slug is the natural reference key for the
    magazine layer to deep-link from. Entries whose season cannot be
    canonicalised are silently skipped: they would fail
    :func:`validate_curations` anyway, and silently skipping them keeps
    a bad row in the curation catalogue from masking *every* magazine
    reference as broken.
    """
    ids: set[str] = set()
    for curation in curations:
        season_slug = _to_season_slug(_read_field(curation, "season"))
        if season_slug is None:
            continue
        ids.add(season_slug)
    return ids


def _is_valid_yyyy_mm(value: str) -> bool:
    """Strict ``YYYY-MM`` shape validator.

    Local mirror of ``content.magazines._is_valid_month`` so this module
    stays import-isolated from the magazine catalogue — the validator is
    the *pre-build* gate, and pre-build code must not be able to
    accidentally import (and thereby trigger) the catalogue's
    module-level invariants.
    """
    if not isinstance(value, str):
        return False
    if len(value) != 7 or value[4] != "-":
        return False
    year_part = value[:4]
    month_part = value[5:]
    if not (year_part.isdigit() and month_part.isdigit()):
        return False
    return 1 <= int(month_part) <= 12


# ===========================================================================
# Sub-AC 4.4 — verify_content_integrity (integration entry point)
# ===========================================================================
#
# The previous three Sub-ACs (4.1 / 4.2 / 4.3) each delivered one
# *per-catalogue* validator. Each validator owns shape rules for its own
# domain and (optionally) one cross-catalogue reference check against the
# catalogue immediately "below" it:
#
#       guides  ←  validate_guides         (no cross-ref)
#       curations  ←  validate_curations   (guide_id → guides)
#       magazines  ←  validate_magazines   (curation_id → curations)
#
# Sub-AC 4.4 is the **single integration entry point** the pre-build
# harness calls. It is intentionally a thin orchestration layer:
#
#   - It loads each catalogue (via dependency-injected loaders, so a test
#     can substitute a malformed catalogue without monkey-patching any
#     module). The defaults point at the real seeded catalogues.
#
#   - It calls every per-catalogue validator with the appropriate
#     cross-reference catalogue already wired in, so the harness gets a
#     fully-checked report — not just per-catalogue diagnostics that the
#     caller would have to recombine.
#
#   - It returns an *immutable* :class:`ContentIntegrityReport` that
#     bundles the three error-list slices, the per-catalogue counts the
#     report was computed against, and convenience aggregates
#     (``total_errors``, ``is_clean``). The frozen dataclass shape makes
#     the report safe to log, hash, dedup, and pass around the pre-build
#     harness without defensive copying.
#
#   - It never raises on content defects — exactly like the per-catalogue
#     validators, it returns the defects so the editor can fix every
#     issue in one pass (compiler-diagnostic style). It *does* propagate
#     :class:`TypeError` from the underlying validators when a loader
#     returns something completely wrong-shaped (e.g. ``None``), because
#     that's a harness-wiring bug, not a content defect.
# ---------------------------------------------------------------------------


# A loader is a zero-arg callable that returns an iterable of catalogue
# entries. The defaults below point at the real prebuilt catalogues.
GuideLoader = Callable[[], Iterable[Any]]
CurationLoader = Callable[[], Iterable[Any]]
MagazineLoader = Callable[[], Iterable[Any]]


@dataclass(frozen=True)
class ContentIntegrityReport:
    """Aggregated result of :func:`verify_content_integrity`.

    Attributes:
        guide_errors: Defects found by :func:`validate_guides`, in input
            order. Empty tuple means the guide catalogue is clean.
        curation_errors: Defects found by :func:`validate_curations`,
            including unresolved ``guide_id`` cross-references against
            the guide catalogue that was loaded for this run.
        magazine_errors: Defects found by :func:`validate_magazines`,
            including unresolved ``curation_id`` cross-references against
            the curation catalogue that was loaded for this run.
        guide_count: Number of guide entries the report was computed
            against. Useful for the pre-build harness to assert that the
            expected catalogue size landed (e.g. 16 guides).
        curation_count: Number of curation packages the report was
            computed against.
        magazine_count: Number of magazine issues the report was computed
            against.

    The three error fields are stored as tuples (not lists) so the
    report is fully immutable and safely hashable — the pre-build
    harness can dedup reports across runs without copying.
    """

    guide_errors: tuple[ValidationError, ...] = field(default_factory=tuple)
    curation_errors: tuple[ValidationError, ...] = field(default_factory=tuple)
    magazine_errors: tuple[ValidationError, ...] = field(default_factory=tuple)
    guide_count: int = 0
    curation_count: int = 0
    magazine_count: int = 0

    @property
    def total_errors(self) -> int:
        """Total number of defects across all three catalogues."""
        return (
            len(self.guide_errors)
            + len(self.curation_errors)
            + len(self.magazine_errors)
        )

    @property
    def is_clean(self) -> bool:
        """True when no defect was found in any catalogue."""
        return self.total_errors == 0

    def all_errors(self) -> tuple[ValidationError, ...]:
        """Flat tuple of every error across the three catalogues.

        Order is guides → curations → magazines — mirrors the natural
        dependency direction of the cross-reference graph, so a reader
        sees the *root cause* defects (in guides) before the
        *referent-broken* defects (in curations / magazines).
        """
        return self.guide_errors + self.curation_errors + self.magazine_errors


def _materialise_loader_output(
    loader_name: str,
    payload: Any,
) -> tuple[Any, ...]:
    """Materialise loader output to a tuple after rejecting wiring bugs.

    ``tuple(payload)`` would happily shred a bare string or bytes into
    per-character items (and choke on ``None``). Those cases are *never*
    legitimate catalogue payloads — they are harness-wiring bugs — so we
    raise :class:`TypeError` before the tuple conversion can mask the
    misuse as content defects.
    """
    if payload is None or isinstance(payload, (str, bytes)):
        raise TypeError(
            f"{loader_name} must return a non-string iterable of "
            f"catalogue items, got {type(payload).__name__}"
        )
    return tuple(payload)


def verify_content_integrity(
    *,
    guides_loader: GuideLoader | None = None,
    curations_loader: CurationLoader | None = None,
    magazines_loader: MagazineLoader | None = None,
) -> ContentIntegrityReport:
    """Run every integrity check across guides, curations, and magazines.

    This is the single entry point the pre-build harness (Sub-AC 4.5)
    calls to gate a release: it loads the three catalogues, runs every
    per-catalogue validator with the correct cross-reference catalogue
    wired in, and bundles the results into one immutable report.

    Cross-reference wiring:

      - :func:`validate_curations` is called with ``guides`` so every
        ``guide_id`` on a curation item is checked against the loaded
        guide catalogue.
      - :func:`validate_magazines` is called with ``curations`` so every
        ``curation_id`` on a magazine issue or article is checked against
        the loaded curation catalogue.

    Args:
        guides_loader: Optional zero-arg callable returning an iterable
            of guide-shaped items. Defaults to
            :func:`content.guides.load_all_guides`.
        curations_loader: Optional zero-arg callable returning an
            iterable of curation-shaped items. Defaults to
            :func:`content.curations.load_all_first_curations`.
        magazines_loader: Optional zero-arg callable returning an
            iterable of magazine-shaped items. Defaults to
            :func:`content.magazines.load_all_magazines`.

    Returns:
        A :class:`ContentIntegrityReport` with per-catalogue error
        tuples, per-catalogue counts, and aggregated convenience views.
        ``report.is_clean`` is ``True`` iff every catalogue is integrity-
        clean *and* every cross-reference resolves.

    Raises:
        TypeError: if a loader returns something the underlying
            validators consider categorically wrong-shaped (e.g.
            ``None`` or a bare string). Per-item defects are reported in
            the result, never raised — only wiring bugs surface as
            exceptions.
    """
    load_guides = guides_loader or load_all_guides
    load_curations = curations_loader or load_all_first_curations
    load_magazines = magazines_loader or load_all_magazines

    # Materialise each catalogue exactly once. Without this, a loader
    # returning a generator would be exhausted by the first validator
    # call and the cross-reference checks would silently see an empty
    # catalogue.
    #
    # The pre-tuple type guard rejects ``None`` / ``str`` / ``bytes``
    # returns at the loader level — these are wiring bugs, not content
    # defects, and ``tuple("foo")`` would silently shred a string into
    # per-character "items" that the validator would then misreport.
    guides = _materialise_loader_output("guides_loader", load_guides())
    curations = _materialise_loader_output("curations_loader", load_curations())
    magazines = _materialise_loader_output("magazines_loader", load_magazines())

    guide_errors = validate_guides(guides)
    curation_errors = validate_curations(curations, guides=guides)
    magazine_errors = validate_magazines(magazines, curations=curations)

    return ContentIntegrityReport(
        guide_errors=tuple(guide_errors),
        curation_errors=tuple(curation_errors),
        magazine_errors=tuple(magazine_errors),
        guide_count=len(guides),
        curation_count=len(curations),
        magazine_count=len(magazines),
    )


# Suppress unused-import warnings for symbols re-exported only for use by
# downstream test modules / the pre-build harness (Sub-AC 4.3 will import
# the dataclasses to assemble integration fixtures). These imports keep
# the integrity layer's surface self-contained — callers don't have to
# import content.curations separately just to construct test payloads.
__all__ = (
    "ALLOWED_IMAGE_EXTENSIONS",
    "ContentIntegrityReport",
    "REQUIRED_CURATION_FIELDS",
    "REQUIRED_CURATION_ITEM_FIELDS",
    "REQUIRED_FIELDS",
    "REQUIRED_MAGAZINE_ARTICLE_FIELDS",
    "REQUIRED_MAGAZINE_FIELDS",
    "ValidationError",
    "validate_curations",
    "validate_guides",
    "validate_magazines",
    "verify_content_integrity",
    # Re-exports for fixture assembly:
    "CurationItem",
    "CurationItemKind",
    "FirstCuration",
    "WordingTone",
)
