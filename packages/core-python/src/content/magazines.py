"""Prebuilt monthly magazine catalogue (Sub-AC 3.2 / Sub-AC 11.4).

The magazine is the *retention* surface: a single editorial issue ships
on the first of every calendar month, and unlocks for paid users as the
post-payment funnel's monthly anchor. The Seed ontology calls this a
`magazine` concept — a 1–3 month sliding window of pre-authored issues
that the publishing layer (Sub-AC 11.4) cycles through.

Design notes:

  - **Why a sliding catalogue, not a live CMS.** The constraint set is
    explicit: "자체 ML 모델 학습 금지 — 모든 동적 콘텐츠는 사전 빌드된
    데이터에서 조회". So the magazine surface is a tuple of frozen
    dataclasses, just like ``guides.py`` and ``curations.py``. A future
    CMS-backed loader can swap the constants without touching the
    public API — every call site stays on the loader functions.

  - **Why exactly 3 issues seeded.** The publishing layer needs at
    least one issue per month for the first three months after launch
    so the "발행 주기" promise is verifiable on day-1 of months M, M+1,
    M+2 without a content rewrite. Three is the minimum that proves
    the rotation works (not just the singleton degenerate case).

  - **Why each issue has 4 articles (one per Season).** The post-
    payment screen renders the active issue alongside the user's
    personal-color season — so every issue must contain a section the
    user can recognize as "for me". Pinning the article count to 4 and
    requiring one per `Season` makes the "per-color coverage"
    invariant trivially verifiable (a missing season is a test
    failure, not a copy-review miss).

  - **Why ``month`` is a stable ``YYYY-MM`` string.** The publisher
    schedules issues by calendar month, and ``YYYY-MM`` is what every
    scheduler boundary (push notifications, analytics, retention
    cohort buckets) expects. Using a string rather than `date(YYYY, M,
    1)` keeps the module I/O-free and pure — no ``datetime`` import,
    no timezone leakage.

  - **Korean signature is part of the contract.** Per the
    ``korean_signature`` evaluation principle, every issue carries an
    `editor_letter` and Korean copy in every article. Stripping either
    to placeholder English would dilute the brand and is rejected at
    construction time.

  - **Immutability.** Frozen dataclasses, tuple collections. The
    publisher's analytics layer flows these objects through impression
    / open / save sets, so they must be hashable.
"""

from __future__ import annotations

from dataclasses import dataclass

from personal_color.season_classifier import Season

# ---------------------------------------------------------------------------
# Article value object — one per `Season` inside an issue.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class MagazineArticle:
    """One article inside a `Magazine` issue.

    Each article is keyed to one of the 4 Korean personal-color
    seasons. The post-payment magazine screen filters the active issue
    down to the reader's season before rendering, so the article
    catalogue is structured as ``Season -> article`` within each issue.

    Attributes:
        season: Which Korean personal-color season this article
            targets. Within an issue every Season appears exactly once.
        title: Short Korean title rendered as the article card
            headline.
        summary: One-line Korean blurb shown under the title on the
            issue's table-of-contents row.
        body: Long-form Korean body shown when the user expands the
            article. Markdown-flavoured plain text — newline-separated
            paragraphs.
    """

    season: Season
    title: str
    summary: str
    body: str

    def __post_init__(self) -> None:
        if not isinstance(self.season, Season):
            raise TypeError(
                f"season must be a Season enum, " f"got {type(self.season).__name__}",
            )
        for field_name in ("title", "summary", "body"):
            value = getattr(self, field_name)
            if not isinstance(value, str) or not value.strip():
                raise ValueError(
                    f"{field_name} must be a non-empty string",
                )


# ---------------------------------------------------------------------------
# Magazine value object — one calendar-month issue.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Magazine:
    """One calendar-month issue of the magazine.

    Attributes:
        month: Stable ``YYYY-MM`` issue identifier (e.g. ``"2026-05"``).
            Used as the catalogue key by ``get_magazine_by_month``.
        issue_title: Short Korean issue title rendered on the cover.
        cover_headline: One-line Korean cover blurb — the editorial
            angle of the issue.
        editor_letter: First-person Korean editor's letter — the
            ``creator_signature`` surface (see Seed evaluation).
        articles: Exactly 4 `MagazineArticle` entries — one per
            `Season` — so every reader has at least one article keyed
            to their personal color.
    """

    month: str
    issue_title: str
    cover_headline: str
    editor_letter: str
    articles: tuple[MagazineArticle, ...]

    def __post_init__(self) -> None:
        if not _is_valid_month(self.month):
            raise ValueError(
                f"month must be a 'YYYY-MM' string, got {self.month!r}",
            )
        for field_name in ("issue_title", "cover_headline", "editor_letter"):
            value = getattr(self, field_name)
            if not isinstance(value, str) or not value.strip():
                raise ValueError(
                    f"{field_name} must be a non-empty string",
                )
        if not isinstance(self.articles, tuple):
            raise TypeError(
                "articles must be a tuple (hashable, immutable)",
            )
        if len(self.articles) != 4:
            raise ValueError(
                f"magazine issue must hold exactly 4 articles, "
                f"got {len(self.articles)}",
            )
        seasons = {article.season for article in self.articles}
        if seasons != set(Season):
            raise ValueError(
                "articles must cover every Season exactly once; "
                f"got seasons {sorted(s.slug for s in seasons)}",
            )


def _is_valid_month(value: object) -> bool:
    """Strict ``YYYY-MM`` validator.

    Kept intentionally small — no ``datetime`` import — because the
    catalogue is module-level and we want validation errors to surface
    at import time without dragging timezone semantics into a pure-data
    module.
    """
    if not isinstance(value, str):
        return False
    if len(value) != 7 or value[4] != "-":
        return False
    year_part = value[:4]
    month_part = value[5:]
    if not (year_part.isdigit() and month_part.isdigit()):
        return False
    month_num = int(month_part)
    return 1 <= month_num <= 12


# ---------------------------------------------------------------------------
# The 3-issue seed catalogue.
#
# Order is canonical chronological (oldest → newest). The publisher
# layer (Sub-AC 11.4) is responsible for picking the issue whose
# `month` matches the current calendar month; this module is the
# data plane, not the scheduler.
# ---------------------------------------------------------------------------


_MAGAZINES: tuple[Magazine, ...] = (
    # --- 2026-05 (M0) -----------------------------------------------------
    Magazine(
        month="2026-05",
        issue_title="첫 빛, 첫 한 컷",
        cover_headline=("다섯 번째 달, 당신의 첫 셀카를 다시 펼쳐봅니다."),
        editor_letter=(
            "안녕하세요, 에디터입니다.\n"
            "5월호는 '첫 빛'을 주제로 골랐어요. "
            "퍼스널 컬러 진단을 막 마친 분들이 가장 자주 묻는 질문, "
            "'그래서 이 색을 어디서부터 써야 해요?'에 대한 제 첫 답입니다."
        ),
        articles=(
            MagazineArticle(
                season=Season.SPRING,
                title="봄, 살구 한 톡부터 시작해요",
                summary="살구 블러셔 한 번이면 봄 웜의 시그니처가 살아납니다.",
                body=(
                    "봄 웜톤의 첫 한 컷은 베이스가 아니라 블러셔에서 시작해요.\n"
                    "살구·코랄 사이에서 가장 따뜻한 쪽을 골라,\n"
                    "광대 가장 높은 자리에 한 번만 톡 두드려보세요.\n"
                    "그 한 톡이 사진 전체의 채도를 살려줍니다."
                ),
            ),
            MagazineArticle(
                season=Season.SUMMER,
                title="여름, 안개를 한 겹 두르세요",
                summary="라벤더 한 방울이면 여름 쿨의 부드러움이 살아납니다.",
                body=(
                    "여름 쿨톤은 선명함보다 부드러움이 시그니처예요.\n"
                    "라벤더 글로시 립을 입꼬리부터 안쪽으로 그라데이션,\n"
                    "그 위에 핑크 베이지 베이스 한 겹.\n"
                    "그 한 겹이 사진의 공기를 차분하게 만들어줍니다."
                ),
            ),
            MagazineArticle(
                season=Season.AUTUMN,
                title="가을, 브릭 한 톤 가라앉혀요",
                summary="브릭 매트 한 겹이면 가을 웜의 깊이가 살아납니다.",
                body=(
                    "가을 웜톤의 시그니처는 채도가 아니라 깊이예요.\n"
                    "브릭 매트 립을 입꼬리부터 단단히,\n"
                    "그 위에 옐로 베이지 베이스 한 겹.\n"
                    "그 한 톤 차이가 가을의 묵직한 공기를 만들어줍니다."
                ),
            ),
            MagazineArticle(
                season=Season.WINTER,
                title="겨울, 와인 풀립으로 정리해요",
                summary="와인 풀립 한 컷이면 겨울 쿨의 콘트라스트가 살아납니다.",
                body=(
                    "겨울 쿨톤은 흐림이 아니라 또렷함이 시그니처예요.\n"
                    "와인 풀립을 입술 안쪽까지 꽉 채우고,\n"
                    "그 위에 핑크 화이트 베이스 한 겹.\n"
                    "그 또렷함이 사진의 콘트라스트를 만들어줍니다."
                ),
            ),
        ),
    ),
    # --- 2026-06 (M1) -----------------------------------------------------
    Magazine(
        month="2026-06",
        issue_title="여름 문턱의 한 컷",
        cover_headline=("더위가 오기 직전, 가장 잘 나오는 빛이 있어요."),
        editor_letter=(
            "6월호는 '여름 문턱'을 주제로 골랐어요.\n"
            "낮이 길어진 만큼 인공 조명에 기대지 않아도 되는 달, "
            "햇빛을 가장 잘 쓰는 법에 대한 제 두 번째 노트입니다."
        ),
        articles=(
            MagazineArticle(
                season=Season.SPRING,
                title="봄, 오후 3시 햇살을 노려요",
                summary="햇빛 들이치는 창가 한 컷이 가장 봄답습니다.",
                body=(
                    "봄 웜톤은 차가운 인공 조명에서 살기 어려워요.\n"
                    "오후 2~4시 햇빛이 비스듬히 들이치는 창가,\n"
                    "그 자리에 앉아 측면 광을 받으세요.\n"
                    "보정 없이도 봄 웜의 채도가 사진에 그대로 박힙니다."
                ),
            ),
            MagazineArticle(
                season=Season.SUMMER,
                title="여름, 비 그친 직후의 골목",
                summary="비 그친 골목의 회청색 공기가 여름 쿨을 살려요.",
                body=(
                    "여름 쿨톤이 가장 잘 어울리는 빛은 정오의 햇살이 아니라\n"
                    "비 막 그친 직후의 회청색 그늘이에요.\n"
                    "골목 한 가운데, 그늘과 빛이 만나는 자리에 서서\n"
                    "정면이 아니라 살짝 비스듬히 셔터를 눌러보세요."
                ),
            ),
            MagazineArticle(
                season=Season.AUTUMN,
                title="가을, 흐린 날 노을 직전이 정답",
                summary="해 지기 직전 흐린 빛이 가을 웜의 깊이를 살립니다.",
                body=(
                    "가을 웜톤은 흐린 날을 두려워하지 마세요.\n"
                    "해 지기 30분 전, 구름 낀 노을 빛이\n"
                    "테라코타와 머스타드의 채도를 한 단계 더 가라앉혀줘요.\n"
                    "한 컷, 흐린 빛 아래서 정면이 아니라 측면으로."
                ),
            ),
            MagazineArticle(
                season=Season.WINTER,
                title="겨울, 흰 벽 앞 정오 광",
                summary="정오의 직사광 앞 흰 벽이 겨울 쿨을 또렷이 살립니다.",
                body=(
                    "겨울 쿨톤은 모호한 빛에서 흐려져요.\n"
                    "정오 직사광이 떨어지는 흰 벽, 그 앞에 서서\n"
                    "콘트라스트가 강한 옷 한 벌로 정면 한 컷.\n"
                    "보정보다 빛 선택이 먼저예요."
                ),
            ),
        ),
    ),
    # --- 2026-07 (M2) -----------------------------------------------------
    Magazine(
        month="2026-07",
        issue_title="장마, 그래도 잘 나오는 한 컷",
        cover_headline=("비 오는 날, 우리에게 어울리는 한 톤이 있어요."),
        editor_letter=(
            "7월호는 '장마'를 주제로 골랐어요.\n"
            "흐린 빛이 일 주일 내내 이어지는 달, "
            "그 빛을 약점이 아니라 시그니처로 쓰는 법에 대한 노트입니다."
        ),
        articles=(
            MagazineArticle(
                season=Season.SPRING,
                title="봄, 따뜻한 실내 조명 두 개",
                summary="텅스텐 조명 두 개로 봄 웜을 실내에서 살리세요.",
                body=(
                    "장마엔 자연광이 모자라 봄 웜의 채도가 가라앉아요.\n"
                    "3000K 따뜻한 실내 조명을 두 자리에서 비추세요.\n"
                    "정면에서 한 개, 측면 45도에서 한 개,\n"
                    "그 한 쌍이 햇살의 빈 자리를 메워줍니다."
                ),
            ),
            MagazineArticle(
                season=Season.SUMMER,
                title="여름, 비 오는 창가가 최적",
                summary="비 흐르는 창 옆 자리에서 여름 쿨의 시그니처가 살아납니다.",
                body=(
                    "여름 쿨톤은 장마와 가장 잘 어울리는 시즌이에요.\n"
                    "비 흐르는 창 옆에 앉아, 창밖이 아니라 안쪽 빛을 받아\n"
                    "측면 한 컷을 찍어보세요.\n"
                    "회청색 공기가 사진에 그대로 박힙니다."
                ),
            ),
            MagazineArticle(
                season=Season.AUTUMN,
                title="가을, 우드 톤 인테리어 한 자리",
                summary="우드 톤 카페 한 자리가 가을 웜을 한 톤 더 깊게 합니다.",
                body=(
                    "장마엔 야외 색감이 흐려져서 가을 웜이 묵직해 보이지 않아요.\n"
                    "우드 톤 인테리어가 진한 카페 한 자리,\n"
                    "그 배경 앞에서 정면 한 컷.\n"
                    "주변 색이 옷의 채도를 한 단계 더 가라앉혀줍니다."
                ),
            ),
            MagazineArticle(
                season=Season.WINTER,
                title="겨울, 검은 우산 한 컷",
                summary="검은 우산 한 자루가 겨울 쿨의 콘트라스트를 살립니다.",
                body=(
                    "겨울 쿨톤은 장마에 가장 강한 시즌이에요.\n"
                    "검은 우산 한 자루를 들고, 흰 벽 앞에 서서\n"
                    "정면 한 컷.\n"
                    "비가 내리는 공기 위에 잉크 같은 콘트라스트가 살아납니다."
                ),
            ),
        ),
    ),
)


# Defence-in-depth — the test suite still checks these invariants, but
# raising at module import keeps a content-rewrite mistake from
# reaching the magazine screen silently.
assert len(_MAGAZINES) >= 1, "magazine catalogue must seed at least one issue"
assert len({m.month for m in _MAGAZINES}) == len(_MAGAZINES), (
    "magazine catalogue must have one entry per month " "(no duplicate 'YYYY-MM' keys)"
)


# ---------------------------------------------------------------------------
# Public loader API. Mirrors guides.py / curations.py loader shape so
# call sites stay uniform across the three content surfaces.
# ---------------------------------------------------------------------------


def load_all_magazines() -> tuple[Magazine, ...]:
    """Return the full seeded magazine catalogue.

    Order is canonical chronological (oldest → newest). The returned
    tuple is the underlying immutable constant — callers may iterate
    freely, and frozen dataclasses make per-element mutation a
    `FrozenInstanceError`.
    """
    return _MAGAZINES


def get_magazine_by_month(month: str) -> Magazine:
    """Return the magazine issue keyed to ``month`` (``YYYY-MM``).

    Args:
        month: Stable ``YYYY-MM`` identifier (e.g. ``"2026-05"``).

    Returns:
        The matching `Magazine` issue.

    Raises:
        TypeError: if ``month`` is not a string.
        ValueError: if ``month`` is not in ``YYYY-MM`` shape.
        KeyError: if no issue exists for that month. Treated as a hard
            contract violation upstream — the publisher layer should
            only call this with months it has already verified are in
            the catalogue (via ``available_months``).
    """
    if not isinstance(month, str):
        raise TypeError(
            f"month must be a 'YYYY-MM' string, got {type(month).__name__}",
        )
    if not _is_valid_month(month):
        raise ValueError(
            f"month must be a 'YYYY-MM' string, got {month!r}",
        )
    for magazine in _MAGAZINES:
        if magazine.month == month:
            return magazine
    raise KeyError(
        f"no magazine issue registered for month {month!r}; "
        "available months: " + ", ".join(m.month for m in _MAGAZINES),
    )


def available_months() -> tuple[str, ...]:
    """Return every ``YYYY-MM`` key the catalogue currently ships.

    Used by the publisher layer (Sub-AC 11.4) to verify that a target
    month has an issue before unlocking the magazine screen — and by
    the test suite to verify the catalogue's cardinality without
    hard-coding the seeded months.
    """
    return tuple(m.month for m in _MAGAZINES)


def get_article_for_season(month: str, season: Season) -> MagazineArticle:
    """Return the single article for one (month, season) pair.

    The publisher layer filters an active issue down to the reader's
    personal-color season before rendering. Splitting the lookup into
    a dedicated function keeps that call site one-line and lets the
    test suite verify the per-season invariant in isolation.

    Args:
        month: Stable ``YYYY-MM`` identifier.
        season: One of the 4 ``Season`` enum members.

    Returns:
        The matching `MagazineArticle`.

    Raises:
        TypeError: if ``season`` is not a ``Season`` enum.
        KeyError: bubbled up from ``get_magazine_by_month`` if the
            month is unknown.
    """
    if not isinstance(season, Season):
        raise TypeError(
            f"season must be a Season enum, got {type(season).__name__}",
        )
    magazine = get_magazine_by_month(month)
    for article in magazine.articles:
        if article.season is season:
            return article
    # Unreachable while the ``__post_init__`` invariant holds — every
    # issue is guaranteed to carry one article per Season. Surface as
    # a hard contract violation so a future content rewrite that
    # removes the post-init check fails loudly.
    raise KeyError(
        f"no article for season {season.name} in issue {month!r}; "
        "catalogue is supposed to cover every Season per issue",
    )
