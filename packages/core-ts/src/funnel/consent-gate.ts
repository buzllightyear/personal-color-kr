/**
 * consent-gate.ts — 동의 체크 게이트 함수 (Sub-AC 3-2).
 *
 * Pure function: given the set of consent items required for a funnel-step
 * entry and the set currently checked by the user, returns whether the user
 * may proceed into that step.
 *
 * ## Korean market context
 *
 * Korean app-store regulations (and user expectation norms) require explicit,
 * granular agreement *before* a user enters personal-data collection flows.
 * Each consent item must be presented as a separately-tappable checkbox so
 * users can accept required items while refusing optional ones.
 *
 *   [필수] terms_of_service   — 서비스 이용 약관
 *   [필수] privacy_policy     — 개인정보 처리방침 (PIPA 개인정보 보호법)
 *   [필수] age_verification   — 만 14세 이상 확인
 *   [선택] marketing_consent  — 마케팅 정보 수신 동의 (이메일·푸시)
 *
 * ## Step → required consent items mapping (v0.2 funnel, 12 steps)
 *
 *   | Step                | Required consent items                              |
 *   | ------------------- | --------------------------------------------------- |
 *   | welcome_hook        | terms_of_service, privacy_policy, age_verification  |
 *   | (all other steps)   | (none — consent is collected once at step 1)        |
 *
 * ## Three status categories (AC requirement)
 *
 *   - `'all_consented'`      — 전체 동의: every required item is checked.
 *                              Step entry IS allowed.
 *   - `'partially_consented'`— 부분 동의: at least one required item is
 *                              checked but not all.  Step entry is NOT
 *                              allowed until the unchecked items are ticked.
 *   - `'not_consented'`      — 미동의: zero required items are checked.
 *                              Step entry is NOT allowed.
 *
 * ## Design choices
 *
 * - `checkConsentStatus` is the canonical, discriminated-union-returning
 *   function; `isConsentGatePassed` is a thin boolean convenience wrapper.
 * - `getUncheckedRequired` is a companion helper (analogous to
 *   `getMissingFields` in step-input-gate.ts) that returns the IDs of
 *   required items that have not yet been checked — useful for rendering
 *   inline validation messages ("약관에 동의해 주세요").
 * - All returned arrays/sets are `Object.freeze`d — callers cannot mutate
 *   the gate's output.
 * - `STEP_CONSENT_REQUIREMENTS` is typed as `Record<FunnelStepId, …>` to
 *   force exhaustive compile-time coverage: adding a new step without
 *   updating this map is a TypeScript error.
 * - Inputs are `readonly` throughout; no in-place mutation is performed.
 */

import type { FunnelStepId } from './types.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Identifiers for the four consent items presented in the Korean market app.
 *
 *   - `'terms_of_service'`  — [필수] 서비스 이용 약관
 *   - `'privacy_policy'`    — [필수] 개인정보 처리방침 (PIPA)
 *   - `'age_verification'`  — [필수] 만 14세 이상 확인
 *   - `'marketing_consent'` — [선택] 마케팅 정보 수신 동의
 */
export type ConsentItemId =
  | 'terms_of_service'
  | 'privacy_policy'
  | 'age_verification'
  | 'marketing_consent';

/**
 * All canonical consent item IDs, ordered as they appear in the UI.
 * Useful for iterating the full set in tests and rendering.
 */
export const ALL_CONSENT_ITEM_IDS: readonly ConsentItemId[] = Object.freeze([
  'terms_of_service',
  'privacy_policy',
  'age_verification',
  'marketing_consent',
] as const);

/**
 * Consent items that are mandatory for step entry.
 * `marketing_consent` is optional — a user may refuse it without being blocked.
 */
export const REQUIRED_CONSENT_ITEM_IDS: readonly ConsentItemId[] = Object.freeze([
  'terms_of_service',
  'privacy_policy',
  'age_verification',
] as const);

/**
 * Discriminated result of a consent gate check.
 *
 *   - `'all_consented'`       — 전체 동의: all required items checked → entry allowed.
 *   - `'partially_consented'` — 부분 동의: ≥1 required checked but not all → blocked.
 *   - `'not_consented'`       — 미동의: no required item checked → blocked.
 */
export type ConsentCheckStatus =
  | 'all_consented'
  | 'partially_consented'
  | 'not_consented';

// ---------------------------------------------------------------------------
// Per-step consent requirement definitions
// ---------------------------------------------------------------------------

interface StepConsentRequirement {
  /** Required consent item IDs for this step. Empty = unconditionally allowed. */
  readonly required: readonly ConsentItemId[];
}

/**
 * Exhaustive map from every `FunnelStepId` to its consent requirement.
 * Typed as `Record<FunnelStepId, StepConsentRequirement>` so TypeScript
 * will refuse to compile when a new step is added without a matching entry.
 *
 * Consent is collected ONCE at `welcome_hook` (step 1).  All subsequent
 * steps have an empty `required` array and are unconditionally allowed —
 * the gate is satisfied regardless of what the caller passes.
 */
const STEP_CONSENT_REQUIREMENTS: Readonly<
  Record<FunnelStepId, StepConsentRequirement>
> = {
  // Step 1 — consent gate: all three required items must be checked
  welcome_hook: {
    required: REQUIRED_CONSENT_ITEM_IDS,
  },

  // Steps 2-12 — consent already collected; no gate
  value_props: { required: [] },
  onboarding_priming: { required: [] },
  rating_gate: { required: [] },
  fake_loader: { required: [] },
  scan_option_select: { required: [] },
  diagnosis_input: { required: [] },
  fake_scan_animation: { required: [] },
  result_reveal: { required: [] },
  referral_gate: { required: [] },
  social_evolution: { required: [] },
  payment_model: { required: [] },
} as const;

// ---------------------------------------------------------------------------
// Core pure functions
// ---------------------------------------------------------------------------

/**
 * Returns the consent check status for a given step and the user's currently
 * checked items.
 *
 * The function is a pure, deterministic predicate: same inputs always produce
 * the same output, no globals, no side-effects, no `Date.now()`.
 *
 * @param stepId       - The funnel step for which entry is being attempted.
 * @param checkedItems - The consent item IDs that the user has checked.
 *   May be any iterable (array, Set, readonly array, …).
 * @returns
 *   - `'all_consented'`       when every required item for `stepId` is checked.
 *   - `'partially_consented'` when ≥1 required item is checked but not all.
 *   - `'not_consented'`       when zero required items are checked.
 *
 * @example
 * ```ts
 * // welcome_hook — all three required items checked
 * checkConsentStatus('welcome_hook', [
 *   'terms_of_service',
 *   'privacy_policy',
 *   'age_verification',
 * ]);
 * // → 'all_consented'
 *
 * // welcome_hook — only one required item checked
 * checkConsentStatus('welcome_hook', ['terms_of_service']);
 * // → 'partially_consented'
 *
 * // welcome_hook — nothing checked
 * checkConsentStatus('welcome_hook', []);
 * // → 'not_consented'
 *
 * // diagnosis_input — no consent required; always passes
 * checkConsentStatus('diagnosis_input', []);
 * // → 'all_consented'
 * ```
 */
export function checkConsentStatus(
  stepId: FunnelStepId,
  checkedItems: Iterable<ConsentItemId>,
): ConsentCheckStatus {
  const { required } = STEP_CONSENT_REQUIREMENTS[stepId];

  // Steps with no required consent items are unconditionally satisfied.
  if (required.length === 0) {
    return 'all_consented';
  }

  // Build a lookup set from the caller's iterable (O(n) single pass).
  const checkedSet = new Set<ConsentItemId>(checkedItems);

  let checkedCount = 0;
  for (const item of required) {
    if (checkedSet.has(item)) {
      checkedCount += 1;
    }
  }

  if (checkedCount === required.length) {
    return 'all_consented';
  }

  if (checkedCount > 0) {
    return 'partially_consented';
  }

  return 'not_consented';
}

/**
 * Boolean convenience wrapper around `checkConsentStatus`.
 *
 * Returns `true` iff the user may enter `stepId` — i.e.
 * `checkConsentStatus` returns `'all_consented'`.
 *
 * @param stepId       - The funnel step for which entry is being attempted.
 * @param checkedItems - The consent item IDs that the user has checked.
 * @returns `true` when all required consent items are checked.
 *
 * @example
 * ```ts
 * isConsentGatePassed('welcome_hook', [
 *   'terms_of_service',
 *   'privacy_policy',
 *   'age_verification',
 * ]); // → true
 *
 * isConsentGatePassed('welcome_hook', ['terms_of_service']); // → false
 * isConsentGatePassed('welcome_hook', []); // → false
 *
 * // Steps with no required consent always pass
 * isConsentGatePassed('payment_model', []); // → true
 * ```
 */
export function isConsentGatePassed(
  stepId: FunnelStepId,
  checkedItems: Iterable<ConsentItemId>,
): boolean {
  return checkConsentStatus(stepId, checkedItems) === 'all_consented';
}

/**
 * Returns the IDs of required consent items for `stepId` that are NOT present
 * in `checkedItems`.
 *
 * An empty array indicates that all required items are satisfied — equivalent
 * to `isConsentGatePassed` returning `true` for steps that have required items.
 *
 * This companion helper is useful for rendering granular validation messages
 * (e.g., "서비스 이용 약관에 동의해 주세요") next to individual checkboxes.
 *
 * @param stepId       - The funnel step to inspect.
 * @param checkedItems - The consent item IDs that the user has checked.
 * @returns Immutable (frozen) array of unchecked required item IDs.
 *
 * @example
 * ```ts
 * getUncheckedRequired('welcome_hook', ['terms_of_service']);
 * // → ['privacy_policy', 'age_verification']
 *
 * getUncheckedRequired('welcome_hook', [
 *   'terms_of_service',
 *   'privacy_policy',
 *   'age_verification',
 * ]);
 * // → []
 *
 * getUncheckedRequired('payment_model', []);
 * // → []  (no required items for this step)
 * ```
 */
export function getUncheckedRequired(
  stepId: FunnelStepId,
  checkedItems: Iterable<ConsentItemId>,
): readonly ConsentItemId[] {
  const { required } = STEP_CONSENT_REQUIREMENTS[stepId];

  if (required.length === 0) {
    return Object.freeze([]);
  }

  const checkedSet = new Set<ConsentItemId>(checkedItems);

  return Object.freeze(required.filter((item) => !checkedSet.has(item)));
}
