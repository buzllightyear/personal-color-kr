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
 *   2. `FunnelStateValue.onboarding` and `FunnelStateValue.diagnosisInput`
 *      are both `readonly` so consumers cannot mutate them in place (Seed
 *      constraint: "Context value types must be immutable readonly").
 *
 *   3. `setOnboarding` takes a partial update keyed on the same field names
 *      and returns `void`. The signature accepts a partial so a single field
 *      can be updated without re-sending unrelated answers, and the partial
 *      values are still constrained to the same union-or-null types so a
 *      caller cannot widen the domain with a free-text string.
 *
 *   4. `FunnelDiagnosisInput` is a `readonly` record holding the step-7
 *      diagnosis-input answers. Phase 2.3 ships with a single field —
 *      `selfieUri: string | null` — and a dedicated `setDiagnosisInput`
 *      updater symmetric to `setOnboarding`. The slice lives parallel to
 *      `onboarding` rather than nested inside it so future phases can add
 *      additional state slices following the same template.
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
// Diagnosis input record (step 7 — diagnosis_input)
// ---------------------------------------------------------------------------

/**
 * Immutable record of the diagnosis-input answers collected on step 7
 * (diagnosis_input). Phase 2.3 introduces a single field — `selfieUri` —
 * mirroring the shape pattern established for {@link FunnelOnboardingAnswers}
 * in Phase 2.2 so the two state slices stay structurally parallel.
 *
 * Phase 2.3 semantics:
 *   - `selfieUri` is `null` while the user has not yet "captured" a selfie.
 *   - First tap of the capture Pressable on step 7 stores a stub URI of the
 *     form `stub://selfie/<timestamp>` so the UI can flip to the "셀카
 *     등록됨" indicator state. No real image picker runs in Phase 2.3 —
 *     the actual `expo-image-picker` wiring is deferred to Phase 3.1 (the
 *     ban on `expo-image-picker` in this phase's constraint set codifies
 *     that boundary).
 *   - The Phase 3.1 swap to real device file URIs requires no contract
 *     change: `string` covers both `stub://...` and `file://...` URIs.
 *
 * Why `string | null` rather than `string | undefined`:
 *   The workspace enables `exactOptionalPropertyTypes: true` at the root
 *   `tsconfig.base.json`, which forbids passing an explicit `undefined`
 *   into an `?:`-marked field. Using `| null` with an always-present key
 *   keeps "not yet captured" representable without colliding with that
 *   rule, matching the precedent set by
 *   {@link FunnelOnboardingAnswers.selfieEditStyle} (Phase 2.2) and by
 *   `FunnelScreen.bodyCopy: string | null` in
 *   `packages/core-ts/src/funnel/screens.ts`.
 *
 * Why no PII concerns are violated:
 *   The Seed constraint "PII never in route params (PostHog context only)"
 *   is about route-param surfaces (expo-router `useLocalSearchParams`),
 *   not about in-memory React Context. `selfieUri` lives only inside the
 *   funnel-scoped `FunnelStateContext`, is never serialized, and never
 *   crosses the expo-router boundary — it stays in memory for the duration
 *   of the (funnel) layout subtree and is discarded when the user leaves
 *   the funnel.
 */
export type FunnelDiagnosisInput = {
  readonly selfieUri: string | null;
};

/**
 * Canonical "no selfie captured yet" value. Suitable as the React Context
 * default for the diagnosisInput slice and as the initial state for any
 * synthetic test provider. Frozen so a test that accidentally tries to
 * mutate it fails loud rather than corrupting other tests via shared
 * reference — same pattern as {@link INITIAL_FUNNEL_ONBOARDING_ANSWERS}.
 */
export const INITIAL_FUNNEL_DIAGNOSIS_INPUT: FunnelDiagnosisInput =
  Object.freeze({
    selfieUri: null,
  });

/**
 * Partial update accepted by `setDiagnosisInput`.
 *
 * Each field is optional (so a caller can update one input at a time) but
 * still constrained to the same `string | null` type declared above —
 * there is no escape hatch to other primitive shapes. Combined with
 * `exactOptionalPropertyTypes: true`, passing `{ selfieUri: undefined }`
 * is a *compile* error: callers must either omit the key or pass a valid
 * `string` value (or `null` to explicitly clear).
 */
export type FunnelDiagnosisInputPatch = {
  readonly [K in keyof FunnelDiagnosisInput]?: FunnelDiagnosisInput[K];
};

/**
 * Updater function injected through the React Context for the
 * diagnosisInput slice. Implementations MUST treat the previous
 * `diagnosisInput` value as immutable and return (via `setState`) a fresh
 * object that merges the patch — same contract as {@link SetOnboarding}.
 */
export type SetDiagnosisInput = (patch: FunnelDiagnosisInputPatch) => void;

// ---------------------------------------------------------------------------
// Referral slice (step 10 — referral_gate, Phase 2.4)
// ---------------------------------------------------------------------------

/**
 * Immutable record of the referral-gate state collected on step 10
 * (referral_gate). Phase 2.4 introduces a single boolean field —
 * `shared` — mirroring the shape pattern established for
 * {@link FunnelOnboardingAnswers} (Phase 2.2) and
 * {@link FunnelDiagnosisInput} (Phase 2.3) so the three state slices stay
 * structurally parallel.
 *
 * Phase 2.4 semantics:
 *   - `shared` is `false` until the user completes a share action
 *     (Kakao share, copy link) on the referral_gate screen.
 *   - First completion of a share action flips the flag to `true`. The
 *     social_evolution screen then branches off this flag — `shared===true`
 *     renders the empty-state ("나누어주셔서 감사합니다") branch while
 *     `shared===false` renders the upsell branch that links back to
 *     referral_gate.
 *   - No real Kakao SDK is wired in Phase 2.4 — share actions are
 *     console.log noop placeholders with TODO(phase-2.5) comments. The flag
 *     still flips so the downstream branch can be exercised end-to-end in
 *     unit tests.
 *
 * Why a boolean (not an enum):
 *   The Seed constraint set treats the referral_gate as a *soft* gate with
 *   a single binary outcome — either the user has completed any share
 *   action or they have not. Distinguishing "Kakao vs. link copy" is a
 *   Phase 2.5 analytics concern (PostHog event metadata), not a state-slice
 *   concern. Collapsing both into one boolean keeps the social_evolution
 *   branch logic trivially testable.
 *
 * Why no `referral_code` / PII fields:
 *   The Seed constraint "PII (referral_code, payment_token) must never
 *   appear in route params" extends conceptually to in-memory state in
 *   this phase — Phase 2.4 ships UI shells only, so no real referral code
 *   is generated client-side. When Phase 2.5 introduces a server-issued
 *   code, it will live in a new dedicated field on this slice and never
 *   cross the expo-router boundary.
 *
 * Why no `referral_skip_used` field:
 *   The ontology surfaces "referral_skip_used" as a tracked concept, but
 *   in Phase 2.4 the skip path is captured exclusively in the PostHog
 *   placeholder event (`referral_skipped`) — it does not need to be
 *   reflected back into UI branching on social_evolution, so the state
 *   slice intentionally tracks only the positive `shared` outcome. The
 *   sibling AC handling the skip event keeps the analytics surface
 *   separate from the state contract.
 */
export type FunnelReferral = {
  readonly shared: boolean;
};

/**
 * Canonical "no share performed yet" value. Suitable as the React Context
 * default for the referral slice and as the initial state for any
 * synthetic test provider. Frozen so a test that accidentally tries to
 * mutate it fails loud rather than corrupting other tests via shared
 * reference — same pattern as {@link INITIAL_FUNNEL_ONBOARDING_ANSWERS}
 * and {@link INITIAL_FUNNEL_DIAGNOSIS_INPUT}.
 */
export const INITIAL_FUNNEL_REFERRAL: FunnelReferral = Object.freeze({
  shared: false,
});

/**
 * Partial update accepted by `setReferral`.
 *
 * Each field is optional (so callers can update one flag at a time) but
 * still constrained to the same `boolean` type declared above. Combined
 * with `exactOptionalPropertyTypes: true`, passing `{ shared: undefined }`
 * is a *compile* error: callers must either omit the key or pass a valid
 * `boolean` value.
 */
export type FunnelReferralPatch = {
  readonly [K in keyof FunnelReferral]?: FunnelReferral[K];
};

/**
 * Updater function injected through the React Context for the referral
 * slice. Implementations MUST treat the previous `referral` value as
 * immutable and return (via `setState`) a fresh object that merges the
 * patch — same contract as {@link SetOnboarding} and
 * {@link SetDiagnosisInput}.
 */
export type SetReferral = (patch: FunnelReferralPatch) => void;

// ---------------------------------------------------------------------------
// Payment slice (step 12 — payment_model, Phase 2.4 / Sub-AC 15.1)
// ---------------------------------------------------------------------------

/**
 * Payment method selected by the user on `payment_model` (step 12).
 *
 * The two supported methods in Phase 2.4 are the placeholder shells for
 * KakaoPay and Toss — no real SDK calls happen in this phase (Seed
 * constraint: "payment simulated via console.log + 250ms setTimeout"). The
 * UI surfaces exactly these two options as radio choices on the
 * payment_model screen.
 *
 *   - `kakao` — KakaoPay placeholder.
 *   - `toss`  — Toss placeholder.
 *
 * No "other" / free-text branch exists. Phase 2.5 swaps the entire payment
 * slice for the Superwall subscription flow; keeping this union closed
 * keeps that migration surgical.
 */
export type PaymentMethod = 'kakao' | 'toss';

/**
 * Immutable record of the payment slice state (step 12 — payment_model).
 *
 * Phase 2.4 fields (Sub-AC 15.1):
 *   - `selectedMethod` — `null` while the user has not yet tapped a radio
 *     option, otherwise one of {@link PaymentMethod}.
 *   - `isProcessing`   — `true` only during the 250ms placeholder
 *     `setTimeout` that simulates an in-flight payment. The "결제하기"
 *     button reads this flag to gate double-taps so a single tap cannot
 *     fire two simulated payments.
 *   - `isPremium`      — `true` once the placeholder payment completes,
 *     gating the premium branch of `result_reveal`. Mutually exclusive
 *     with `isPreviewMode` (Seed constraint:
 *     "isPreviewMode and isPremium are mutually exclusive — premium entry
 *     invalidates preview branch").
 *
 * Why `readonly` end-to-end:
 *   Same rationale as the sibling slices ({@link FunnelOnboardingAnswers},
 *   {@link FunnelDiagnosisInput}, {@link FunnelReferral}): consumers must
 *   not mutate the slice in place. All updates flow through `setPayment`,
 *   which performs an immutable spread-merge symmetric to the existing
 *   slice updaters.
 *
 * Why `selectedMethod: PaymentMethod | null` rather than `| undefined`:
 *   `exactOptionalPropertyTypes: true` is enabled at the workspace root,
 *   which forbids passing `undefined` to an `?:`-marked field. Using
 *   `| null` with an always-present key keeps "no method selected yet"
 *   representable without colliding with that rule — matching every other
 *   nullable field in this contract.
 *
 * Why `isPremium` lives inside this slice (and not the route params):
 *   Seed constraint: "isPremium is managed solely in FunnelStateProvider
 *   payment slice, not route params". The `?premium=true` URL query is a
 *   navigation trigger only — the source of truth is this slice, so a
 *   reload mid-funnel cannot escalate the user out of the locked branch
 *   by URL hand-editing.
 */
export type FunnelPayment = {
  readonly selectedMethod: PaymentMethod | null;
  readonly isProcessing: boolean;
  readonly isPremium: boolean;
};

/**
 * Canonical "no payment activity yet" value. Suitable as the React Context
 * default for the payment slice and as the initial state for any synthetic
 * test provider. Frozen so a test that accidentally tries to mutate it
 * fails loud rather than corrupting other tests via shared reference —
 * same pattern as {@link INITIAL_FUNNEL_ONBOARDING_ANSWERS},
 * {@link INITIAL_FUNNEL_DIAGNOSIS_INPUT}, and {@link INITIAL_FUNNEL_REFERRAL}.
 *
 * Defaults (Sub-AC 15.1):
 *   - `selectedMethod: null`   — user has not yet tapped a radio option.
 *   - `isProcessing: false`    — no in-flight placeholder simulation.
 *   - `isPremium: false`       — premium content remains locked; the
 *     `result_reveal` premium branch stays closed.
 */
export const INITIAL_FUNNEL_PAYMENT: FunnelPayment = Object.freeze({
  selectedMethod: null,
  isProcessing: false,
  isPremium: false,
});

/**
 * Partial update accepted by `setPayment`.
 *
 * Each field is optional (so callers can update one field at a time) but
 * still constrained to the same domain declared on {@link FunnelPayment}.
 * Combined with `exactOptionalPropertyTypes: true`, passing
 * `{ isProcessing: undefined }` is a *compile* error: callers must either
 * omit the key or pass a valid value (`PaymentMethod | null` for
 * `selectedMethod`; `boolean` for the two flags).
 */
export type FunnelPaymentPatch = {
  readonly [K in keyof FunnelPayment]?: FunnelPayment[K];
};

/**
 * Updater function injected through the React Context for the payment
 * slice. Implementations MUST treat the previous `payment` value as
 * immutable and return (via `setState`) a fresh object that merges the
 * patch — same contract as {@link SetOnboarding},
 * {@link SetDiagnosisInput}, and {@link SetReferral}.
 */
export type SetPayment = (patch: FunnelPaymentPatch) => void;

/**
 * Dedicated updater for `payment.isProcessing` (Sub-AC 15.3).
 *
 * Why a single-argument boolean action sitting alongside the generic
 * {@link SetPayment} patch updater and the sibling
 * {@link SetSelectedPaymentMethod}:
 *   - The payment_model (step 12) "결제하기" CTA enters/exits a placeholder
 *     in-flight state (the 250ms `setTimeout` simulator). The two call sites
 *     are "user tapped pay → set processing true" and "timer fired → set
 *     processing false". A `setPaymentProcessing(true)` / `setPaymentProcessing(false)`
 *     reads as exactly the user / timer intent, with no risk of an unrelated
 *     payment-slice field being patched by mistake (which `setPayment({
 *     isProcessing: true })` cannot enforce at the type level).
 *   - It is intentionally NOT a wrapper around `setPayment(...)` at the type
 *     level — the argument is a `boolean` value, not a patch object — so
 *     callers cannot widen the call to also toggle `selectedMethod` or
 *     `isPremium` in the same action. Keeps the "in-flight flag" concern
 *     surgically isolated from method selection and premium unlock.
 *   - The implementation in `FunnelStateProvider` still routes through the
 *     same `useState` cell as `setPayment`, so the immutable-spread-merge
 *     invariant holds: the previous `payment` reference is never mutated in
 *     place, and a `setPaymentProcessing(...)` write leaves `selectedMethod`
 *     and `isPremium` untouched on the resulting snapshot.
 *
 * Domain constraint: the argument is exactly `boolean`. Passing `undefined`
 * is a compile error (`exactOptionalPropertyTypes: true` is on) — callers
 * must spell `true` or `false` explicitly. Pre-Phase-2.5 the only two
 * legitimate transitions are `false → true` (user tapped pay) and
 * `true → false` (placeholder timer fired or unmount-cleanup ran).
 */
export type SetPaymentProcessing = (isProcessing: boolean) => void;

/**
 * Dedicated updater for `payment.isPremium` (Sub-AC 15.4).
 *
 * Why a single-argument boolean action sitting alongside the generic
 * {@link SetPayment} patch updater and the sibling
 * {@link SetSelectedPaymentMethod} / {@link SetPaymentProcessing}:
 *   - The payment_model (step 12) placeholder payment flow concludes by
 *     flipping the premium gate. The single legitimate call site in Phase
 *     2.4 is "placeholder payment simulator resolved successfully → set
 *     premium true" — invoked exactly once right before the post-payment
 *     `router.replace('/(funnel)/result-reveal?premium=true')` navigation
 *     that re-enters `result_reveal` on the unlocked branch. A
 *     `setIsPremium(true)` call site reads as exactly the user-visible
 *     outcome (premium unlocked), with no risk of an unrelated payment-slice
 *     field being patched by mistake.
 *   - It is intentionally NOT a wrapper around `setPayment(...)` at the type
 *     level — the argument is a `boolean` value, not a patch object — so
 *     callers cannot widen the call to also toggle `selectedMethod` or
 *     `isProcessing` in the same action. Keeps the "premium unlock" concern
 *     surgically isolated from the rest of the payment-flow state machine.
 *   - The implementation in `FunnelStateProvider` still routes through the
 *     same `useState` cell as `setPayment`, so the immutable-spread-merge
 *     invariant holds: the previous `payment` reference is never mutated in
 *     place, and a `setIsPremium(...)` write leaves `selectedMethod` and
 *     `isProcessing` untouched on the resulting snapshot.
 *   - Stable identity via `useCallback([])` so consumers can list it in
 *     `useEffect` dependency arrays without spurious re-runs.
 *
 * Domain constraint: the argument is exactly `boolean`. Passing `undefined`
 * is a compile error (`exactOptionalPropertyTypes: true` is on) — callers
 * must spell `true` or `false` explicitly. In Phase 2.4 the only legitimate
 * transition is `false → true` (placeholder payment simulator resolved); the
 * `true → false` downgrade path is reserved for Phase 2.5 (subscription
 * cancellation / refund flow) and intentionally has no UI surface yet, but
 * the symmetric setter is exposed here so the slice contract stays
 * future-proof without a follow-up breaking change.
 *
 * Why this is mutually exclusive with `isPreviewMode`:
 *   The Seed constraint "isPreviewMode and isPremium are mutually exclusive
 *   — premium entry invalidates preview branch" is enforced at the
 *   result_reveal render site, not at this action's call site. This action
 *   only flips the slice flag — the route-level branching reads
 *   `isPreviewMode` (route param) and `isPremium` (this slice) together and
 *   prefers the premium branch when both happen to be `true`. The
 *   mutual-exclusion guarantee therefore lives at the consumer boundary, not
 *   inside this setter.
 */
export type SetIsPremium = (isPremium: boolean) => void;

/**
 * Dedicated updater for `payment.selectedMethod` (Sub-AC 15.2).
 *
 * Why a single-argument action sitting alongside the generic
 * {@link SetPayment} patch updater:
 *   - The payment_model (step 12) radio-selection UI binds each option to
 *     exactly this concept — "user tapped Kakao" or "user tapped Toss" or
 *     "selection cleared". A `setSelectedPaymentMethod('kakao')` call site
 *     reads as exactly the user intent, with no risk of an unrelated
 *     payment-slice field being patched by mistake (which `setPayment({
 *     selectedMethod: 'kakao' })` cannot enforce at the type level).
 *   - It is intentionally NOT a wrapper around `setPayment(...)` at the type
 *     level — the argument is a `PaymentMethod | null` value, not a patch
 *     object — so callers cannot widen the signature to also toggle
 *     `isProcessing` or `isPremium` in the same call. This keeps the
 *     "method selection" concern surgically isolated from the payment-flow
 *     state machine (`isProcessing`, `isPremium`).
 *   - The implementation in `FunnelStateProvider` still routes through the
 *     same `useState` cell as `setPayment`, so the immutable-spread-merge
 *     invariant holds: the previous `payment` reference is never mutated
 *     in place, and a `setSelectedPaymentMethod(...)` write leaves
 *     `isProcessing` and `isPremium` untouched on the resulting snapshot.
 *
 * Domain constraint: the argument is exactly `PaymentMethod | null`. Passing
 * `undefined` is a compile error (`exactOptionalPropertyTypes: true` is on)
 * — callers must spell `null` to explicitly clear the selection.
 */
export type SetSelectedPaymentMethod = (
  method: PaymentMethod | null,
) => void;

// ---------------------------------------------------------------------------
// Public context value
// ---------------------------------------------------------------------------

/**
 * Full value carried by the React Context that wraps `app/(funnel)/_layout.tsx`.
 *
 * All fields are `readonly`:
 *   - `onboarding` is the immutable current snapshot of the step-3
 *     onboarding answers (Phase 2.2).
 *   - `setOnboarding` is the updater handle exposed to step-3 write sites
 *     (currently only `onboarding_priming`).
 *   - `diagnosisInput` is the immutable current snapshot of the step-7
 *     diagnosis-input answers (Phase 2.3) — currently a single `selfieUri`
 *     field that captures whether the user has tapped the stub capture
 *     control on `diagnosis_input`.
 *   - `setDiagnosisInput` is the updater handle exposed to step-7 write
 *     sites (currently only `diagnosis_input`).
 *
 * The two state slices (`onboarding` / `diagnosisInput`) are deliberately
 * kept structurally parallel — each has its own immutable record type, its
 * own `INITIAL_*` frozen constant, and its own dedicated patch-shaped
 * updater. This keeps the provider's `useState` wiring symmetric and lets
 * future phases add additional slices (e.g. `payment`, `magazine`) by
 * following the same template without needing to refactor either existing
 * slice.
 *
 * The `readonly` on `setOnboarding` and `setDiagnosisInput` prevents a
 * consumer from doing `value.setOnboarding = noop` and silently disabling
 * the writes — the function references themselves are fixed for the
 * lifetime of the provider.
 */
export type FunnelStateValue = {
  readonly onboarding: FunnelOnboardingAnswers;
  readonly setOnboarding: SetOnboarding;
  readonly diagnosisInput: FunnelDiagnosisInput;
  readonly setDiagnosisInput: SetDiagnosisInput;
  readonly referral: FunnelReferral;
  readonly setReferral: SetReferral;
  readonly payment: FunnelPayment;
  readonly setPayment: SetPayment;
  /**
   * Dedicated action that sets `payment.selectedMethod` (Sub-AC 15.2). Lives
   * alongside the generic {@link setPayment} patch updater so the
   * radio-selection UI on payment_model has a single-purpose write site that
   * cannot accidentally touch the other payment-flow flags
   * (`isProcessing`, `isPremium`).
   */
  readonly setSelectedPaymentMethod: SetSelectedPaymentMethod;
  /**
   * Dedicated action that sets `payment.isProcessing` (Sub-AC 15.3). Lives
   * alongside the generic {@link setPayment} patch updater so the
   * "결제하기" CTA + placeholder 250ms `setTimeout` flow on payment_model
   * has a single-purpose write site that cannot accidentally touch the
   * other payment-flow fields (`selectedMethod`, `isPremium`). The action
   * is invoked at exactly two call sites in Phase 2.4: `(true)` when the
   * primary CTA is tapped (entering the simulated in-flight state) and
   * `(false)` when the timer fires or the screen unmounts before the timer
   * resolves (cleanup).
   */
  readonly setPaymentProcessing: SetPaymentProcessing;
  /**
   * Dedicated action that sets `payment.isPremium` (Sub-AC 15.4). Lives
   * alongside the generic {@link setPayment} patch updater so the
   * placeholder payment completion flow on payment_model has a
   * single-purpose write site that cannot accidentally touch the other
   * payment-flow fields (`selectedMethod`, `isProcessing`). The action is
   * invoked at exactly one call site in Phase 2.4: immediately after the
   * 250ms placeholder timer resolves successfully, just before the
   * `router.replace('/(funnel)/result-reveal?premium=true')` navigation
   * that re-enters `result_reveal` on the unlocked branch.
   */
  readonly setIsPremium: SetIsPremium;
};
