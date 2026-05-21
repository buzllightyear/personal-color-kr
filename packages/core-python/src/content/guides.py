"""Prebuilt guide library — 4 퍼스널 컬러 × 4 카테고리 = 16 guides (Sub-AC 11.1).

Each `Season` (봄 / 여름 / 가을 / 겨울) ships with one guide per
`GuideCategory` (메이크업 / 코디 / 헤어 / 액세서리). That gives the
post-diagnosis screen a stable 4-tile grid the moment a user lands on
their result, without the diagnosis funnel having to wait on a vendor
call or a CMS round-trip.

Design notes:

  - **Why 4 × 4, not 4 × N.** The post-payment content_package (per the
    Seed ontology) hands the user *one* guide per category at unlock time
    so each Season → grid layout is predictable. Holding the catalog at
    exactly 16 entries makes the "category-by-category 4 entries"
    invariant trivially verifiable and forces every season to keep parity
    when content is rewritten.

  - **Why a frozen dataclass, not a dict.** Guides flow through analytics
    (impressions, taps, share events) and through the future vendor
    prompt-template assembler. A typed surface (`Guide.title` →
    `str`, never `KeyError`) prevents string-typo bugs the way
    `tone_classifier`'s enums prevent stringly-typed-tone bugs.

  - **No mutation, no I/O.** The 16 entries are a tuple of frozen
    dataclasses. The loader functions return slices of that tuple. A
    future CMS-backed implementation can swap the constants for a network
    call without changing the public API — every call site stays on the
    loader functions.

  - **Korean copy is part of the contract.** The guide_text concept in
    the Seed ontology is the *creator's signature* surface. Generic /
    machine-generated content would dilute the brand and break the
    `creator_signature` evaluation principle, so the body strings here
    are intentionally voice-first and category-specific.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from personal_color.season_classifier import Season

# ---------------------------------------------------------------------------
# Category enum — exactly 4 members. Keeping the values as stable slugs
# (English) and pairing them with Korean display labels follows the same
# pattern as `Season` in `personal_color.season_classifier`.
# ---------------------------------------------------------------------------


class GuideCategory(Enum):
    """The 4 surfaces a guide can cover.

    Each member carries:
      - a stable `slug` (English, for analytics / serialization)
      - a Korean display `label` (rendered on the post-diagnosis grid)
    """

    MAKEUP = ("makeup", "메이크업")
    OUTFIT = ("outfit", "코디")
    HAIR = ("hair", "헤어")
    ACCESSORY = ("accessory", "액세서리")

    def __init__(self, slug: str, label: str) -> None:
        self.slug = slug
        self.label = label


# ---------------------------------------------------------------------------
# Guide value object
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Guide:
    """One prebuilt guide entry.

    Attributes:
        season: Which 4-category Korean personal color this guide targets.
        category: Which of the 4 surfaces (makeup / outfit / hair /
            accessory) this guide covers.
        title: Short Korean title rendered as the grid card headline.
        summary: One-line Korean blurb rendered under the title in the
            grid; should read as "one signature insight," not a tagline.
        body: Long-form Korean body shown when the user expands the guide
            on the detail screen. Markdown-flavoured plain text.
        palette: Hex color codes (`#RRGGBB`) the guide recommends —
            empty for categories where a literal palette isn't the
            right primitive (e.g., MAKEUP application order). Kept as a
            tuple so the dataclass stays hashable.
    """

    season: Season
    category: GuideCategory
    title: str
    summary: str
    body: str
    palette: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        # Validate at construction time so a future content rewrite that
        # drops a field surfaces immediately at module-import, not at the
        # first user-facing render.
        if not isinstance(self.season, Season):
            raise TypeError(
                f"season must be a Season enum, got {type(self.season).__name__}",
            )
        if not isinstance(self.category, GuideCategory):
            raise TypeError(
                f"category must be a GuideCategory enum, "
                f"got {type(self.category).__name__}",
            )
        for field_name in ("title", "summary", "body"):
            value = getattr(self, field_name)
            if not isinstance(value, str) or not value.strip():
                raise ValueError(
                    f"{field_name} must be a non-empty string",
                )
        for hex_code in self.palette:
            if not _is_valid_hex_color(hex_code):
                raise ValueError(
                    f"palette entry {hex_code!r} is not a valid #RRGGBB color",
                )


def _is_valid_hex_color(value: str) -> bool:
    """Strict `#RRGGBB` hex-color validator.

    Kept small and explicit (no regex import) — the constructor only runs
    once at module load, and a misuse here should look like a content
    error, not a parsing puzzle.
    """
    if not isinstance(value, str):
        return False
    if len(value) != 7 or not value.startswith("#"):
        return False
    return all(c in "0123456789abcdefABCDEF" for c in value[1:])


# ---------------------------------------------------------------------------
# The 16-entry catalogue (4 seasons × 4 categories).
#
# Order is canonical: outer loop on Season (Spring → Summer → Autumn →
# Winter), inner loop on GuideCategory (Makeup → Outfit → Hair →
# Accessory). The test suite uses this canonical order to verify parity.
# ---------------------------------------------------------------------------


_GUIDES: tuple[Guide, ...] = (
    # --- 봄 (Spring) ------------------------------------------------------
    Guide(
        season=Season.SPRING,
        category=GuideCategory.MAKEUP,
        title="봄 웜톤 — 생기 한 스푼 메이크업",
        summary="피치·코랄 베이스로 햇살 든 얼굴을 그려줍니다.",
        body=(
            "베이스는 한 톤 밝은 아이보리로 가볍게 깔고,\n"
            "블러셔는 살구·코랄 사이에서 가장 따뜻한 쪽을 골라요.\n"
            "립은 오렌지 끼 도는 코랄로, 입꼬리부터 안쪽으로 그라데이션.\n"
            "아이는 골드 펄을 눈두덩 중앙에만 톡 — 라인은 브라운으로 가늘게."
        ),
        palette=("#FFC7B0", "#FF8E72", "#E8662F", "#C9A35B"),
    ),
    Guide(
        season=Season.SPRING,
        category=GuideCategory.OUTFIT,
        title="봄 웜톤 — 햇살 색 코디 팔레트",
        summary="크림 베이지 위에 살구·라이트 카멜을 얹으세요.",
        body=(
            "기본 톤은 크림 아이보리와 라이트 카멜로 잡고,\n"
            "포인트 한 칸은 살구 또는 옐로 그린.\n"
            "회색·검정 단색은 얼굴 빛을 가라앉히니 피하고,\n"
            "꼭 쓰고 싶다면 따뜻한 베이지로 가까이 둬요."
        ),
        palette=("#FFEAD2", "#F8B878", "#C68750", "#8FBF6A"),
    ),
    Guide(
        season=Season.SPRING,
        category=GuideCategory.HAIR,
        title="봄 웜톤 — 햇빛 비친 헤어 컬러",
        summary="라이트 브라운에 골드 글로우 한 단계만 더해주세요.",
        body=(
            "베이스는 라이트 브라운, 햇빛에 살짝 비친 정도의 골드 글로스.\n"
            "어두운 블루 블랙은 봄 웜의 생기를 눌러버려요.\n"
            "탈색은 6레벨 이상이면 충분 — 그 이상 띄우면 노란기가 떠요.\n"
            "끝단에 라이트 카멜 옴브레로 부드럽게 마무리하면 좋아요."
        ),
        palette=("#A87045", "#C49060", "#E0B57E"),
    ),
    Guide(
        season=Season.SPRING,
        category=GuideCategory.ACCESSORY,
        title="봄 웜톤 — 옐로 골드 한 점",
        summary="옐로 골드 작은 면적으로 얼굴 가까이.",
        body=(
            "금속은 옐로 골드 또는 로즈 골드.\n"
            "실버·플래티넘은 얼굴 빛을 차게 만들어 피해요.\n"
            "스톤은 시트린·페리도트·산호처럼 따뜻한 채도.\n"
            "한 점만 크게 — 또는 작게 여러 개, 둘 중 하나로 통일."
        ),
        palette=("#E7B741", "#D88B5C"),
    ),
    # --- 여름 (Summer) ----------------------------------------------------
    Guide(
        season=Season.SUMMER,
        category=GuideCategory.MAKEUP,
        title="여름 쿨톤 — 우윳빛 무드 메이크업",
        summary="로즈·라벤더로 부드럽게 깔아주는 쿨 무드.",
        body=(
            "베이스는 핑크 베이지로 한 톤 정돈하고,\n"
            "블러셔는 로즈·라벤더 핑크에서 채도가 가장 낮은 쪽으로.\n"
            "립은 콜드 로즈·맥적색, 매트보다 글로시가 어울려요.\n"
            "아이는 라벤더·그레이쉬 핑크 — 라인은 다크 브라운 대신 그레이로."
        ),
        palette=("#F4C2C2", "#D49AB8", "#A67BB0", "#9CA3AF"),
    ),
    Guide(
        season=Season.SUMMER,
        category=GuideCategory.OUTFIT,
        title="여름 쿨톤 — 안개 낀 듯한 코디",
        summary="라이트 그레이·라벤더·소프트 블루의 조합.",
        body=(
            "기본 톤은 라이트 그레이·아이보리 화이트.\n"
            "포인트는 라벤더, 더스티 핑크, 소프트 블루 중 하나만.\n"
            "선명한 빨강이나 오렌지는 얼굴을 붕 띄우니 피하고,\n"
            "꼭 컬러를 쓴다면 채도를 한 단계 떨어뜨려요."
        ),
        palette=("#E5E7EB", "#C8C9E8", "#B6CBE0", "#D5B8D5"),
    ),
    Guide(
        season=Season.SUMMER,
        category=GuideCategory.HAIR,
        title="여름 쿨톤 — 애쉬 한 방울",
        summary="다크 애쉬 브라운으로 차분하게 잡아주세요.",
        body=(
            "베이스는 애쉬 브라운, 절대 옐로톤이 뜨지 않게 해요.\n"
            "보라기 살짝 도는 다크 브라운도 잘 받습니다.\n"
            "옐로 골드 하이라이트는 얼굴이 누렇게 보이므로 비추.\n"
            "탈색은 8레벨 이상에서 토너로 노란기를 꼭 잡아줘요."
        ),
        palette=("#6E6A7A", "#8F8A9C", "#5A5466"),
    ),
    Guide(
        season=Season.SUMMER,
        category=GuideCategory.ACCESSORY,
        title="여름 쿨톤 — 실버 & 화이트 골드",
        summary="실버·플래티넘으로 정리된 한 끗.",
        body=(
            "금속은 실버·화이트 골드·플래티넘.\n"
            "옐로 골드는 피부 톤과 부딪혀 누렇게 떠요.\n"
            "스톤은 아쿠아마린·로즈쿼츠·자수정 같은 쿨 채도.\n"
            "면적은 작고 얇게, 여러 점을 레이어드하는 쪽이 잘 어울려요."
        ),
        palette=("#C0C7D1", "#9FB4C9"),
    ),
    # --- 가을 (Autumn) ---------------------------------------------------
    Guide(
        season=Season.AUTUMN,
        category=GuideCategory.MAKEUP,
        title="가을 웜톤 — 깊은 머스타드 메이크업",
        summary="브릭·테라코타로 한 톤 진하게 가라앉혀요.",
        body=(
            "베이스는 옐로 베이지로 한 톤 묵직하게 깔고,\n"
            "블러셔는 테라코타·브릭. 광택보다 매트가 어울려요.\n"
            "립은 브릭 레드·머드 베이지, 매트 텍스처를 입꼬리부터.\n"
            "아이는 카키·머스타드·딥 브라운으로 한 단계씩 그라데이션."
        ),
        palette=("#B86842", "#9E5031", "#7A3D26", "#A88444"),
    ),
    Guide(
        season=Season.AUTUMN,
        category=GuideCategory.OUTFIT,
        title="가을 웜톤 — 마른 잎의 코디",
        summary="머스타드·카멜·올리브의 깊은 톤 레이어드.",
        body=(
            "기본 톤은 카멜·다크 베이지·머스타드.\n"
            "포인트는 올리브 그린, 와인 브라운, 테라코타.\n"
            "선명한 핑크·블루는 얼굴이 들떠 보이니 피해요.\n"
            "검정 대신 다크 브라운으로, 흰색 대신 아이보리로."
        ),
        palette=("#B58A4A", "#7B5A2A", "#6E7A3A", "#8E4B2C"),
    ),
    Guide(
        season=Season.AUTUMN,
        category=GuideCategory.HAIR,
        title="가을 웜톤 — 단풍 든 갈색",
        summary="딥 브라운에 레드 글로스 한 겹.",
        body=(
            "베이스는 딥 브라운, 햇빛에 레드 끼가 살짝 도는 정도.\n"
            "코퍼·체스트넛·다크 카멜 모두 잘 받아요.\n"
            "쿨한 애쉬·블루 블랙은 가을 웜의 깊이를 죽이니 비추.\n"
            "옴브레보다 단일 톤이 더 잘 어울리는 시즌이에요."
        ),
        palette=("#5A2E20", "#7C3F26", "#A35B33"),
    ),
    Guide(
        season=Season.AUTUMN,
        category=GuideCategory.ACCESSORY,
        title="가을 웜톤 — 앤틱 골드 & 가죽",
        summary="무광 골드와 다크 브라운 가죽으로 무게감.",
        body=(
            "금속은 앤틱 골드·브론즈처럼 광택이 죽은 쪽.\n"
            "유광 옐로 골드도 가능하지만 면적을 줄여주세요.\n"
            "스톤은 호박·가넷·타이거 아이로 따뜻한 깊이를.\n"
            "가죽·우드·니트 텍스처와 함께 매치하면 가장 잘 살아요."
        ),
        palette=("#8E6A2C", "#5B3A1E"),
    ),
    # --- 겨울 (Winter) ----------------------------------------------------
    Guide(
        season=Season.WINTER,
        category=GuideCategory.MAKEUP,
        title="겨울 쿨톤 — 또렷한 콘트라스트",
        summary="화이트 베이스에 와인·푸시아로 또렷하게.",
        body=(
            "베이스는 핑크 화이트로 가장 환하게 깔고,\n"
            "블러셔는 콜드 핑크·푸시아, 면적은 작고 또렷이.\n"
            "립은 와인·체리 레드·플럼 — 풀립으로 채워서 콘트라스트.\n"
            "아이는 차콜·블루 블랙으로 라인을 또렷이, 펄은 실버 한 톡."
        ),
        palette=("#8B1E3F", "#C2185B", "#3B3F66", "#0F1116"),
    ),
    Guide(
        season=Season.WINTER,
        category=GuideCategory.OUTFIT,
        title="겨울 쿨톤 — 정확한 채도의 코디",
        summary="진한 검정·순백·로열 블루로 콘트라스트.",
        body=(
            "기본 톤은 순백·진한 검정.\n"
            "포인트는 로열 블루, 푸시아, 와인.\n"
            "흐린 베이지·머스타드는 얼굴이 칙칙해져요.\n"
            "한 벌 안에서 색은 최대 3개 — 면적 대비를 분명하게."
        ),
        palette=("#0F1116", "#FFFFFF", "#1F3FA8", "#8B1E3F"),
    ),
    Guide(
        season=Season.WINTER,
        category=GuideCategory.HAIR,
        title="겨울 쿨톤 — 잉크 같은 검정",
        summary="블루 블랙 또는 다크 애쉬로 또렷하게.",
        body=(
            "베이스는 블루 블랙·다크 애쉬.\n"
            "노란기 도는 브라운은 피부를 누렇게 만들어요.\n"
            "탈색은 신중히 — 화이트 그레이까지 빼는 게 아니면 비추.\n"
            "옴브레보다 단일 톤, 또는 차가운 그레이 옴브레가 어울려요."
        ),
        palette=("#0E1320", "#2A2D3A", "#4A4D5A"),
    ),
    Guide(
        season=Season.WINTER,
        category=GuideCategory.ACCESSORY,
        title="겨울 쿨톤 — 실버 메탈의 무게",
        summary="실버·플래티넘을 크고 분명하게.",
        body=(
            "금속은 실버·플래티넘·화이트 골드.\n"
            "옐로 골드는 얼굴을 가라앉혀 비추.\n"
            "스톤은 다이아·사파이어·블랙 오닉스처럼 명확한 채도.\n"
            "한 점을 크게 — 작은 점을 여러 개보다 단일 포인트가 강해요."
        ),
        palette=("#C8CCD4", "#2E3550"),
    ),
)

# Defence-in-depth: catalogue is also frozen as a tuple (already), but we
# verify the cardinality invariants here so the test suite isn't the only
# place that catches a content-rewrite mistake.
assert len(_GUIDES) == 16, "guide catalogue must have exactly 16 entries"


# ---------------------------------------------------------------------------
# Public loader API
# ---------------------------------------------------------------------------


def load_all_guides() -> tuple[Guide, ...]:
    """Return the full 16-guide catalogue.

    The returned tuple is the underlying immutable constant — callers may
    iterate freely, and frozen dataclasses make per-element mutation a
    `FrozenInstanceError`.
    """
    return _GUIDES


def load_guides_for_season(season: Season) -> tuple[Guide, ...]:
    """Return the 4 guides for a given Season, in canonical category order.

    Canonical category order is the declaration order of `GuideCategory`
    (makeup → outfit → hair → accessory). This matches the post-diagnosis
    grid layout.

    Args:
        season: One of the 4 Season enum members.

    Returns:
        Exactly 4 `Guide` instances — one per category — for that season.

    Raises:
        TypeError: if `season` is not a `Season` enum member.
    """
    if not isinstance(season, Season):
        raise TypeError(
            f"season must be a Season enum, got {type(season).__name__}",
        )
    return tuple(g for g in _GUIDES if g.season is season)


def load_guide(season: Season, category: GuideCategory) -> Guide:
    """Return the single guide for one (season, category) pair.

    Args:
        season: One of the 4 Season enum members.
        category: One of the 4 GuideCategory enum members.

    Returns:
        The matching `Guide`.

    Raises:
        TypeError: if either argument is the wrong enum type.
        KeyError: if no guide exists for the given pair. This is treated
            as a hard contract violation — the catalogue is supposed to
            be exhaustive, so a miss means a content-rewrite removed a
            row by accident.
    """
    if not isinstance(season, Season):
        raise TypeError(
            f"season must be a Season enum, got {type(season).__name__}",
        )
    if not isinstance(category, GuideCategory):
        raise TypeError(
            f"category must be a GuideCategory enum, " f"got {type(category).__name__}",
        )
    for guide in _GUIDES:
        if guide.season is season and guide.category is category:
            return guide
    raise KeyError(
        f"no guide registered for ({season.name}, {category.name}); "
        "catalogue is supposed to be exhaustive — check content/guides.py",
    )


def guide_count_by_category() -> dict[GuideCategory, int]:
    """Return a {category: count} histogram across the catalogue.

    The diagnosis funnel's analytics layer uses this to assert that
    every category has equal representation; the test suite uses it as
    a single-pass verification of the 4-per-category invariant.
    """
    counts: dict[GuideCategory, int] = {c: 0 for c in GuideCategory}
    for guide in _GUIDES:
        counts[guide.category] += 1
    return counts


def guide_count_by_season() -> dict[Season, int]:
    """Return a {season: count} histogram across the catalogue.

    Mirror of `guide_count_by_category` for the orthogonal axis. Used by
    the test suite to verify the 4-per-season invariant.
    """
    counts: dict[Season, int] = {s: 0 for s in Season}
    for guide in _GUIDES:
        counts[guide.season] += 1
    return counts
