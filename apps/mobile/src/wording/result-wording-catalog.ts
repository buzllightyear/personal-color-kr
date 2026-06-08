/**
 * Result-wording catalog (Phase 3.4) — hand-mirrored TS surface of the
 * Phase 0.x Python `ResultWording` shape from
 * `packages/core-python/src/content/result_wording.py`.
 *
 * Single-file boundary — this module is the ONE place where the wording
 * catalog (types + data) is defined. Phase 4 swap replaces this file with
 * an API-backed module; consumers do not change. The portability test
 * `apps/mobile/tests/post-payment-phase4-portability.test.ts` enforces the
 * boundary: only `apps/mobile/src/wording/` and `apps/mobile/src/fixtures/
 * post-payment-*.ts` may import from this file.
 *
 * Per-season ResultWordingEntry shape mirrors Python ResultWording sans
 * combined_text — TS consumers render the typed fields directly:
 *
 *   ResultWordingEntry = {
 *     season:               Season,                       // one of 4
 *     categoryLine:         string,                       // 분류 verdict
 *     guideLines:           readonly [string, string,     // 4 entries —
 *                                     string, string],    // makeup/outfit/
 *                                                         // hair/accessory
 *     recommendationLines:  readonly string[],            // >= 6 lines —
 *                                                         // headline +
 *                                                         // editor sig +
 *                                                         // 4 tone-prefixed
 *                                                         // item lines
 *     tones:                readonly [WordingTone,        // exactly 4 tones,
 *                                     WordingTone,        // each appearing
 *                                     WordingTone,        // once per season
 *                                     WordingTone],       // (Python invariant)
 *   }
 *
 * The 4 WordingTone members (affectionate / editorial / playful / poetic)
 * mirror the Python WordingTone enum in
 * `packages/core-python/src/content/curations.py` 1:1 at the slug+label
 * level. Each season's 4 recommendation item lines are prefixed with the
 * Korean tone label (다정한 / 에디토리얼 / 유쾌한 / 시적인) in the format
 *
 *   "({tone label}) {kind label} · {title} — {blurb}"
 *
 * mirroring Python `_format_recommendation_item` so the "톤 혼합"
 * (tone-mix) invariant is visible on the curation screen.
 *
 * Korean-only constraint — every user-visible string in
 * RESULT_WORDING_CATALOG (categoryLine, guideLines entries,
 * recommendationLines entries) contains zero ASCII letters [A-Za-z].
 * Slug literals at the type layer ('spring-warm' etc.) are NOT
 * user-visible and do not violate the constraint.
 */

// ---------------------------------------------------------------------------
// Season — re-exported as a value tuple + type so consumers can `import
// { SEASONS, type Season } from '.../result-wording-catalog'` without a
// second import from contracts/post-payment-views. Slugs are identical to
// the Phase 3.3 `Season` union in contracts/post-payment-views.ts; a
// type-equality assertion in the portability test surfaces drift.
// ---------------------------------------------------------------------------

/**
 * The 4 personal-color seasons as a closed tuple. Order is the canonical
 * spring → summer → autumn → winter sequence used everywhere else in the
 * project (Phase 3.1 `_PRESET_TO_PROMPT`, Phase 3.2 diagnose runtime).
 */
export const SEASONS = [
  'spring-warm',
  'summer-cool',
  'autumn-warm',
  'winter-cool',
] as const;

/**
 * Closed Season union — `(typeof SEASONS)[number]` keeps the tuple and
 * the type in lock-step so adding a fifth value requires touching exactly
 * one location.
 */
export type Season = (typeof SEASONS)[number];

// ---------------------------------------------------------------------------
// WordingTone — exactly 4 voice tones, mirroring Python WordingTone enum.
//
// Slugs (affectionate / editorial / playful / poetic) match the Python
// member values. Korean labels (다정한 / 에디토리얼 / 유쾌한 / 시적인)
// match the Python `label` property of each enum member.
// ---------------------------------------------------------------------------

/**
 * The 4 wording-tone slugs as a closed tuple, in the canonical order used
 * by Python `WordingTone` declaration.
 */
export const WORDING_TONES = [
  'affectionate',
  'editorial',
  'playful',
  'poetic',
] as const;

/**
 * Closed WordingTone union.
 */
export type WordingTone = (typeof WORDING_TONES)[number];

/**
 * Korean display label for each WordingTone, used as the visible prefix
 * on recommendation item lines (mirrors Python `WordingTone.label`).
 */
export const WORDING_TONE_LABELS: Readonly<Record<WordingTone, string>> = {
  affectionate: '다정한',
  editorial: '에디토리얼',
  playful: '유쾌한',
  poetic: '시적인',
};

// ---------------------------------------------------------------------------
// ResultWordingEntry — per-season catalog value object.
//
// Fields are deliberately readonly tuples / arrays so the TS type system
// surfaces length drift at the call site. Korean-only is a runtime
// invariant verified by `tests/result-wording-catalog-korean-only.test.ts`.
// ---------------------------------------------------------------------------

/**
 * Per-season wording entry. The 4 fields directly back the 4 per-screen
 * wording slices (DiagnosisView gets `categoryLine`, EditView gets
 * `categoryLine` + a derived `ctaMicrocopy`, GuideView gets `guideLines`,
 * CurationView gets `recommendationLines`).
 */
export type ResultWordingEntry = {
  readonly season: Season;
  readonly categoryLine: string;
  readonly guideLines: readonly [string, string, string, string];
  readonly recommendationLines: readonly string[];
  readonly tones: readonly [WordingTone, WordingTone, WordingTone, WordingTone];
};

// ---------------------------------------------------------------------------
// Helper — per-season CTA microcopy for the EditView slice.
//
// The seed locks the derivation rule: ctaMicrocopy is a per-season Korean
// CTA phrase derived from the categoryLine for the same season. This
// helper exports the derivation so consumers (the EditView fixture)
// produce the same value the catalog implies, without re-encoding the
// rule in every fixture.
// ---------------------------------------------------------------------------

const _CTA_MICROCOPY: Readonly<Record<Season, string>> = {
  'spring-warm': '봄 웜톤은 이렇게 편집하세요',
  'summer-cool': '여름 쿨톤은 이렇게 편집하세요',
  'autumn-warm': '가을 웜톤은 이렇게 편집하세요',
  'winter-cool': '겨울 쿨톤은 이렇게 편집하세요',
};

/**
 * Per-season Korean CTA microcopy used by the edit tab. Derived from the
 * same season's categoryLine voice but tightened into an imperative CTA
 * phrase ("{season label}은 이렇게 편집하세요").
 */
export function ctaMicrocopyFor(season: Season): string {
  return _CTA_MICROCOPY[season];
}

// ---------------------------------------------------------------------------
// RESULT_WORDING_CATALOG — the 4 season-keyed entries.
//
// Each entry's `recommendationLines` follows the canonical layout:
//   index 0: headline
//   index 1: editor signature line
//   indices 2..5: 4 item lines, one per WordingTone, in the canonical
//                 (다정한 / 에디토리얼 / 유쾌한 / 시적인) order, each line
//                 carrying the visible "(tone label) kind label · title —
//                 blurb" format mirroring Python _format_recommendation_item.
// ---------------------------------------------------------------------------

export const RESULT_WORDING_CATALOG: Readonly<Record<Season, ResultWordingEntry>> = {
  'spring-warm': {
    season: 'spring-warm',
    categoryLine: '당신은 봄 웜톤입니다.',
    guideLines: [
      '메이크업 — 코랄 베이스: 살구빛 코랄과 피치 글로우로 산뜻한 봄 무드 완성.',
      '데일리 코디 — 라이트 베이지 톤: 베이지·아이보리·연한 골드로 따뜻한 햇살을 입히세요.',
      '헤어 컬러 — 허니 브라운: 옅은 골드빛 갈색이 피부 채도를 끌어올립니다.',
      '액세서리 — 옐로 골드: 라이트 골드와 코랄 스톤으로 봄빛을 더하세요.',
    ],
    recommendationLines: [
      '봄빛을 닮은 네 가지 큐레이션',
      '에디터의 한 줄: 햇살이 머무는 톤을 가장 가볍게 입어 보는 한 주를 위해.',
      '(다정한) 메이크업 룩 · 살구빛 데일리 룩 — 부드러운 살구 글로우로 하루를 다정하게 시작해요.',
      '(에디토리얼) 코디 픽 · 베이지 트렌치 코트 — 절제된 베이지 톤이 봄빛을 매거진처럼 정돈합니다.',
      '(유쾌한) 촬영 씬 · 벚꽃 산책 셀카 — 분홍 꽃잎과 함께 가볍게 웃는 한 컷을 남겨 보세요.',
      '(시적인) 편집 프리셋 · 봄밤 노을 톤 — 노을빛이 길게 스며드는 따뜻한 색조의 편집 프리셋.',
    ],
    tones: ['affectionate', 'editorial', 'playful', 'poetic'],
  },
  'summer-cool': {
    season: 'summer-cool',
    categoryLine: '당신은 여름 쿨톤입니다.',
    guideLines: [
      '메이크업 — 로즈 베이스: 핑크 로즈와 라벤더 블러셔로 청량한 광채를 더하세요.',
      '데일리 코디 — 라이트 그레이 톤: 그레이·라벤더·소프트 블루로 시원한 분위기를 만드세요.',
      '헤어 컬러 — 애쉬 브라운: 회갈색 톤이 피부의 청량감을 살려 줍니다.',
      '액세서리 — 실버와 로즈 골드: 차가운 메탈과 진주로 단아한 포인트를 주세요.',
    ],
    recommendationLines: [
      '여름의 청량함을 담은 네 가지 큐레이션',
      '에디터의 한 줄: 한낮의 햇살을 식히는 톤, 가장 조용한 시간에 어울리는 컬러들.',
      '(다정한) 메이크업 룩 · 로즈 미스트 룩 — 안개처럼 번지는 핑크 로즈로 청량한 인사를 건네요.',
      '(에디토리얼) 코디 픽 · 라벤더 셔츠 — 라벤더 블루의 모노톤이 정제된 여름 무드를 완성합니다.',
      '(유쾌한) 촬영 씬 · 한낮의 수영장 셀카 — 차가운 물빛 배경에서 가볍게 웃는 한 컷을 담아 보세요.',
      '(시적인) 편집 프리셋 · 여름 비 그친 후 — 비 갠 오후의 푸른 채도가 잔잔히 머무는 편집 프리셋.',
    ],
    tones: ['affectionate', 'editorial', 'playful', 'poetic'],
  },
  'autumn-warm': {
    season: 'autumn-warm',
    categoryLine: '당신은 가을 웜톤입니다.',
    guideLines: [
      '메이크업 — 테라코타 베이스: 벽돌빛 레드와 브론즈 섀도우로 깊은 가을빛을 입히세요.',
      '데일리 코디 — 카멜 톤: 카멜·머스터드·올리브로 따뜻한 가을의 결을 만드세요.',
      '헤어 컬러 — 다크 초콜릿 브라운: 짙은 갈색 톤이 피부 채도를 차분하게 정돈합니다.',
      '액세서리 — 앤티크 골드: 빈티지 골드와 호박 스톤으로 가을 무드를 강조하세요.',
    ],
    recommendationLines: [
      '가을의 깊이를 담은 네 가지 큐레이션',
      '에디터의 한 줄: 햇살이 낮게 머무는 계절, 가장 진한 색이 가장 따뜻하게 어울리는 시간.',
      '(다정한) 메이크업 룩 · 호박빛 데일리 룩 — 따뜻한 호박빛 음영으로 차분하게 하루를 안내해요.',
      '(에디토리얼) 코디 픽 · 카멜 롱 코트 — 카멜 톤의 긴 실루엣이 가을의 무드를 매거진처럼 정돈합니다.',
      '(유쾌한) 촬영 씬 · 단풍길 산책 셀카 — 붉은 단풍을 배경으로 가볍게 웃는 한 컷을 남겨 보세요.',
      '(시적인) 편집 프리셋 · 늦가을 노을 — 짙은 주황이 길게 번지는 시적인 가을의 편집 프리셋.',
    ],
    tones: ['affectionate', 'editorial', 'playful', 'poetic'],
  },
  'winter-cool': {
    season: 'winter-cool',
    categoryLine: '당신은 겨울 쿨톤입니다.',
    guideLines: [
      '메이크업 — 와인 베이스: 선명한 와인과 베리 컬러로 또렷한 겨울 무드를 완성하세요.',
      '데일리 코디 — 차콜 톤: 블랙·차콜·네이비로 절제된 겨울의 결을 그리세요.',
      '헤어 컬러 — 블루 블랙: 푸른 기가 도는 진한 검정이 피부의 명도를 또렷이 살립니다.',
      '액세서리 — 실버 메탈: 차가운 실버와 크리스털 스톤으로 선명한 포인트를 주세요.',
    ],
    recommendationLines: [
      '겨울의 선명함을 담은 네 가지 큐레이션',
      '에디터의 한 줄: 가장 차가운 시간에 가장 또렷한 색이 어울리는, 그런 계절의 한 주를 위해.',
      '(다정한) 메이크업 룩 · 베리 글로우 룩 — 또렷한 베리빛 발색을 가볍게 얹어 다정한 인상을 만들어요.',
      '(에디토리얼) 코디 픽 · 블랙 카시미어 니트 — 단정한 블랙 카시미어가 겨울의 무드를 매거진처럼 완성합니다.',
      '(유쾌한) 촬영 씬 · 눈 내린 거리 셀카 — 새하얀 눈 배경에서 가볍게 웃는 한 컷을 담아 보세요.',
      '(시적인) 편집 프리셋 · 겨울 새벽 빛 — 푸른 새벽빛이 깊게 스며드는 시적인 겨울의 편집 프리셋.',
    ],
    tones: ['affectionate', 'editorial', 'playful', 'poetic'],
  },
};
