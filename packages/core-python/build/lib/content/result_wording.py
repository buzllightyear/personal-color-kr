"""Result-wording combiner — category × guide × recommendation (Sub-AC 6.2).

The Seed ontology lists `result_wording` as the *combined* post-diagnosis
wording surface — a single deliverable that blends three pre-existing
copy layers without rewriting any of them:

    카테고리(분류)  + 가이드(상세)  + 추천(시그니처)

  - **카테고리 (category)** is the authoritative one-line verdict the
    user reads first ("당신은 봄 웜톤입니다"). It comes from the
    season classifier result.
  - **가이드 (guide)** is the per-category detail block (4 entries —
    makeup / outfit / hair / accessory) that lives in
    `content.guides`. We pull titles + summaries; the long body stays
    on the expanded detail screen.
  - **추천 (recommendation)** is the signature creator voice that
    lives in `content.curations` — the editor signature plus the 4
    item blurbs that already carry the *wording-tone-mix* invariant
    (다정·에디토리얼·유쾌·시적, one each).

This module is **pure composition** — it imports from
``content.guides``, ``content.curations``, and
``personal_color.season_classifier``, and returns a single immutable
``ResultWording`` value object. It never rewrites copy and never
calls a vendor.

Why a value object instead of just a string:

  - The combined string is convenient for tests and for a fast-path
    renderer, but the three layers are separate UX surfaces (verdict
    chip, grid, signature card). Exposing them as named fields lets
    the funnel layer render each layer independently without
    re-parsing a string.
  - The tones present in the recommendation layer are surfaced as a
    tuple so analytics can verify the "wording 톤 혼합" invariant
    without re-running the curation loader.

Why we accept either ``DiagnosisResult`` or ``Season``:

  - The funnel layer holds a full ``DiagnosisResult`` after the
    diagnosis step, but the magazine-publisher and the post-payment
    pre-render paths only know the ``Season``. Accepting both keeps
    the function callable from both sites without a wrapping helper.

No mutation, no I/O. All inputs are either enums or frozen
dataclasses; the output is a frozen dataclass.
"""

from __future__ import annotations

from dataclasses import dataclass

from content.curations import (
    CurationItem,
    FirstCuration,
    WordingTone,
    load_first_curation_for_season,
)
from content.guides import (
    Guide,
    load_guides_for_season,
)
from personal_color.diagnosis_orchestrator import DiagnosisResult
from personal_color.season_classifier import Season

# ---------------------------------------------------------------------------
# Result value object
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ResultWording:
    """Combined category × guide × recommendation wording for one season.

    Attributes:
        season: The Korean personal-color season this wording targets.
            Authoritative — every other field is keyed off it.
        category_line: The 분류 verdict — one Korean sentence the user
            reads first. Includes the Season's hangul label.
        guide_lines: The 상세 layer — one short Korean line per
            ``GuideCategory`` in canonical order (makeup → outfit →
            hair → accessory). Each line is ``"{label} — {title}: {summary}"``.
        recommendation_lines: The 시그니처 layer — the curation editor
            signature followed by one line per ``CurationItem``, each
            line prefixed with the item's wording-tone label so the
            tone mix is visible on the rendered surface itself.
        tones: Tuple of every ``WordingTone`` that appears in
            ``recommendation_lines``. The curation contract guarantees
            this is exactly the 4 members of ``WordingTone``, but we
            re-expose the histogram so analytics and tests do not have
            to re-walk the curation.
        combined_text: A newline-joined rendering of category +
            guides + recommendation, with section markers so a
            fast-path renderer can dump it to a result screen and a
            unit test can assert presence of every layer in one
            substring check.
    """

    season: Season
    category_line: str
    guide_lines: tuple[str, ...]
    recommendation_lines: tuple[str, ...]
    tones: tuple[WordingTone, ...]
    combined_text: str

    def __post_init__(self) -> None:
        # Defence-in-depth — every field here is produced by this module,
        # so a violation means we broke our own contract. Catching it at
        # construction surfaces the bug at the call site, not in the UI.
        if not isinstance(self.season, Season):
            raise TypeError(
                "season must be a Season enum, " f"got {type(self.season).__name__}",
            )
        for field_name in ("category_line", "combined_text"):
            value = getattr(self, field_name)
            if not isinstance(value, str) or not value.strip():
                raise ValueError(f"{field_name} must be a non-empty string")
        for field_name in ("guide_lines", "recommendation_lines", "tones"):
            value = getattr(self, field_name)
            if not isinstance(value, tuple):
                raise TypeError(
                    f"{field_name} must be a tuple (immutable, hashable), "
                    f"got {type(value).__name__}",
                )
            if len(value) == 0:
                raise ValueError(f"{field_name} must be non-empty")


# ---------------------------------------------------------------------------
# Section markers — kept as module constants so a renderer can split the
# combined text deterministically and the test suite can assert
# section presence without hard-coding strings inline.
# ---------------------------------------------------------------------------

_SECTION_CATEGORY = "[분류]"
_SECTION_GUIDE = "[상세 가이드]"
_SECTION_RECOMMENDATION = "[추천 시그니처]"


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def build_result_wording(
    source: DiagnosisResult | Season,
    *,
    guides: tuple[Guide, ...] | None = None,
    curation: FirstCuration | None = None,
) -> ResultWording:
    """Combine the three wording layers for one personal-color season.

    Args:
        source: Either a ``DiagnosisResult`` from the diagnosis
            orchestrator, or a bare ``Season`` enum member. When a
            ``DiagnosisResult`` is provided, its confidence is woven
            into the category line.
        guides: Optional override for the guide tuple. If omitted, the
            guides for ``season`` are loaded from ``content.guides``.
            Provided callers (e.g. a magazine pre-render with a curated
            subset of guides) can pass a smaller tuple.
        curation: Optional override for the curation package. If omitted,
            the first-curation for ``season`` is loaded from
            ``content.curations``.

    Returns:
        A ``ResultWording`` value object whose ``combined_text`` is a
        renderable Korean string with three section markers
        (``[분류]``, ``[상세 가이드]``, ``[추천 시그니처]``).

    Raises:
        TypeError: if ``source``, ``guides``, or ``curation`` is the
            wrong type.
        ValueError: if a provided ``guides`` tuple is empty or any of
            the provided objects target a different season.
    """
    season, confidence = _resolve_source(source)

    if guides is None:
        guides = load_guides_for_season(season)
    else:
        _validate_guides(guides, season=season)

    if curation is None:
        curation = load_first_curation_for_season(season)
    else:
        _validate_curation(curation, season=season)

    category_line = _build_category_line(season, confidence=confidence)
    guide_lines = _build_guide_lines(guides)
    recommendation_lines = _build_recommendation_lines(curation)
    tones = tuple(item.tone for item in curation.items)
    combined_text = _build_combined_text(
        category_line=category_line,
        guide_lines=guide_lines,
        recommendation_lines=recommendation_lines,
    )

    return ResultWording(
        season=season,
        category_line=category_line,
        guide_lines=guide_lines,
        recommendation_lines=recommendation_lines,
        tones=tones,
        combined_text=combined_text,
    )


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _resolve_source(
    source: DiagnosisResult | Season,
) -> tuple[Season, float | None]:
    """Normalize the polymorphic ``source`` parameter.

    Returns the resolved ``Season`` and an optional confidence float
    (only available when source is a full DiagnosisResult).
    """
    if isinstance(source, DiagnosisResult):
        return source.season, source.confidence
    if isinstance(source, Season):
        return source, None
    raise TypeError(
        "source must be a DiagnosisResult or a Season enum, "
        f"got {type(source).__name__}",
    )


def _validate_guides(guides: tuple[Guide, ...], *, season: Season) -> None:
    if not isinstance(guides, tuple):
        raise TypeError(
            f"guides must be a tuple, got {type(guides).__name__}",
        )
    if len(guides) == 0:
        raise ValueError("guides must contain at least one Guide entry")
    for index, guide in enumerate(guides):
        if not isinstance(guide, Guide):
            raise TypeError(
                f"guides[{index}] must be a Guide, " f"got {type(guide).__name__}",
            )
        if guide.season is not season:
            raise ValueError(
                f"guides[{index}].season ({guide.season.name}) does not "
                f"match resolved season ({season.name})",
            )


def _validate_curation(curation: FirstCuration, *, season: Season) -> None:
    if not isinstance(curation, FirstCuration):
        raise TypeError(
            "curation must be a FirstCuration, " f"got {type(curation).__name__}",
        )
    if curation.season is not season:
        raise ValueError(
            f"curation.season ({curation.season.name}) does not "
            f"match resolved season ({season.name})",
        )


def _build_category_line(season: Season, *, confidence: float | None) -> str:
    """The 분류 line — short, authoritative, hangul-first.

    When confidence is available (a real DiagnosisResult, not a bare
    Season), we surface it as an integer percentage so the funnel UI can
    show a single line like '당신은 92% 봄 웜톤입니다'. When confidence
    is None (the magazine pre-render path), we keep the line short:
    '당신은 봄 웜톤입니다'.
    """
    if confidence is None:
        return f"당신은 {season.korean} 톤입니다."
    pct = max(0, min(100, int(round(confidence * 100))))
    return f"당신은 {pct}% {season.korean} 톤입니다."


def _build_guide_lines(guides: tuple[Guide, ...]) -> tuple[str, ...]:
    """The 상세 layer — one line per guide.

    Format: ``"{category_label} — {title}: {summary}"``. Keeping the
    category label in front means the funnel's plain-text fallback (and
    the tests) can sanity-check coverage of all 4 categories without
    re-parsing the original Guide objects.
    """
    return tuple(f"{g.category.label} — {g.title}: {g.summary}" for g in guides)


def _build_recommendation_lines(curation: FirstCuration) -> tuple[str, ...]:
    """The 시그니처 layer — editor signature followed by the 4 items.

    Each item line is prefixed with its wording-tone label so the tone
    mix is visible on the rendered surface itself; this is what the
    Sub-AC test asserts as proof of "톤 혼합".
    """
    lines: list[str] = [
        f"{curation.headline}",
        f"에디터의 한 줄: {curation.editor_signature}",
    ]
    for item in curation.items:
        lines.append(_format_recommendation_item(item))
    return tuple(lines)


def _format_recommendation_item(item: CurationItem) -> str:
    """Render one curation item with its tone label prefix.

    Format: ``"({tone_label}) {kind_label} · {title} — {blurb}"``.
    The tone label is the Korean display label of the WordingTone enum
    (다정한 / 에디토리얼 / 유쾌한 / 시적인). The kind label is the
    Korean display label of the CurationItemKind enum (메이크업 룩 /
    코디 픽 / 촬영 씬 / 편집 프리셋).
    """
    return f"({item.tone.label}) " f"{item.kind.label} · {item.title} — {item.blurb}"


def _build_combined_text(
    *,
    category_line: str,
    guide_lines: tuple[str, ...],
    recommendation_lines: tuple[str, ...],
) -> str:
    """Render the three layers as a single newline-separated string."""
    parts: list[str] = [
        _SECTION_CATEGORY,
        category_line,
        "",
        _SECTION_GUIDE,
        *guide_lines,
        "",
        _SECTION_RECOMMENDATION,
        *recommendation_lines,
    ]
    return "\n".join(parts)
