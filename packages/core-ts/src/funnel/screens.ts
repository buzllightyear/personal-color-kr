/**
 * Per-step screen renderer for the Glam Up 12단계 결제 깔때기 (한국 변형, v0.2).
 *
 * Single source of truth for what each of the 12 funnel steps displays
 * to a Korean-market user.  Each entry in `FUNNEL_SCREENS` is a frozen
 * `FunnelScreen` describing the headline / subhead / body copy / CTAs /
 * step-specific metadata for one step ID.
 *
 * Seed-derived invariants enforced here (verified by tests):
 *   - All 12 step IDs from `FUNNEL_STEPS_ORDERED` (v0.2) are represented
 *     exactly once.
 *   - `stepNumber` always matches the canonical 1..12 index + 1.
 *   - Steps 10 / 11 / 12 carry `variantTag: 'kr_variant'` (Korean variants).
 *   - Step 3 (`onboarding_priming`) carries `onboardingQuestionCount: 2`
 *     (일관성 lever priming, v0.2 신설; replaces social_proof_intro).
 *   - Step 4 (`rating_gate`) exposes a `dismiss`-variant CTA → `action: 'skip'`
 *     because the iOS native dialog is dismissable.
 *   - Step 5 (`fake_loader`) carries `durationMs: 5000` (가짜 5초 로더; v0.2
 *     에서 step 8 → step 5 이동, price_anchoring 자리).
 *   - Step 6 (`scan_option_select`) lists exactly 3 scan options with the
 *     personal-color scan as the primary CTA.
 *   - Step 7 (`diagnosis_input`) is 셀카만 단독 (온보딩 질문은 step 3로 이동).
 *   - Step 8 (`fake_scan_animation`) carries `analysisPoints: 24` 시각
 *     애니메이션 (v0.2 신설).
 *   - Step 9 (`result_reveal`) is `locked: true` (paywalled tease).
 *   - Step 10 (`referral_gate`) requires exactly 1 referral (한국 변형 — 50%
 *     할인 게이트 폐기, 1명 추천만).
 *   - Step 11 (`social_evolution`, v0.2) absorbs social_proof_intro:
 *     `proofSources` includes UGC + influencer + aggregate user count.
 *   - Step 12 (`payment_model`) carries pricing in USD ($12/월, $59/연) and
 *     free-trial breakdown (baseTrialDays: 7 + annualBonusDays: 30 = 37).
 *
 * Immutability: every screen and its nested arrays / metadata are frozen.
 */
import {
  FUNNEL_STEPS_ORDERED,
  type FunnelStepId,
} from './types.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Discrete action a CTA performs.  Decoupled from any UI framework so the
 * same configuration can drive React Native, Web, or analytics replays.
 */
export type FunnelCtaAction =
  | 'advance'                       // proceed to next step (default)
  | 'skip'                          // dismiss current step (rating_gate only)
  | 'submit_rating'                 // submit iOS rating
  | 'select_scan_personal_color'    // step 6 primary option — main hook
  | 'select_scan_secondary'         // step 6 secondary scan options (Phase-N)
  | 'upload_selfie'                 // step 7 — selfie + onboarding answers
  | 'auto_advance'                  // step 8 — no user CTA; timer drives it
  | 'unlock_result'                 // step 9 — proceed to KR-variant gates
  | 'share_referral'                // step 10 — share invite to 1 friend
  | 'select_monthly'                // step 12 — $12/월
  | 'select_annual';                // step 12 — $59/연 + 37일 무료체험

/**
 * Visual weight of a CTA.  `dismiss` is reserved for the rating gate so the
 * iOS native "나중에" button reads as opt-out rather than a competing action.
 */
export type FunnelCtaVariant = 'primary' | 'secondary' | 'tertiary' | 'dismiss';

export interface FunnelCta {
  readonly label: string;          // Korean copy rendered on the button
  readonly action: FunnelCtaAction;
  readonly variant: FunnelCtaVariant;
}

/**
 * Tag that marks a screen as a Korean-market variant of the original Glam Up
 * funnel.  Only steps 10, 11, and 12 carry this tag per Seed constraint
 * `glamup_funnel_fidelity` (steps 1-9 are verbatim Glam Up, KR variants in
 * the last three).
 */
export type FunnelVariantTag = 'kr_variant';

/**
 * Fully-rendered screen configuration for one funnel step.
 *
 * All nullable slots use `| null` rather than `?:` to play nicely with
 * `exactOptionalPropertyTypes: true` in tsconfig.json.
 */
export interface FunnelScreen {
  readonly stepId: FunnelStepId;
  readonly stepNumber: number;                          // 1..12
  readonly headline: string;                            // Korean h1
  readonly subhead: string;                             // Korean supporting copy
  readonly bodyCopy: string | null;                     // optional long-form body
  readonly ctas: readonly FunnelCta[];
  readonly variantTag: FunnelVariantTag | null;
  readonly metadata: Readonly<Record<string, unknown>>; // step-specific config
}

// ---------------------------------------------------------------------------
// Internal builder — freezes nested structures so every screen is fully
// immutable (defence-in-depth alongside Object.freeze at module load).
// ---------------------------------------------------------------------------

function buildScreen(
  stepId: FunnelStepId,
  config: Omit<FunnelScreen, 'stepId' | 'stepNumber'>,
): FunnelScreen {
  const stepNumber = FUNNEL_STEPS_ORDERED.indexOf(stepId) + 1;
  if (stepNumber === 0) {
    throw new Error(`Unknown funnel step id: ${stepId}`);
  }
  return Object.freeze({
    stepId,
    stepNumber,
    headline: config.headline,
    subhead: config.subhead,
    bodyCopy: config.bodyCopy,
    ctas: Object.freeze(config.ctas.map((c) => Object.freeze({ ...c }))),
    variantTag: config.variantTag,
    metadata: Object.freeze({ ...config.metadata }),
  }) satisfies FunnelScreen;
}

// ---------------------------------------------------------------------------
// FUNNEL_SCREENS — the 12 Korean-variant screen configurations
// ---------------------------------------------------------------------------

/**
 * Frozen map of every funnel step ID → its Korean-variant `FunnelScreen`.
 * Exhaustive on `FunnelStepId` (compile-time enforced via the type below).
 */
export const FUNNEL_SCREENS: Readonly<Record<FunnelStepId, FunnelScreen>> =
  Object.freeze({
    // Step 1 — 퍼스널 컬러 진단 hook 인입 ------------------------------------
    welcome_hook: buildScreen('welcome_hook', {
      headline: '내 퍼스널 컬러로 셀카가 한 장 더 빛나도록',
      subhead: '1분 진단으로 봄·여름·가을·겨울 카테고리부터 맞춤 편집까지',
      bodyCopy: null,
      ctas: [
        { label: '1분 진단 시작', action: 'advance', variant: 'primary' },
      ],
      variantTag: null,
      metadata: { hook: 'personal_color_diagnosis' },
    }),

    // Step 2 — 가치 제안 (트렌드 맞춤 편집/생성) ----------------------------
    value_props: buildScreen('value_props', {
      headline: '오늘의 트렌드, 내 얼굴에 맞춘 편집',
      subhead: '퍼스널 컬러 기반 추천 preset · 매월 새 스타일 자동 업데이트',
      bodyCopy:
        '셀카 한 장 → 컬러 카테고리 매칭 → 트렌드 preset 자동 적용. ' +
        '편집은 우리가, 큐레이션은 매월 매거진으로.',
      ctas: [
        { label: '다음', action: 'advance', variant: 'primary' },
      ],
      variantTag: null,
      metadata: {
        valueProps: [
          'trend_matched_editing',
          'monthly_curated_magazine',
          'personal_color_preset_library',
        ],
      },
    }),

    // Step 3 — 온보딩 priming (v0.2 신설, social_proof_intro 교체) -----------
    // 결과에 영향 없는 온보딩 질문 2개로 "나는 ~한 사람" declare를 유도,
    // 일관성 lever를 활성화해 step 4 별점 게이트 priming 역할 수행.
    onboarding_priming: buildScreen('onboarding_priming', {
      headline: '나에 대해 짧게 알려주세요',
      subhead: '결과에 영향을 주지 않는 2개 질문 · 더 정확한 가이드를 위해',
      bodyCopy: null,
      ctas: [
        { label: '계속', action: 'advance', variant: 'primary' },
      ],
      variantTag: null,
      metadata: {
        primingMechanism: 'consistency_lever',
        onboardingQuestionCount: 2,
        replaces: 'social_proof_intro_v0_1',
      },
    }),

    // Step 4 — iOS native 별점 dialog (dismissable) -------------------------
    rating_gate: buildScreen('rating_gate', {
      headline: '잠깐, 별점 한 번만 부탁드려요',
      subhead: 'iOS 별점 dialog 입니다. 부담 없이 나중으로 미뤄도 괜찮아요.',
      bodyCopy: null,
      ctas: [
        { label: '별점 남기기', action: 'submit_rating', variant: 'primary' },
        { label: '나중에', action: 'skip', variant: 'dismiss' },
      ],
      variantTag: null,
      metadata: { dialogType: 'ios_native', dismissable: true },
    }),

    // Step 5 — 가짜 5초 로더 (v0.2 이동, 구 step 8) ------------------------
    // 텍스트 노력 정당화 priming. price_anchoring(v0.1 step 5)은 폐기되어
    // 가격 노출은 step 12 payment_model 단일화. 시각 노력 정당화는 step 8
    // fake_scan_animation에서 별도 강화.
    fake_loader: buildScreen('fake_loader', {
      headline: 'AI가 24개 포인트로 분석 중...',
      subhead: '피부 톤 · 명도 · 채도 · 컨트라스트를 한번에 계산하고 있어요',
      bodyCopy: null,
      ctas: [
        // No user CTA; the loader auto-advances after durationMs.
        { label: '잠시만요', action: 'auto_advance', variant: 'tertiary' },
      ],
      variantTag: null,
      metadata: {
        durationMs: 5_000,
        autoAdvance: true,
        analysisPoints: 24,
        movedFromStep: 8,
      },
    }),

    // Step 6 — 3개 스캔 옵션 (메인 = 퍼스널 컬러) ---------------------------
    scan_option_select: buildScreen('scan_option_select', {
      headline: '어떤 진단부터 시작할까요?',
      subhead: '메인은 퍼스널 컬러. 보조 2개 옵션은 곧 정식 오픈 (Phase-N).',
      bodyCopy: null,
      ctas: [
        {
          label: '퍼스널 컬러 진단',
          action: 'select_scan_personal_color',
          variant: 'primary',
        },
        {
          label: '두번째 스캔 (곧 오픈)',
          action: 'select_scan_secondary',
          variant: 'secondary',
        },
        {
          label: '세번째 스캔 (곧 오픈)',
          action: 'select_scan_secondary',
          variant: 'tertiary',
        },
      ],
      variantTag: null,
      metadata: {
        mainScan: 'personal_color',
        secondaryScans: [
          { slot: 2, status: 'phase_n_tbd' },
          { slot: 3, status: 'phase_n_tbd' },
        ],
        optionCount: 3,
      },
    }),

    // Step 7 — 셀카 업로드 단독 (v0.2: 온보딩 질문은 step 3로 분리) ---------
    diagnosis_input: buildScreen('diagnosis_input', {
      headline: '셀카 1장만 올려주세요',
      subhead: '정면 · 자연광 · 민낯에 가까울수록 결과가 정확해요',
      bodyCopy: null,
      ctas: [
        { label: '셀카 업로드하기', action: 'upload_selfie', variant: 'primary' },
      ],
      variantTag: null,
      metadata: {
        requiredInputs: ['selfie_image'],
        onboardingMovedToStep: 3,
      },
    }),

    // Step 8 — 가짜 스캔 애니메이션 (v0.2 신설) ------------------------------
    // 시각 노력 정당화 priming. step 5 fake_loader (텍스트) + step 8
    // fake_scan_animation (시각) 이중 mechanism으로 sunk-cost 누적 확장.
    fake_scan_animation: buildScreen('fake_scan_animation', {
      headline: '얼굴 24개 포인트 스캔 중',
      subhead: '셀카 위에서 스캔 라인이 24개 포인트를 짚어내고 있어요',
      bodyCopy: null,
      ctas: [
        // No user CTA; the visual animation auto-advances after durationMs.
        { label: '스캔 중...', action: 'auto_advance', variant: 'tertiary' },
      ],
      variantTag: null,
      metadata: {
        durationMs: 5_000,
        autoAdvance: true,
        analysisPoints: 24,
        animationMechanism: 'face_scan_overlay',
        complementsTextLoaderAtStep: 5,
      },
    }),

    // Step 9 — 진단 결과 부분 공개 (잠금) -----------------------------------
    result_reveal: buildScreen('result_reveal', {
      headline: '당신의 카테고리는 ✦ 가을 웜톤 ✦',
      subhead: '어울리는 메이크업·코디 + 맞춤 편집 결과는 다음 단계에서 공개돼요',
      bodyCopy:
        '전체 진단 카드 · 가이드 텍스트 · 첫 추천 패키지 4종이 잠겨 있어요.',
      ctas: [
        { label: '결과 잠금 해제', action: 'unlock_result', variant: 'primary' },
      ],
      variantTag: null,
      metadata: {
        locked: true,
        teaserCategory: 'autumn_warm',
        lockedAssets: ['full_category_card', 'guide_text', 'first_curation'],
      },
    }),

    // Step 10 (KR variant) — 1명 친구 추천 게이트 ---------------------------
    referral_gate: buildScreen('referral_gate', {
      headline: '친구 한 명에게 진단 공유하면 다음으로 넘어가요',
      subhead: '한국 시장 변형: 50% 할인 게이트 폐기, 부담 없이 1명만 부탁드려요',
      bodyCopy: null,
      ctas: [
        { label: '공유하고 계속', action: 'share_referral', variant: 'primary' },
      ],
      variantTag: 'kr_variant',
      metadata: {
        requiredReferrals: 1,
        replaces: 'standard_50pct_off_gate',
        rationale: 'korean_market_fit_pressure_avoidance',
      },
    }),

    // Step 11 (KR variant, v0.2 — social_proof_intro 흡수) ------------------
    // social_evolution이 12만+ 유저 aggregate proof를 흡수해 UGC + 인플루언서 +
    // 사용자 수까지 한 화면에서 단계 진화 사회 증명 단일화.
    social_evolution: buildScreen('social_evolution', {
      headline: '@user_kim · @beautymee 가 직접 쓴 후기',
      subhead: '실제 UGC + 인플루언서 인용 + 12만+ 사용자 진단 누적',
      bodyCopy:
        '한국 리뷰 검증 문화에 맞춰 가짜 별점 패턴을 버리고, ' +
        '실제 사용자 게시물 · 인플루언서 인용 · 12만+ 누적 진단으로 ' +
        '사회 증명을 단계 진화시켰어요.',
      ctas: [
        { label: '계속', action: 'advance', variant: 'primary' },
      ],
      variantTag: 'kr_variant',
      metadata: {
        replaces: 'standard_fake_figma_reviews',
        proofSources: [
          'user_generated_content',
          'influencer_quotes',
          'aggregate_user_count',
        ],
        userCountClaim: 120_000,
        absorbs: 'social_proof_intro_v0_1',
        evolutionStage: 'phase_2_real_proof',
      },
    }),

    // Step 12 (KR variant) — 결제 모델 ($12/월 or $59/연 + 37일 무료체험) ----
    payment_model: buildScreen('payment_model', {
      headline: '지금 잠금 해제하기',
      subhead: '월 $12 · 연 $59 (연결제 시 7일 + 30일 = 37일 무료체험)',
      bodyCopy:
        '연결제를 고르면 기본 7일 무료체험에 30일이 더해져 총 37일 무료. ' +
        '무료체험 종료 7일 전 알림으로 부담 없이 결정할 수 있어요.',
      ctas: [
        {
          label: '연결제 — 37일 무료체험',
          action: 'select_annual',
          variant: 'primary',
        },
        {
          label: '월결제 — $12',
          action: 'select_monthly',
          variant: 'secondary',
        },
      ],
      variantTag: 'kr_variant',
      metadata: {
        monthlyUsd: 12,
        annualUsd: 59,
        freeTrialDays: 37,
        trialBreakdown: { baseTrialDays: 7, annualBonusDays: 30 },
        billingNotice: 'remind_7d_before_trial_end',
      },
    }),
  });

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the frozen Korean-variant `FunnelScreen` configuration for a given
 * funnel step.  Total over `FunnelStepId` — no `undefined` paths.
 */
export function renderStep(stepId: FunnelStepId): FunnelScreen {
  // FUNNEL_SCREENS is exhaustively keyed by FunnelStepId; this lookup is total.
  return FUNNEL_SCREENS[stepId];
}

/**
 * Returns all 12 screens in canonical funnel order.
 * Convenience for iteration / analytics / preview generation.
 */
export function renderAllSteps(): readonly FunnelScreen[] {
  return Object.freeze(FUNNEL_STEPS_ORDERED.map((id) => FUNNEL_SCREENS[id]));
}
