/**
 * FunnelStateValue — typed contract for the in-app funnel React Context.
 *
 * This module defines the immutable shape of the value carried by the
 * `FunnelStateContext` that lives at `app/(funnel)/_layout.tsx` (per the Seed
 * constraint "FunnelStateContext scoped to (funnel)/_layout.tsx — not root
 * layout"). It intentionally contains *only* type declarations — no React
 * runtime — so it can be:
 *
 *   - Imported by the context provider (sibling sub-AC) without a circular
 *     dependency between the providers/ and contracts/ folders.
 *   - Imported by individual funnel screen components (welcome_hook,
 *     value_props, onboarding_priming, rating_gate, fake_loader) for their
 *     props typing without dragging in any React or `react-native` symbols.
 *   - Imported by props-based unit tests (vitest + react-test-renderer)
 *     where the context is provided synthetically rather than mounted.
 *
 * Seed-derived invariants enforced by this contract (verified by the
 * `funnel-state-contract.test.ts` type-level companion test):
 *
 *   1. `FunnelOnboardingAnswers` is a `readonly` record with exactly two
 *      string-literal-union-or-`null` fields:
 *        - `selfieEditStyle: SelfieEditStyle | null`
 *        - `priorDiagnosis: PriorDiagnosis | null`
 *      No free-text fields are allowed (Seed constraint:
 *      "onboarding answers are string literal union types only — no free
 *      text input").
 *
 *   2. `FunnelStateValue.onboarding` is `readonly` so consumers cannot mutate
 *      it in place (Seed constraint: "Context value types must be immutable
 *      readonly").
 *
 *   3. `setOnboarding` takes a partial update keyed on the same field names
 *      and returns `void`. The signature accepts a partial so a single field
 *      can be updated without re-sending unrelated answers, and the partial
 *      values are still constrained to the same union-or-null types so a
 *      caller cannot widen the domain with a free-text string.
 *
 * Why string literal unions (and why `null` rather than `undefined`):
 *   - `exactOptionalPropertyTypes: true` is enabled at the workspace root
 *     (`tsconfig.base.json`), which forbids passing an explicit `undefined`
 *     to an `?:`-marked field. Using `| null` with always-present keys keeps
 *     "unanswered" representable without bumping into that rule and matches
 *     the precedent set by `FunnelScreen.bodyCopy: string | null` in
 *     `packages/core-ts/src/funnel/screens.ts`.
 *   - String literal unions are exhaustive at compile time so the segmented-
 *     control UI in onboarding_priming and any downstream analytics
 *     consumer can `switch` over them without an `unknown`/`string`
 *     fallback branch.
 *
 * No runtime exports: this file is *type-only*. A separate provider file
 * (created in a subsequent sub-AC) instantiates `React.createContext` using
 * `FunnelStateValue` as the generic parameter.
 */

// ---------------------------------------------------------------------------
// Domain string-literal unions for the two onboarding questions
// (step 3 — onboarding_priming).
// ---------------------------------------------------------------------------

/**
 * How the user typically edits selfies before posting.
 *
 * Drives the consistency-lever priming on step 3 — the user "declares" their
 * editing style so the funnel can mirror it back in later copy ("당신처럼
 * 자연스러운 편집을 선호하는 분들께…"). All three options must be present
 * in the segmented-control UI so the user always has a non-null choice.
 *
 *   - `natural`     — 보정 거의 없이 자연스럽게
 *   - `subtle`      — 가벼운 보정 (피부 톤 정도)
 *   - `expressive`  — 적극적인 편집 (필터·preset 활용)
 *
 * No `other` / free-text escape hatch by design (Seed constraint).
 */
export type SelfieEditStyle = 'natural' | 'subtle' | 'expressive';

/**
 * Whether the user has previously gone through a personal-color diagnosis.
 *
 * Used to (a) calibrate the language of later steps (don't over-explain
 * categories to a returning user) and (b) split conversion analytics so the
 * "first-time" vs. "returning" cohorts can be inspected separately. As with
 * `SelfieEditStyle`, the three options are fixed string literals — no free-
 * text "other" branch.
 *
 *   - `never`         — 진단 받아본 적 없음
 *   - `self_test`     — 직접 셀프 테스트만 해봤음
 *   - `professional`  — 전문가 진단을 받아봤음
 */
export type PriorDiagnosis = 'never' | 'self_test' | 'professional';

// ---------------------------------------------------------------------------
// Onboarding answer record (step 3 priming output)
// ---------------------------------------------------------------------------

/**
 * Immutable record of the two onboarding answers collected on step 3.
 *
 * Both fields default to `null` (the user has not yet answered) and become
 * non-null after the user selects an option in the corresponding segmented
 * control. The record is `readonly` end-to-end so downstream consumers
 * cannot reassign individual fields without going through `setOnboarding`,
 * which returns a brand-new object (immutable update — see the companion
 * provider sub-AC).
 *
 * The shape is deliberately closed: the only valid keys are
 * `selfieEditStyle` and `priorDiagnosis`. Adding a third onboarding answer
 * is a breaking change to this contract and requires updating the
 * accompanying type-level test in `funnel-state-contract.test.ts`.
 */
export type FunnelOnboardingAnswers = {
  readonly selfieEditStyle: SelfieEditStyle | null;
  readonly priorDiagnosis: PriorDiagnosis | null;
};

/**
 * Canonical "no answers yet" value. Suitable as the React Context default
 * and as the initial state for any synthetic test provider. Frozen so a
 * test that accidentally tries to mutate it fails loud rather than
 * corrupting other tests via shared reference.
 *
 * Exposed as a `const` (not a function) because the value is fully
 * immutable — every consumer can share the same reference safely.
 */
export const INITIAL_FUNNEL_ONBOARDING_ANSWERS: FunnelOnboardingAnswers =
  Object.freeze({
    selfieEditStyle: null,
    priorDiagnosis: null,
  });

// ---------------------------------------------------------------------------
// Updater signature
// ---------------------------------------------------------------------------

/**
 * Partial update accepted by `setOnboarding`.
 *
 * Each field is optional (so a caller can update one answer at a time) but
 * still constrained to the same union-or-null types declared above — there
 * is no escape hatch to a free-text string. Combined with
 * `exactOptionalPropertyTypes: true`, passing `{ selfieEditStyle: undefined }`
 * is a *compile* error: callers must either omit the key or pass a valid
 * union value (or `null` to explicitly clear).
 */
export type FunnelOnboardingPatch = {
  readonly [K in keyof FunnelOnboardingAnswers]?: FunnelOnboardingAnswers[K];
};

/**
 * Updater function injected through the React Context. Implementations
 * MUST treat the previous `onboarding` value as immutable and return (via
 * `setState`) a fresh object that merges the patch — see the provider
 * sub-AC for the canonical implementation.
 */
export type SetOnboarding = (patch: FunnelOnboardingPatch) => void;

// ---------------------------------------------------------------------------
// Public context value
// ---------------------------------------------------------------------------

/**
 * Full value carried by the React Context that wraps `app/(funnel)/_layout.tsx`.
 *
 * Both fields are `readonly`:
 *   - `onboarding` is the immutable current snapshot of the two answers.
 *   - `setOnboarding` is the updater handle exposed to write sites
 *     (currently only `onboarding_priming`).
 *
 * The `readonly` on `setOnboarding` prevents a consumer from doing
 * `value.setOnboarding = noop` and silently disabling the writes — the
 * function reference itself is fixed for the lifetime of the provider.
 */
export type FunnelStateValue = {
  readonly onboarding: FunnelOnboardingAnswers;
  readonly setOnboarding: SetOnboarding;
};
