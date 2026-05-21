"""Prebuilt first-curation packages — 4 packages, one per Season (Sub-AC 11.2).

The first curation is the *creator's signature recommendation* that the
user unlocks the moment they clear the 12-step Glam Up payment funnel.
It is the first surface inside the paywall, and per the Seed ontology
it is a `content_package` that bundles 4 picks with mixed wording tone
("4종 — wording 톤 혼합") so the post-payment experience reads as a
handcrafted welcome, not a templated drop.

Design notes:

  - **Why exactly 4 curation packages.** The 4 Korean personal-color
    seasons (봄·여름·가을·겨울) are the bijective key the diagnosis hook
    produces (see `personal_color/season_classifier.py`). The post-
    payment unlock screen must always have *something* to render the
    moment the diagnosis result lands — and that requires one
    pre-authored package per season. No vendor call, no CMS fetch.

  - **Why each package holds exactly 4 items, one per wording tone.**
    The Seed's `content_package` concept calls out "4종 — wording 톤
    혼합". Pinning the item count to 4 and requiring one item per
    `WordingTone` member makes the "wording mix" invariant trivially
    verifiable: a duplicated tone is a test failure, not a copy-review
    miss. Mixed tone (다정·에디토리얼·유쾌·시적) is what keeps the
    package from reading as a single template.

  - **Why each package holds exactly 4 distinct kinds.** A curation
    package's job is to span the user's first session — they want a
    look (`MAKEUP_LOOK`), an outfit (`OUTFIT_PICK`), a scene to shoot
    in (`PHOTO_SCENE`), and a preset to apply to the result
    (`EDITING_PRESET`). Pinning kinds to one-each guarantees the
    package is wide, not concentrated.

  - **Why a frozen dataclass, not a dict.** Mirror of `guides.py`'s
    rationale — analytics flows through these objects (unlock taps,
    save events, share events) and the typed surface eliminates
    stringly-typed bugs at the boundary.

  - **No mutation, no I/O.** Module-level tuple of frozen dataclasses.
    A future CMS swap touches the loader-function bodies, not call
    sites.

  - **Creator signature is part of the contract.** Per the
    `creator_signature` evaluation principle, every package carries a
    first-person `editor_signature` blurb and a `mood_keywords` tuple.
    Stripping either to placeholder English would dilute the brand and
    is rejected at construction time.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from personal_color.season_classifier import Season

# ---------------------------------------------------------------------------
# Kind enum — exactly 4 members. Mirrors `GuideCategory`'s slug+label
# pattern in `guides.py`.
# ---------------------------------------------------------------------------


class CurationItemKind(Enum):
    """The 4 distinct surfaces a curation item can target.

    Each package must hold exactly one item per kind so the post-payment
    welcome spans editor-curated picks across the full user journey:
    look → outfit → scene → preset.
    """

    MAKEUP_LOOK = ("makeup_look", "메이크업 룩")
    OUTFIT_PICK = ("outfit_pick", "코디 픽")
    PHOTO_SCENE = ("photo_scene", "촬영 씬")
    EDITING_PRESET = ("editing_preset", "편집 프리셋")

    def __init__(self, slug: str, label: str) -> None:
        self.slug = slug
        self.label = label


# ---------------------------------------------------------------------------
# Wording-tone enum — exactly 4 members. Encodes the Seed's "4종 —
# wording 톤 혼합" requirement so the test suite can assert each
# package's tone histogram is a perfect 1-each.
# ---------------------------------------------------------------------------


class WordingTone(Enum):
    """The 4 wording tones the post-payment package must blend.

    Mixing tones is what makes the package read as creator-curated, not
    templated. Holding the set at exactly 4 lets the test suite check
    "every tone present exactly once" as a single invariant.
    """

    AFFECTIONATE = ("affectionate", "다정한")  # friendly editor voice
    EDITORIAL = ("editorial", "에디토리얼")  # magazine-formal
    PLAYFUL = ("playful", "유쾌한")  # light, witty
    POETIC = ("poetic", "시적인")  # mood-first, atmospheric

    def __init__(self, slug: str, label: str) -> None:
        self.slug = slug
        self.label = label


# ---------------------------------------------------------------------------
# Curation item value object
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class CurationItem:
    """One pick inside a `FirstCuration` package.

    Attributes:
        kind: Which surface (look / outfit / scene / preset) this item
            targets. Within a package every kind appears exactly once.
        tone: Which wording tone this item's copy uses. Within a package
            every tone appears exactly once.
        title: Short Korean title rendered as the item card headline.
        blurb: One-line Korean creator's note, written in `tone`.
    """

    kind: CurationItemKind
    tone: WordingTone
    title: str
    blurb: str

    def __post_init__(self) -> None:
        if not isinstance(self.kind, CurationItemKind):
            raise TypeError(
                f"kind must be a CurationItemKind enum, "
                f"got {type(self.kind).__name__}",
            )
        if not isinstance(self.tone, WordingTone):
            raise TypeError(
                f"tone must be a WordingTone enum, " f"got {type(self.tone).__name__}",
            )
        for field_name in ("title", "blurb"):
            value = getattr(self, field_name)
            if not isinstance(value, str) or not value.strip():
                raise ValueError(
                    f"{field_name} must be a non-empty string",
                )


# ---------------------------------------------------------------------------
# First-curation package value object
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class FirstCuration:
    """One season-keyed post-payment welcome package.

    Attributes:
        season: Which Korean personal-color season this package targets.
            The catalogue contains exactly one package per Season.
        headline: Short Korean signature headline on the unlock screen.
        editor_signature: First-person Korean blurb from the curator —
            the `creator_signature` surface (see Seed evaluation).
        mood_keywords: Tuple of short Korean mood words; rendered as
            chips above the items grid.
        cover_palette: Hex `#RRGGBB` colors used for the unlock-screen
            cover gradient.
        items: Exactly 4 `CurationItem` entries — one per
            `CurationItemKind` and one per `WordingTone`, so both the
            "kinds spanned" and "tones mixed" invariants are guaranteed.
    """

    season: Season
    headline: str
    editor_signature: str
    mood_keywords: tuple[str, ...]
    cover_palette: tuple[str, ...]
    items: tuple[CurationItem, ...]

    def __post_init__(self) -> None:
        if not isinstance(self.season, Season):
            raise TypeError(
                f"season must be a Season enum, " f"got {type(self.season).__name__}",
            )
        for field_name in ("headline", "editor_signature"):
            value = getattr(self, field_name)
            if not isinstance(value, str) or not value.strip():
                raise ValueError(
                    f"{field_name} must be a non-empty string",
                )
        if not isinstance(self.mood_keywords, tuple):
            raise TypeError(
                "mood_keywords must be a tuple (hashable, immutable)",
            )
        if len(self.mood_keywords) < 1:
            raise ValueError("mood_keywords must contain at least one word")
        for keyword in self.mood_keywords:
            if not isinstance(keyword, str) or not keyword.strip():
                raise ValueError(
                    f"mood_keywords entry must be non-empty string, "
                    f"got {keyword!r}",
                )
        if not isinstance(self.cover_palette, tuple):
            raise TypeError(
                "cover_palette must be a tuple (hashable, immutable)",
            )
        for hex_code in self.cover_palette:
            if not _is_valid_hex_color(hex_code):
                raise ValueError(
                    f"cover_palette entry {hex_code!r} " "is not a valid #RRGGBB color",
                )

        if not isinstance(self.items, tuple):
            raise TypeError(
                "items must be a tuple (hashable, immutable)",
            )
        if len(self.items) != 4:
            raise ValueError(
                f"first-curation package must hold exactly 4 items, "
                f"got {len(self.items)}",
            )
        kinds = {item.kind for item in self.items}
        if kinds != set(CurationItemKind):
            raise ValueError(
                "items must cover every CurationItemKind exactly once; "
                f"got kinds {sorted(k.slug for k in kinds)}",
            )
        tones = {item.tone for item in self.items}
        if tones != set(WordingTone):
            raise ValueError(
                "items must mix all 4 WordingTones exactly once; "
                f"got tones {sorted(t.slug for t in tones)}",
            )


def _is_valid_hex_color(value: str) -> bool:
    """Strict `#RRGGBB` hex-color validator. Same shape as guides.py."""
    if not isinstance(value, str):
        return False
    if len(value) != 7 or not value.startswith("#"):
        return False
    return all(c in "0123456789abcdefABCDEF" for c in value[1:])


# ---------------------------------------------------------------------------
# The 4-entry catalogue (one per Season).
#
# Order is canonical Season declaration order: 봄 → 여름 → 가을 → 겨울.
# Items within a package are ordered by `CurationItemKind` declaration
# order (look → outfit → scene → preset) so the test suite can verify
# stable rendering order.
# ---------------------------------------------------------------------------


_FIRST_CURATIONS: tuple[FirstCuration, ...] = (
    # --- 봄 (Spring) ------------------------------------------------------
    FirstCuration(
        season=Season.SPRING,
        headline="봄, 햇살 그대로의 첫 패키지",
        editor_signature=(
            "당신의 봄 웜톤을 위해 제가 가장 자주 쓰는 픽들을 모아봤어요. "
            "오늘 한 컷, 가볍게 시작해봐요."
        ),
        mood_keywords=("햇살", "살구", "산뜻", "첫 만남"),
        cover_palette=("#FFEAD2", "#FFC7B0", "#E8662F", "#8FBF6A"),
        items=(
            CurationItem(
                kind=CurationItemKind.MAKEUP_LOOK,
                tone=WordingTone.AFFECTIONATE,
                title="살구 한 톡 데일리 룩",
                blurb=(
                    "어제 산 코랄 블러셔, 한 번만 톡 두드려보세요. "
                    "그 정도면 정말 충분해요."
                ),
            ),
            CurationItem(
                kind=CurationItemKind.OUTFIT_PICK,
                tone=WordingTone.EDITORIAL,
                title="크림 베이지 × 라이트 카멜",
                blurb=(
                    "S/S 룩북에서 가장 자주 호명되는 두 컬러. "
                    "톤온톤 한 벌이면 봄 웜의 채도를 그대로 살린다."
                ),
            ),
            CurationItem(
                kind=CurationItemKind.PHOTO_SCENE,
                tone=WordingTone.PLAYFUL,
                title="오후 3시 카페 창가",
                blurb=(
                    "햇빛 들이치는 창가 자리, 거기서 한 컷만 찍어보면 "
                    "셀카가 갑자기 잘 나오기 시작할 거예요. 진짜로."
                ),
            ),
            CurationItem(
                kind=CurationItemKind.EDITING_PRESET,
                tone=WordingTone.POETIC,
                title="햇살이 닿은 자리",
                blurb=(
                    "노란 빛이 살갗 위로 번지는 순간, "
                    "그 온기만 남기고 그림자는 살짝 들어 올렸어요."
                ),
            ),
        ),
    ),
    # --- 여름 (Summer) ----------------------------------------------------
    FirstCuration(
        season=Season.SUMMER,
        headline="여름, 안개 낀 듯한 첫 패키지",
        editor_signature=(
            "당신의 여름 쿨톤이 가장 부드럽게 보이는 순간들만 골라봤어요. "
            "오늘은 조금 차분한 톤으로요."
        ),
        mood_keywords=("우윳빛", "라벤더", "차분", "소프트"),
        cover_palette=("#F4C2C2", "#C8C9E8", "#D49AB8", "#9FB4C9"),
        items=(
            CurationItem(
                kind=CurationItemKind.MAKEUP_LOOK,
                tone=WordingTone.AFFECTIONATE,
                title="로즈 글로시 데일리 룩",
                blurb=(
                    "건조한 날엔 매트보다 글로시가 훨씬 잘 받아요. "
                    "립 가운데만 살짝 덧발라보세요."
                ),
            ),
            CurationItem(
                kind=CurationItemKind.OUTFIT_PICK,
                tone=WordingTone.EDITORIAL,
                title="라이트 그레이 × 라벤더",
                blurb=(
                    "에디터스 픽: 채도를 한 단계 낮춘 두 톤의 조합. "
                    "여름 쿨의 부드러운 명도 대비를 가장 잘 보여준다."
                ),
            ),
            CurationItem(
                kind=CurationItemKind.PHOTO_SCENE,
                tone=WordingTone.PLAYFUL,
                title="비 그친 직후의 골목",
                blurb=(
                    "비 막 그쳤을 때, 그 회청색 골목이요. "
                    "거기 한 번 서 보세요. 인생샷 나올 가능성 80%."
                ),
            ),
            CurationItem(
                kind=CurationItemKind.EDITING_PRESET,
                tone=WordingTone.POETIC,
                title="안개가 머문 오후",
                blurb=(
                    "선명함을 한 겹 덜어내고, "
                    "라벤더 한 방울로 공기 자체를 부드럽게 적셨어요."
                ),
            ),
        ),
    ),
    # --- 가을 (Autumn) ---------------------------------------------------
    FirstCuration(
        season=Season.AUTUMN,
        headline="가을, 마른 잎의 첫 패키지",
        editor_signature=(
            "당신의 가을 웜톤이 가장 깊게 가라앉는 톤들로 추렸어요. "
            "오늘은 한 톤 더 진하게 가봐요."
        ),
        mood_keywords=("머스타드", "테라코타", "깊이", "벨벳"),
        cover_palette=("#B58A4A", "#8E4B2C", "#6E7A3A", "#5A2E20"),
        items=(
            CurationItem(
                kind=CurationItemKind.MAKEUP_LOOK,
                tone=WordingTone.AFFECTIONATE,
                title="브릭 매트 데일리 룩",
                blurb=(
                    "오늘처럼 흐린 날엔 브릭 매트 립이 진짜 잘 어울려요. "
                    "한 번만 발라보면 알게 되실 거예요."
                ),
            ),
            CurationItem(
                kind=CurationItemKind.OUTFIT_PICK,
                tone=WordingTone.EDITORIAL,
                title="카멜 × 머스타드 레이어드",
                blurb=(
                    "두 톤의 거리감을 좁힐수록 가을 웜의 깊이는 살아난다. "
                    "포인트는 머스타드 한 칸이면 충분."
                ),
            ),
            CurationItem(
                kind=CurationItemKind.PHOTO_SCENE,
                tone=WordingTone.PLAYFUL,
                title="해 질 무렵 단풍나무 아래",
                blurb=(
                    "노을 빛이 단풍에 한 번 더 튕겨 나오는 그 순간이요. "
                    "그때 셔터를 누르면 반칙급으로 잘 나옵니다."
                ),
            ),
            CurationItem(
                kind=CurationItemKind.EDITING_PRESET,
                tone=WordingTone.POETIC,
                title="마른 잎이 쌓인 자리",
                blurb=(
                    "오렌지의 채도를 한 칸 가라앉히고, "
                    "그림자엔 갈색을 한 겹 덧입혔어요."
                ),
            ),
        ),
    ),
    # --- 겨울 (Winter) ----------------------------------------------------
    FirstCuration(
        season=Season.WINTER,
        headline="겨울, 또렷한 한 컷의 첫 패키지",
        editor_signature=(
            "당신의 겨울 쿨톤이 가장 또렷하게 살아나는 조합만 골랐어요. "
            "오늘은 콘트라스트를 두려워하지 말아요."
        ),
        mood_keywords=("잉크", "콘트라스트", "선명", "실버"),
        cover_palette=("#0F1116", "#FFFFFF", "#8B1E3F", "#1F3FA8"),
        items=(
            CurationItem(
                kind=CurationItemKind.MAKEUP_LOOK,
                tone=WordingTone.AFFECTIONATE,
                title="와인 풀립 데일리 룩",
                blurb=(
                    "겁먹지 말고 입술 안쪽까지 꽉 채워보세요. "
                    "그게 당신한테 진짜 잘 어울려요."
                ),
            ),
            CurationItem(
                kind=CurationItemKind.OUTFIT_PICK,
                tone=WordingTone.EDITORIAL,
                title="순백 × 잉크 블랙",
                blurb=(
                    "겨울 쿨의 정답은 명도 대비. "
                    "최소한의 색, 최대한의 면적으로 정리한다."
                ),
            ),
            CurationItem(
                kind=CurationItemKind.PHOTO_SCENE,
                tone=WordingTone.PLAYFUL,
                title="눈 온 다음 날 화이트 벽",
                blurb=(
                    "흰 벽 앞에 검은 코트, 그거 하나면 끝나요. "
                    "별거 안 했는데 왜 이렇게 잘 나오지 싶을 거예요."
                ),
            ),
            CurationItem(
                kind=CurationItemKind.EDITING_PRESET,
                tone=WordingTone.POETIC,
                title="잉크가 번진 한 페이지",
                blurb=(
                    "검정의 채도는 한 칸 깊게, "
                    "흰빛의 가장자리는 칼처럼 또렷하게 잘라냈어요."
                ),
            ),
        ),
    ),
)

# Defence-in-depth — the test suite still checks this, but raising at
# import keeps a content-rewrite mistake from reaching the unlock screen
# silently.
assert len(_FIRST_CURATIONS) == 4, (
    "first-curation catalogue must have exactly 4 packages "
    "(one per Korean personal-color season)"
)
assert {c.season for c in _FIRST_CURATIONS} == set(
    Season
), "first-curation catalogue must cover all 4 Seasons exactly once"


# ---------------------------------------------------------------------------
# Public loader API. Mirrors guides.py's loader shape so call sites stay
# uniform across the two content surfaces.
# ---------------------------------------------------------------------------


def load_all_first_curations() -> tuple[FirstCuration, ...]:
    """Return the full 4-package first-curation catalogue.

    Order is canonical Season declaration order (봄 → 여름 → 가을 → 겨울).
    The returned tuple is the underlying immutable constant.
    """
    return _FIRST_CURATIONS


def load_first_curation_for_season(season: Season) -> FirstCuration:
    """Return the single first-curation package keyed to `season`.

    Args:
        season: One of the 4 `Season` enum members.

    Returns:
        The `FirstCuration` for that season.

    Raises:
        TypeError: if `season` is not a `Season` enum member.
        KeyError: if no package exists for the season. Treated as a hard
            contract violation — the catalogue is supposed to be
            exhaustive, so a miss means a content-rewrite removed a
            row by accident.
    """
    if not isinstance(season, Season):
        raise TypeError(
            f"season must be a Season enum, got {type(season).__name__}",
        )
    for curation in _FIRST_CURATIONS:
        if curation.season is season:
            return curation
    raise KeyError(
        f"no first-curation registered for {season.name}; "
        "catalogue is supposed to be exhaustive — check content/curations.py",
    )


def first_curation_count_by_season() -> dict[Season, int]:
    """Return a {season: count} histogram across the catalogue.

    Used by the test suite to verify the 1-per-season invariant in a
    single pass (mirror of `guide_count_by_season` in guides.py).
    """
    counts: dict[Season, int] = {s: 0 for s in Season}
    for curation in _FIRST_CURATIONS:
        counts[curation.season] += 1
    return counts


# ---------------------------------------------------------------------------
# AC-aliased lookup. The Seed AC names the lookup `get_curation_by_color`,
# where "color" is the user-facing term for the 4 Korean personal-color
# seasons. This is a thin facade over `load_first_curation_for_season`
# that also accepts the season slug ("spring"/"summer"/"autumn"/"winter")
# or the Korean display label ("봄"/"여름"/"가을"/"겨울"). All three are
# the same concept and we want the funnel layer to be able to call this
# regardless of whether it holds the enum, the analytics slug, or the
# label it just rendered on screen.
# ---------------------------------------------------------------------------


def get_curation_by_color(color: Season | str) -> FirstCuration:
    """Return the first-curation package for one personal-color season.

    Accepts either:
      - a `Season` enum member (canonical),
      - the lowercase English slug ("spring", "summer", "autumn",
        "winter"), or
      - the Korean display label ("봄", "여름", "가을", "겨울").

    Args:
        color: Personal-color identifier in any of the three accepted
            forms above. Case-insensitive for the English slug.

    Returns:
        The matching `FirstCuration` package.

    Raises:
        TypeError: if `color` is not a `Season` or a `str`.
        KeyError: if the string does not resolve to any Season.
    """
    if isinstance(color, Season):
        return load_first_curation_for_season(color)
    if not isinstance(color, str):
        raise TypeError(
            "color must be a Season enum or a season name string; "
            f"got {type(color).__name__}",
        )
    normalized = color.strip()
    if not normalized:
        raise KeyError("color string is empty")
    # Try slug (case-insensitive) first, then Korean label.
    slug_lower = normalized.lower()
    for season in Season:
        if season.slug == slug_lower:
            return load_first_curation_for_season(season)
    for season in Season:
        if season.korean == normalized:
            return load_first_curation_for_season(season)
    raise KeyError(
        f"unknown personal-color identifier {color!r}; "
        "expected one of spring/summer/autumn/winter or 봄/여름/가을/겨울",
    )
