/**
 * Single-voice config module — moat rework (Sub-AC 2).
 *
 * The Seed eliminates the ToneSwitcher 4-tone system and replaces it with a
 * single authoritative voice defined along two axes:
 *
 *   1. **트렌드 타이밍** — "언제 갱신하는가" (when to refresh, tied to trend drops)
 *   2. **사진 감각**    — "구도·빛·보정 + 얼굴 보정" (photo composition & retouch
 *      sensibility, expressed in copy without touching appearance/styling)
 *
 * This module is the single source of truth for:
 *   - The voice identifier (`voiceId`) — a stable kebab-case string used by
 *     analytics and copy-dispatch routes.
 *   - Copy template slots — keyed placeholder strings that every other copy
 *     surface derives from.  Template slots use `{{}}` mustache delimiters so
 *     renderers can substitute runtime values (season, trend name, user name)
 *     without re-authoring the voice.
 *
 * Constraints (from Seed):
 *   - Only 1 voice.  Exporting multiple voice objects or a toggle is a
 *     regression to the ToneSwitcher pattern.
 *   - Voice covers *timing* and *photo craft*, NOT appearance/styling or
 *     affiliate claims.
 *   - The config must be frozen (immutable) — consistent with all other
 *     domain objects in the codebase.
 *   - No vendor calls, no I/O.  Pure static config.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Stable identifier for the single editorial voice.
 * kebab-case; never changes between releases (analytics key).
 */
export type VoiceId = 'trend-editor-kr';

/**
 * A resolved copy string with all `{{placeholder}}` tokens filled in.
 */
export type ResolvedCopy = string;

/**
 * Named slots that every copy surface in the app derives from.
 *
 * Slots are *template strings* — they may contain `{{placeholder}}` tokens
 * that callers resolve at render time (e.g. `{{trend_name}}`, `{{season}}`).
 * An empty slot is a contract violation (detected by the unit test and the
 * `__post_construct__` guard below).
 *
 * Slot naming convention:
 *   `<surface>_<role>`
 *   e.g. `trend_drop_push_title` = push notification title for a trend drop.
 */
export interface VoiceCopySlots {
  // ── Trend-drop push notification ──────────────────────────────────────────
  /** Push notification title when a new trend recipe is published. */
  readonly trend_drop_push_title: string;
  /** Push notification body copy — one-line tease of the new trend. */
  readonly trend_drop_push_body: string;

  // ── In-app trend-drop CTA ─────────────────────────────────────────────────
  /** Primary CTA label on the trend-drop card. */
  readonly trend_drop_cta_primary: string;

  // ── Entry wedge — personal-colour diagnosis & onboarding ─────────────────
  /**
   * Headline for the personal-colour diagnosis entry wedge (step 1 welcome hook).
   * Reflects voice axis: 트렌드 타이밍 + 사진 감각.
   * No appearance/styling language — only photo craft and trend timing.
   */
  readonly diagnosis_wedge_headline: string;
  /**
   * Subhead for the entry wedge — supports the wedge headline with photo-craft
   * copy. Template may contain `{{season}}` if the season is known at render
   * time; callers substitute it before display.
   */
  readonly diagnosis_wedge_subhead: string;
  /**
   * Primary CTA label that starts the personal-colour diagnosis flow
   * (step 1 "1분 진단 시작" equivalent). Must not reference appearance or styling.
   */
  readonly diagnosis_wedge_cta: string;
  /**
   * Primary CTA label on the result-reveal screen (step 9).
   * Prompts the user to proceed to unlock their diagnosed result.
   */
  readonly result_reveal_cta: string;

  // ── Result screen — post-diagnosis ────────────────────────────────────────
  /** Headline shown when the personal-color result is revealed. */
  readonly result_reveal_headline: string;
  /** Sub-copy under the result headline — surfaces photo-craft sensibility. */
  readonly result_reveal_subhead: string;

  // ── Generation funnel ─────────────────────────────────────────────────────
  /**
   * Candidate count label (template: `{{count}}`).
   * e.g. "후보 {{count}}장 생성됨" → "후보 4장 생성됨"
   */
  readonly generation_candidate_count_label: string;
  /** Label above the candidate grid (N generated photos before user pick). */
  readonly generation_pick_prompt: string;
  /** Micro-copy shown while the enhancer pipeline is running. */
  readonly generation_enhancing_label: string;

  // ── Subscription / payment ────────────────────────────────────────────────
  /** Value proposition copy on the payment screen — single sentence. */
  readonly payment_value_prop: string;

  // ── Payment funnel — step 12 conversion copy (Sub-AC 3d) ─────────────────
  /**
   * Headline for step 12 (`payment_model`) — the primary conversion ask.
   * No template placeholders; rendered verbatim.
   */
  readonly payment_step_headline: string;
  /**
   * Subhead for step 12 — one-line pricing summary.
   * Template slots: `{{monthly_price}}` (e.g. "12") and `{{annual_price}}`
   * (e.g. "59"). Callers substitute the USD amounts before display.
   */
  readonly payment_step_subhead: string;
  /**
   * Body copy for step 12 — free-trial breakdown explanation.
   * No template placeholders; describes the 7-day base + 30-day annual bonus.
   */
  readonly payment_step_body: string;
  /**
   * Primary CTA label for annual-plan selection (step 12).
   * Must emphasise the 37-day free trial (Seed: "무료체험 강조").
   */
  readonly payment_annual_plan_cta: string;
  /**
   * Secondary CTA label for monthly-plan selection (step 12).
   * Template slot: `{{monthly_price}}` (e.g. "12"). Callers substitute before
   * display so the price string is never inlined in the copy module.
   */
  readonly payment_monthly_plan_cta: string;
  /**
   * Upsell value proposition shown above the plan options — explains *why*
   * subscription is worth it (trend cadence, not appearance claims).
   */
  readonly payment_upsell_prompt: string;
  /**
   * Headline shown on the post-payment / subscription-activated confirmation
   * screen. Signals immediate value — invites the user to start generating.
   */
  readonly payment_confirmed_headline: string;
  /**
   * Supporting copy on the post-payment confirmation screen — sets the
   * expectation for trend-drop notifications (retention hook).
   */
  readonly payment_confirmed_subhead: string;

  // ── Guardrail / conversion ────────────────────────────────────────────────
  /**
   * Copy for the free-trial emphasis block.
   * Seed: "무료체험 강조" — minimize pressure, maximise trust.
   */
  readonly free_trial_emphasis: string;
}

/**
 * Complete voice configuration object.
 * Frozen at construction — never mutated after module load.
 */
export interface VoiceConfig {
  /** Stable analytics identifier. Always `'trend-editor-kr'` in v1. */
  readonly voiceId: VoiceId;
  /**
   * Human-readable description of the voice axes (informational, not rendered
   * to users — helps contributors understand the copy contract).
   */
  readonly description: string;
  /** All copy template slots. Each value must be a non-empty string. */
  readonly slots: Readonly<VoiceCopySlots>;
}

// ---------------------------------------------------------------------------
// Singleton voice config
// ---------------------------------------------------------------------------

/**
 * The single editorial voice for the Korean-market selfie-generation app.
 *
 * Voice axes (Seed-derived):
 *   - 트렌드 타이밍: "지금 막 뜬 거야" — treats trend freshness as the primary
 *     editorial authority.  Copy signals *when* things happened, not *what*
 *     to buy.
 *   - 사진 감각: "구도·빛·보정 + 얼굴 보정" — copy touches composition, light,
 *     colour grading, and face-retouching craft only.  Appearance (외모)
 *     and styling (스타일링) are outside the product boundary.
 */
export const VOICE_CONFIG: Readonly<VoiceConfig> = Object.freeze({
  voiceId: 'trend-editor-kr' as VoiceId,

  description:
    '트렌드 타이밍(언제 갱신) + 사진 감각(구도·빛·보정·얼굴 보정) — ' +
    '단일 POV, 한국 시장 셀카 생성 앱. ToneSwitcher 4톤 폐기.',

  slots: Object.freeze<VoiceCopySlots>({
    // Trend-drop push ─────────────────────────────────────────────────────────
    trend_drop_push_title: '{{trend_name}} 방금 떴어 — 네 셀카 restyle할 시간',
    trend_drop_push_body:
      '새 트렌드 recipe가 업데이트됐어요. {{season}} 맞춤 조합으로 지금 바로 생성해보세요.',

    // In-app trend-drop CTA ────────────────────────────────────────────────────
    trend_drop_cta_primary: '지금 내 셀카에 적용하기',

    // Entry wedge — personal-colour diagnosis & onboarding ────────────────────
    diagnosis_wedge_headline: '내 퍼스널 컬러로 셀카 구도와 빛을 찾아드려요',
    diagnosis_wedge_subhead:
      '1분 진단 → 트렌드 recipe 자동 매칭 → 보정된 셀카 생성',
    diagnosis_wedge_cta: '1분 진단 시작하기',
    result_reveal_cta: '내 결과 잠금 해제하기',

    // Result reveal ────────────────────────────────────────────────────────────
    result_reveal_headline: '{{season}} — 지금 가장 잘 맞는 구도와 빛을 찾았어요',
    result_reveal_subhead:
      '퍼스널 컬러 기반 보정 recipe로 셀카 한 장이 달라집니다.',

    // Generation funnel ────────────────────────────────────────────────────────
    generation_candidate_count_label: '후보 {{count}}장 생성됨',
    generation_pick_prompt: '마음에 드는 한 장을 고르세요',
    generation_enhancing_label: '생성 중 · 자동 보정 적용하는 중...',

    // Payment ──────────────────────────────────────────────────────────────────
    payment_value_prop:
      '트렌드가 바뀔 때마다 새 recipe — 내 얼굴에 맞는 셀카를 계속 업데이트해드려요.',

    // Payment funnel — step 12 copy (Sub-AC 3d) ────────────────────────────────
    payment_step_headline: '지금 잠금 해제하기',
    payment_step_subhead:
      '월 ${{monthly_price}} · 연 ${{annual_price}} (연결제 시 7일 + 30일 = 37일 무료체험)',
    payment_step_body:
      '연결제를 고르면 기본 7일 무료체험에 30일이 더해져 총 37일 무료. ' +
      '무료체험 종료 7일 전 알림으로 부담 없이 결정할 수 있어요.',
    payment_annual_plan_cta: '연결제 — 37일 무료체험',
    payment_monthly_plan_cta: '월결제 — ${{monthly_price}}',
    payment_upsell_prompt:
      '트렌드 드롭마다 새 recipe — 내 퍼스널 컬러에 맞는 셀카를 바로 생성해드려요.',
    payment_confirmed_headline: '잠금 해제 완료 — 지금 바로 생성해보세요',
    payment_confirmed_subhead:
      '트렌드 드롭이 올 때마다 알림으로 알려드릴게요.',

    // Free-trial (pressure-avoidance copy, Seed: 무료체험 강조) ───────────────
    free_trial_emphasis:
      '37일 무료체험 · 결제일 7일 전 알림 · 언제든 취소 가능',
  }),
});

// ---------------------------------------------------------------------------
// Integrity guard — fail at module load if a slot is empty
// ---------------------------------------------------------------------------

(function validateVoiceConfigIntegrity(): void {
  const { voiceId, description, slots } = VOICE_CONFIG;

  if (!voiceId || voiceId.trim() === '') {
    throw new Error('[VoiceConfig] voiceId must be a non-empty string');
  }
  if (!description || description.trim() === '') {
    throw new Error('[VoiceConfig] description must be a non-empty string');
  }

  const emptySlots: string[] = [];
  for (const [key, value] of Object.entries(slots)) {
    if (typeof value !== 'string' || value.trim() === '') {
      emptySlots.push(key);
    }
  }
  if (emptySlots.length > 0) {
    throw new Error(
      `[VoiceConfig] the following copy slots are empty or missing: ${emptySlots.join(', ')}`,
    );
  }
})();
