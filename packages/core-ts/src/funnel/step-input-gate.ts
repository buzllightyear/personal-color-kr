/**
 * step-input-gate.ts — Required input satisfaction gate function (Sub-AC 3-1).
 *
 * Pure function: given a funnel step ID and the current user-provided field
 * values, returns whether all fields required by that step are present and have
 * valid runtime types.
 *
 * ## Step → required fields mapping (v0.2 funnel, 12 steps)
 *
 *   | Step                  | Required fields                              |
 *   | --------------------- | -------------------------------------------- |
 *   | welcome_hook          | (none)                                       |
 *   | value_props           | (none)                                       |
 *   | onboarding_priming    | selfieEditStyle + priorDiagnosis             |
 *   | rating_gate           | (none — dismissable iOS native dialog)       |
 *   | fake_loader           | (none — auto-advance timer)                  |
 *   | scan_option_select    | (none — selection drives navigation)         |
 *   | diagnosis_input       | selfieUri (non-empty string)                 |
 *   | fake_scan_animation   | (none — auto-advance timer)                  |
 *   | result_reveal         | (none — view only)                           |
 *   | referral_gate         | (none — share/skip drives navigation)        |
 *   | social_evolution      | (none — view only)                           |
 *   | payment_model         | (none — Superwall paywall drives checkout)   |
 *
 * ## Type-mismatch behaviour
 *
 * `isStepInputSatisfied` returns `false` (not satisfied) when a required
 * field is present but has an unexpected runtime type (e.g. `selfieUri: 42`).
 * It does NOT throw for type mismatches — the gate answers "can the user
 * proceed?" and an invalid type means "no", not "error".
 *
 * ## Design choices
 *
 * - `StepInputs.selfieEditStyle` and `priorDiagnosis` are `unknown` so
 *   callers can pass data from AsyncStorage / network without a cast.
 *   The function validates both type and domain membership internally.
 * - The `STEP_REQUIREMENTS` map is typed as `Record<FunnelStepId, …>`,
 *   which forces exhaustive coverage at compile time: adding a new step to
 *   `FunnelStepId` without updating `STEP_REQUIREMENTS` is a TypeScript
 *   error, not a silent bug.
 * - `getMissingFields` is a sibling helper that returns the names of
 *   unsatisfied fields — useful for user-facing validation messages.
 */

import type { FunnelStepId } from './types.js';

// ---------------------------------------------------------------------------
// Domain constants — canonical valid values for string-union fields
// ---------------------------------------------------------------------------

/**
 * Canonical valid values for the "selfie editing style" onboarding question
 * (step 3 — `onboarding_priming`).
 *
 *   - `'natural'`     — 보정 거의 없이 자연스럽게
 *   - `'subtle'`      — 가벼운 보정 (피부 톤 정도)
 *   - `'expressive'`  — 적극적인 편집 (필터·preset 활용)
 */
export const SELFIE_EDIT_STYLE_VALUES = ['natural', 'subtle', 'expressive'] as const;

/** String-literal union for the selfie editing style question. */
export type SelfieEditStyle = (typeof SELFIE_EDIT_STYLE_VALUES)[number];

/**
 * Canonical valid values for the "prior personal-color diagnosis" onboarding
 * question (step 3 — `onboarding_priming`).
 *
 *   - `'never'`         — 진단 받아본 적 없음
 *   - `'self_test'`     — 직접 셀프 테스트만 해봤음
 *   - `'professional'`  — 전문가 진단을 받아봤음
 */
export const PRIOR_DIAGNOSIS_VALUES = ['never', 'self_test', 'professional'] as const;

/** String-literal union for the prior-diagnosis question. */
export type PriorDiagnosis = (typeof PRIOR_DIAGNOSIS_VALUES)[number];

// ---------------------------------------------------------------------------
// Input bag type
// ---------------------------------------------------------------------------

/**
 * Flat bag of all field values that funnel steps may require.
 *
 * All values are typed `unknown` so callers can pass data from AsyncStorage,
 * network responses, or user input without a cast at the call site — the gate
 * function validates both type and domain membership internally.
 *
 * Fields are optional: a caller only needs to provide fields relevant to the
 * step being checked. A missing field (`undefined`) is equivalent to `null`
 * — both mean "not yet provided by the user".
 */
export interface StepInputs {
  /** Step 3 (`onboarding_priming`): which editing style the user declared. */
  readonly selfieEditStyle?: unknown;
  /** Step 3 (`onboarding_priming`): whether the user has had a prior diagnosis. */
  readonly priorDiagnosis?: unknown;
  /** Step 7 (`diagnosis_input`): URI of the uploaded selfie photo. */
  readonly selfieUri?: unknown;
}

// ---------------------------------------------------------------------------
// Internal field-validator types and helpers
// ---------------------------------------------------------------------------

/** A predicate that returns `true` iff the runtime value is acceptable. */
type FieldValidator = (value: unknown) => boolean;

interface FieldRequirement {
  readonly name: keyof StepInputs;
  readonly validator: FieldValidator;
}

interface StepRequirement {
  readonly fields: readonly FieldRequirement[];
}

/**
 * Returns `true` iff `value` is a valid `SelfieEditStyle` string literal.
 * `null`, `undefined`, numbers, objects → `false`.
 */
function isSelfieEditStyle(value: unknown): value is SelfieEditStyle {
  return (
    typeof value === 'string' &&
    (SELFIE_EDIT_STYLE_VALUES as readonly string[]).includes(value)
  );
}

/**
 * Returns `true` iff `value` is a valid `PriorDiagnosis` string literal.
 * `null`, `undefined`, numbers, objects → `false`.
 */
function isPriorDiagnosis(value: unknown): value is PriorDiagnosis {
  return (
    typeof value === 'string' &&
    (PRIOR_DIAGNOSIS_VALUES as readonly string[]).includes(value)
  );
}

/**
 * Returns `true` iff `value` is a non-empty string.
 * `null`, `undefined`, `''`, numbers, objects → `false`.
 */
function isNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0;
}

// ---------------------------------------------------------------------------
// Per-step requirement definitions — exhaustive over all 12 FunnelStepId values
// ---------------------------------------------------------------------------

/**
 * Closed, exhaustive map from every `FunnelStepId` to its required-fields
 * contract.  Typed as `Record<FunnelStepId, StepRequirement>` so TypeScript
 * will refuse to compile if a step is added to `FunnelStepId` without being
 * represented here.
 *
 * Steps whose `fields` array is empty are unconditionally satisfied — the gate
 * function returns `true` regardless of what the caller passes for those steps.
 */
const STEP_REQUIREMENTS: Readonly<Record<FunnelStepId, StepRequirement>> = {
  // Step 1 — view-only hook; no user input required
  welcome_hook: { fields: [] },

  // Step 2 — value proposition; no user input required
  value_props: { fields: [] },

  // Step 3 — onboarding priming: 2 choices required before "계속" CTA unlocks
  onboarding_priming: {
    fields: [
      { name: 'selfieEditStyle', validator: isSelfieEditStyle },
      { name: 'priorDiagnosis', validator: isPriorDiagnosis },
    ],
  },

  // Step 4 — iOS native rating dialog; dismissable, no required input
  rating_gate: { fields: [] },

  // Step 5 — fake loader (5 s auto-advance timer); no user input
  fake_loader: { fields: [] },

  // Step 6 — scan-option selection; tapping an option drives navigation directly
  scan_option_select: { fields: [] },

  // Step 7 — selfie upload: URI must be present and non-empty before advancing
  diagnosis_input: {
    fields: [{ name: 'selfieUri', validator: isNonEmptyString }],
  },

  // Step 8 — fake scan animation (auto-advance timer); no user input
  fake_scan_animation: { fields: [] },

  // Step 9 — result reveal (locked tease); no user input
  result_reveal: { fields: [] },

  // Step 10 (KR variant) — referral gate; share/skip drives navigation
  referral_gate: { fields: [] },

  // Step 11 (KR variant) — social evolution; view + navigate
  social_evolution: { fields: [] },

  // Step 12 (KR variant) — payment model; Superwall paywall drives checkout
  payment_model: { fields: [] },
} as const;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Pure gate function — returns `true` iff all required fields for `stepId`
 * are present in `inputs` and pass their domain validators.
 *
 * Steps with no required fields always return `true` (unconditionally
 * satisfied).  Passing extra fields that a step does not require is silently
 * ignored.
 *
 * @param stepId - The funnel step to gate.
 * @param inputs - Current user-provided field values (partial; `unknown`-typed
 *   fields allow runtime type checking without a cast at the call site).
 * @returns `true` if every required field passes its validator.
 *
 * @example
 * ```ts
 * // Step 3 — both onboarding choices answered
 * isStepInputSatisfied('onboarding_priming', {
 *   selfieEditStyle: 'natural',
 *   priorDiagnosis: 'never',
 * }); // → true
 *
 * // Step 3 — one choice missing
 * isStepInputSatisfied('onboarding_priming', {
 *   selfieEditStyle: 'natural',
 * }); // → false
 *
 * // Step 7 — selfie uploaded
 * isStepInputSatisfied('diagnosis_input', {
 *   selfieUri: 'file:///path/to/selfie.jpg',
 * }); // → true
 *
 * // Type mismatch — selfieUri is a number instead of a string
 * isStepInputSatisfied('diagnosis_input', {
 *   selfieUri: 42,
 * }); // → false
 * ```
 */
export function isStepInputSatisfied(
  stepId: FunnelStepId,
  inputs: StepInputs,
): boolean {
  const requirement = STEP_REQUIREMENTS[stepId];

  for (const field of requirement.fields) {
    const value: unknown = (inputs as Record<string, unknown>)[field.name];
    if (!field.validator(value)) {
      return false;
    }
  }

  return true;
}

/**
 * Returns the names of required fields for `stepId` that are NOT satisfied
 * by `inputs` (either missing or failing their domain validator).
 *
 * An empty array indicates the step is fully satisfied (same as
 * `isStepInputSatisfied` returning `true`).
 *
 * This companion helper is useful for generating user-facing validation
 * messages (e.g. "사진을 업로드해 주세요").
 *
 * @param stepId - The funnel step to inspect.
 * @param inputs - Current user-provided field values.
 * @returns Immutable array of unsatisfied field names. Empty when all required
 *   fields pass their validators.
 *
 * @example
 * ```ts
 * getMissingFields('onboarding_priming', { selfieEditStyle: 'subtle' });
 * // → ['priorDiagnosis']
 *
 * getMissingFields('diagnosis_input', { selfieUri: '' });
 * // → ['selfieUri']   (empty string fails the non-empty check)
 *
 * getMissingFields('welcome_hook', {});
 * // → []   (no required fields)
 * ```
 */
export function getMissingFields(
  stepId: FunnelStepId,
  inputs: StepInputs,
): readonly string[] {
  const requirement = STEP_REQUIREMENTS[stepId];

  return Object.freeze(
    requirement.fields
      .filter((field) => {
        const value: unknown = (inputs as Record<string, unknown>)[field.name];
        return !field.validator(value);
      })
      .map((field) => field.name),
  );
}
