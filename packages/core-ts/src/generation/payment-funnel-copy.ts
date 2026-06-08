/**
 * Payment funnel copy — Sub-AC 3d.
 *
 * Functions that produce ALL user-facing strings emitted during the Glam Up
 * 12-step conversion funnel (한국 변형) — specifically the step labels,
 * upsell prompts, and confirmation messages associated with the payment gate:
 *
 *   1. `getPaymentStepHeadline(config?)` — headline for step 12
 *      (`payment_model`), the primary conversion ask.
 *      Slot: `payment_step_headline`.
 *
 *   2. `getPaymentStepSubhead(monthlyPrice, annualPrice, config?)` — one-line
 *      pricing summary for step 12. Template slots: `{{monthly_price}}` and
 *      `{{annual_price}}`; substituted with runtime values before returning.
 *      Slot: `payment_step_subhead`.
 *
 *   3. `getPaymentStepBody(config?)` — body copy for step 12 describing the
 *      free-trial breakdown (7 base + 30 annual bonus = 37 days).
 *      Slot: `payment_step_body`.
 *
 *   4. `getPaymentAnnualPlanCta(config?)` — primary CTA label for the annual
 *      plan selection. Emphasises the 37-day trial (Seed: "무료체험 강조").
 *      Slot: `payment_annual_plan_cta`.
 *
 *   5. `getPaymentMonthlyPlanCta(monthlyPrice, config?)` — secondary CTA label
 *      for the monthly plan. Template slot: `{{monthly_price}}`; substituted
 *      with the runtime price before returning.
 *      Slot: `payment_monthly_plan_cta`.
 *
 *   6. `getPaymentUpsellPrompt(config?)` — value proposition shown above the
 *      plan options; explains *why* subscription is worth it in terms of trend
 *      cadence (not appearance). Slot: `payment_upsell_prompt`.
 *
 *   7. `getPaymentConfirmedHeadline(config?)` — headline on the post-payment
 *      confirmation screen; invites the user to start generating immediately.
 *      Slot: `payment_confirmed_headline`.
 *
 *   8. `getPaymentConfirmedSubhead(config?)` — supporting copy on the
 *      post-payment confirmation screen; sets expectation for trend-drop
 *      notifications (retention hook). Slot: `payment_confirmed_subhead`.
 *
 * Design contract (Seed Sub-AC 3d):
 *   - Every function accepts an optional `VoiceConfig` parameter so callers
 *     (including unit tests) can inject any config — including a stub — without
 *     relying on module-level mocking.
 *   - When no config is provided the functions fall back to `VOICE_CONFIG`, the
 *     frozen production singleton from `voice/config.ts`.
 *   - **No string literal** from the payment funnel is hardcoded in this
 *     module. All copy derives exclusively from the injected (or default)
 *     config's `slots`. This is what the unit test verifies via a stub whose
 *     values are entirely different from production Korean copy.
 *   - Template substitution (price values) happens in these functions —
 *     callers receive the final resolved string.
 *
 * Masking-trap guard (Seed):
 *   None of these functions optimise for conversion. The copy surfaces the
 *   *free-trial emphasis* and *trend-cadence value* without pressuring the
 *   user — aligned with the guardrail constraint (conversion rate = lower bound
 *   only, not a maximise target).
 *
 * No side effects, no vendor calls, no I/O. Pure functions.
 */

import { VOICE_CONFIG, type VoiceConfig } from '../voice/config.js';

// ---------------------------------------------------------------------------
// Public API — step 12 copy (payment_model screen)
// ---------------------------------------------------------------------------

/**
 * Returns the headline for step 12 (`payment_model`) — the primary
 * conversion ask.
 *
 * The voice config slot is used verbatim (no template placeholders).
 *
 * @param config Optional voice config to use; defaults to `VOICE_CONFIG`.
 */
export function getPaymentStepHeadline(
  config: VoiceConfig = VOICE_CONFIG,
): string {
  return config.slots.payment_step_headline;
}

/**
 * Returns the one-line pricing summary subhead for step 12.
 *
 * The voice config slot (`payment_step_subhead`) contains the
 * `{{monthly_price}}` and `{{annual_price}}` placeholders; this function
 * substitutes them with the runtime USD amounts before returning.
 *
 * @example
 *   getPaymentStepSubhead(12, 59)
 *   // → "월 $12 · 연 $59 (연결제 시 7일 + 30일 = 37일 무료체험)"
 *
 * @param monthlyPrice  Monthly plan price in USD (integer; e.g. 12).
 * @param annualPrice   Annual plan price in USD (integer; e.g. 59).
 * @param config        Optional voice config; defaults to `VOICE_CONFIG`.
 */
export function getPaymentStepSubhead(
  monthlyPrice: number,
  annualPrice: number,
  config: VoiceConfig = VOICE_CONFIG,
): string {
  return config.slots.payment_step_subhead
    .replace('{{monthly_price}}', String(monthlyPrice))
    .replace('{{annual_price}}', String(annualPrice));
}

/**
 * Returns the body copy for step 12 — explains the free-trial breakdown
 * (7-day base + 30-day annual bonus = 37 total days).
 *
 * @param config Optional voice config to use; defaults to `VOICE_CONFIG`.
 */
export function getPaymentStepBody(
  config: VoiceConfig = VOICE_CONFIG,
): string {
  return config.slots.payment_step_body;
}

// ---------------------------------------------------------------------------
// Public API — plan selection CTAs (step 12)
// ---------------------------------------------------------------------------

/**
 * Returns the primary CTA label for annual-plan selection.
 *
 * The label emphasises the 37-day free trial (Seed: "무료체험 강조") —
 * reducing pressure while signalling the default recommended path.
 *
 * @param config Optional voice config to use; defaults to `VOICE_CONFIG`.
 */
export function getPaymentAnnualPlanCta(
  config: VoiceConfig = VOICE_CONFIG,
): string {
  return config.slots.payment_annual_plan_cta;
}

/**
 * Returns the secondary CTA label for monthly-plan selection.
 *
 * The voice config slot (`payment_monthly_plan_cta`) contains the
 * `{{monthly_price}}` placeholder; this function substitutes it with the
 * runtime USD amount before returning.
 *
 * @example
 *   getPaymentMonthlyPlanCta(12)
 *   // → "월결제 — $12"
 *
 * @param monthlyPrice  Monthly plan price in USD (integer; e.g. 12).
 * @param config        Optional voice config; defaults to `VOICE_CONFIG`.
 */
export function getPaymentMonthlyPlanCta(
  monthlyPrice: number,
  config: VoiceConfig = VOICE_CONFIG,
): string {
  return config.slots.payment_monthly_plan_cta.replace(
    '{{monthly_price}}',
    String(monthlyPrice),
  );
}

// ---------------------------------------------------------------------------
// Public API — upsell prompt (step 12, above plan options)
// ---------------------------------------------------------------------------

/**
 * Returns the upsell value proposition shown above the plan options.
 *
 * The copy explains *why* subscription is worth it in terms of trend cadence
 * — not appearance claims or styling outcomes. Aligned with the Seed voice
 * constraint: 트렌드 타이밍 + 사진 감각, no appearance language.
 *
 * @param config Optional voice config to use; defaults to `VOICE_CONFIG`.
 */
export function getPaymentUpsellPrompt(
  config: VoiceConfig = VOICE_CONFIG,
): string {
  return config.slots.payment_upsell_prompt;
}

// ---------------------------------------------------------------------------
// Public API — post-payment confirmation screen copy
// ---------------------------------------------------------------------------

/**
 * Returns the headline shown on the post-payment / subscription-activated
 * confirmation screen.
 *
 * The headline invites immediate engagement ("지금 바로 생성해보세요") —
 * converting the payment moment into a generation action.
 *
 * @param config Optional voice config to use; defaults to `VOICE_CONFIG`.
 */
export function getPaymentConfirmedHeadline(
  config: VoiceConfig = VOICE_CONFIG,
): string {
  return config.slots.payment_confirmed_headline;
}

/**
 * Returns the supporting copy on the post-payment confirmation screen.
 *
 * Sets the expectation for trend-drop push notifications — establishing the
 * retention loop at the exact moment the user has the highest intent.
 *
 * @param config Optional voice config to use; defaults to `VOICE_CONFIG`.
 */
export function getPaymentConfirmedSubhead(
  config: VoiceConfig = VOICE_CONFIG,
): string {
  return config.slots.payment_confirmed_subhead;
}
