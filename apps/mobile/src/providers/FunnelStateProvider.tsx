/**
 * `FunnelStateProvider` — React Context provider for the personal-color-kr
 * funnel screens (steps 1–5 in MVP, expanded in later phases).
 *
 * Sub-AC 7.2 responsibilities (Phase 2.2) — onboarding slice:
 *   1. Expose a `FunnelStateContext` keyed on the typed contract from
 *      `src/contracts/funnel-state.ts` (`FunnelStateValue`). All consumers
 *      read this same Context via the `useFunnelState()` hook so there is a
 *      single source of truth for the in-flight funnel state.
 *   2. Initialise the onboarding answers to the canonical "no answers yet"
 *      sentinel from the contract module
 *      (`INITIAL_FUNNEL_ONBOARDING_ANSWERS`), in which both
 *      `selfieEditStyle` and `priorDiagnosis` are `null`. This guarantees
 *      consumers can render a default UI before the user touches the
 *      segmented controls on step 3 (onboarding_priming).
 *   3. Provide a `setOnboarding(patch)` updater that performs an
 *      **immutable partial merge** of the patch onto the previous answers.
 *      The previous state is never mutated in place — `useState`'s functional
 *      updater always returns a brand-new object so React's reference-equality
 *      check can detect the change and re-render downstream consumers.
 *
 * Phase 2.3 responsibilities — diagnosisInput slice (new):
 *   4. Maintain a parallel `useState` cell for the `diagnosisInput`
 *      contract slice, seeded from `INITIAL_FUNNEL_DIAGNOSIS_INPUT` so
 *      `selfieUri` is `null` before the user taps the step-7 capture
 *      Pressable.
 *   5. Provide a `setDiagnosisInput(patch)` updater symmetric to
 *      `setOnboarding`, using the same immutable spread-merge so the
 *      previous snapshot is never mutated in place.
 *   6. Keep the two slices on independent `useState` cells (not nested in
 *      one object) so a write to one slice does not invalidate the
 *      reference identity of the other — consumers that only subscribe to
 *      one slice will not re-render on writes to the other.
 *
 * Scoping (Seed constraint):
 *   This provider is intended to be mounted at `app/(funnel)/_layout.tsx`,
 *   NOT at the root layout. Scoping the Context to the funnel group means
 *   the post-payment surface (and the magazine reader) do not pay the cost
 *   of subscribing to funnel-only state, and the persisted onboarding
 *   answers cannot leak past the funnel boundary by accident. The companion
 *   wiring sub-AC plugs `<FunnelStateProvider>` into the layout file; this
 *   module only owns the provider implementation.
 *
 * Why a `useMemo` for the context value:
 *   `React.createContext` notifies all consumers whenever the value's
 *   *reference identity* changes. If we returned a brand-new object literal
 *   on every render of the provider, every consumer would re-render even
 *   when nothing changed. Wrapping in `useMemo` keyed on `[onboarding,
 *   setOnboarding]` means the value reference is stable across renders
 *   unless one of the two members actually changes — exactly the React
 *   "stable context value" pattern.
 *
 * Why an immutable spread-merge (not Object.assign on prev):
 *   The Seed constraint "Context value types must be immutable readonly"
 *   plus the contract module's `readonly` modifiers on
 *   `FunnelOnboardingAnswers` rule out in-place mutation. `setOnboarding`
 *   builds a fresh `{ ...prev, ...patch }` object so any downstream consumer
 *   that captured `prev` keeps seeing the old answers — there is no shared
 *   reference whose fields can drift.
 *
 * Why `React.createElement` instead of JSX literals:
 *   The PostHogProvider sibling uses the same convention (see its file-level
 *   docblock). It compiles identically under both classic and automatic JSX
 *   runtimes, so vitest's esbuild transform and Expo Metro agree on the
 *   output with no per-environment tuning.
 *
 * Test isolation:
 *   The provider is pure React state — no module-level singletons, no
 *   network, no AsyncStorage. Each `<FunnelStateProvider>` mount owns its
 *   own `useState` instance, so unit tests can mount/unmount freely without
 *   leaking state between cases. The companion unit test
 *   (`tests/funnel-state-context.test.tsx`) verifies this end-to-end.
 *
 * Out of scope (deferred to later phases):
 *   - AsyncStorage persistence of onboarding answers (Phase 3).
 *   - Reading initial answers from a deep-link (Phase 3 — share/referral).
 *   - Coordinating with a server-side analytics replay (Phase 4).
 */
import * as React from 'react';

import {
  INITIAL_FUNNEL_DIAGNOSIS_INPUT,
  INITIAL_FUNNEL_ONBOARDING_ANSWERS,
  INITIAL_FUNNEL_PAYMENT,
  INITIAL_FUNNEL_REFERRAL,
  type FunnelDiagnosisInput,
  type FunnelDiagnosisInputPatch,
  type FunnelOnboardingAnswers,
  type FunnelOnboardingPatch,
  type FunnelPayment,
  type FunnelPaymentPatch,
  type FunnelReferral,
  type FunnelReferralPatch,
  type FunnelStateValue,
  type PaymentMethod,
  type SetDiagnosisInput,
  type SetIsPremium,
  type SetOnboarding,
  type SetPayment,
  type SetPaymentProcessing,
  type SetReferral,
  type SetSelectedPaymentMethod,
} from '../contracts/funnel-state';

// ---------------------------------------------------------------------------
// Context default value
//
// The Context default is the sentinel `undefined`. The strict
// `useFunnelState` hook (Sub-AC 7.3, see `../hooks/use-funnel-state.ts`)
// detects this sentinel and throws a `FunnelStateProviderMissingError`,
// per the Seed constraint "fail-loud guard stubs maintained". A funnel
// screen mounted without the `(funnel)/_layout.tsx` wrapper is a
// programming bug; surfacing it as a thrown error during render lets the
// developer fix the missing wrapper instead of seeing silently-discarded
// `setOnboarding(...)` writes.
//
// `undefined` (not a placeholder `FunnelStateValue` object) is the canonical
// React pattern for "no provider above me": the provider's `useMemo(...)`
// always supplies a real bundle, so any time `useContext` returns
// `undefined` we are unambiguously outside the provider's subtree.
// ---------------------------------------------------------------------------

/**
 * React Context carrying the {@link FunnelStateValue} bundle (current
 * onboarding answers + immutable updater). Mounted by
 * {@link FunnelStateProvider} at the funnel group layout boundary so every
 * screen under `app/(funnel)/` shares one source of truth.
 *
 * Exposed for advanced cases (e.g. a future `<FunnelStateContext.Consumer>`
 * pattern in a class component); product code SHOULD prefer the
 * `useFunnelState` hook (re-exported below from `../hooks/use-funnel-state`)
 * for type-safe reads that fail loud when the provider is missing.
 */
export const FunnelStateContext: React.Context<FunnelStateValue | undefined> =
  React.createContext<FunnelStateValue | undefined>(undefined);

// DevTools label so the Context shows up as "FunnelState" rather than
// "Context.Provider" in React DevTools / inspector overlays.
FunnelStateContext.displayName = 'FunnelStateContext';

/**
 * Props for {@link FunnelStateProvider}.
 *
 * `initialOnboarding` is an escape hatch primarily for unit tests that want
 * to spin up the provider in a non-default state (e.g. "user already chose
 * `natural` for selfieEditStyle — re-render onboarding_priming and verify
 * the button reflects the selection"). Production code never passes this
 * prop; the provider starts every funnel session from
 * `INITIAL_FUNNEL_ONBOARDING_ANSWERS`.
 *
 * The prop is `readonly` to match the rest of the contract.
 */
export interface FunnelStateProviderProps {
  readonly children: React.ReactNode;
  /**
   * Optional seed value for the onboarding answers. When omitted (the
   * production path), the provider initialises with
   * `INITIAL_FUNNEL_ONBOARDING_ANSWERS` so both answers are `null`.
   */
  readonly initialOnboarding?: FunnelOnboardingAnswers;
  /**
   * Optional seed value for the diagnosis-input slice (Phase 2.3 / step 7).
   * When omitted (the production path), the provider initialises with
   * `INITIAL_FUNNEL_DIAGNOSIS_INPUT` so `selfieUri` is `null`. Tests use
   * this prop to spin up the provider with a pre-captured selfie URI so
   * `result_reveal` rendering can be exercised without simulating the
   * step-7 tap sequence first.
   */
  readonly initialDiagnosisInput?: FunnelDiagnosisInput;
  /**
   * Optional seed value for the referral slice (Phase 2.4 / step 10).
   * When omitted (the production path), the provider initialises with
   * `INITIAL_FUNNEL_REFERRAL` so `shared` is `false`. Tests use this prop
   * to spin up the provider with `shared: true` so the `social_evolution`
   * (step 11) shared=true branch can be exercised without simulating the
   * step-10 share-action tap sequence first.
   */
  readonly initialReferral?: FunnelReferral;
  /**
   * Optional seed value for the payment slice (Phase 2.4 / step 12 —
   * payment_model). When omitted (the production path), the provider
   * initialises with `INITIAL_FUNNEL_PAYMENT` so `selectedMethod` is
   * `null`, `isProcessing` is `false`, and `isPremium` is `false` —
   * matching the Sub-AC 15.1 initial-state contract. Tests use this prop
   * to spin up the provider with a pre-set `isPremium: true` so the
   * premium branch of `result_reveal` can be exercised without simulating
   * the step-12 payment tap sequence first.
   */
  readonly initialPayment?: FunnelPayment;
}

/**
 * Provider component that owns the funnel onboarding state and exposes it
 * via {@link FunnelStateContext}. Mount this at `app/(funnel)/_layout.tsx`
 * so every screen under the funnel group sees the same in-flight answers.
 *
 * Behavioural contract (asserted by `tests/funnel-state-context.test.tsx`):
 *   - First render: `onboarding === INITIAL_FUNNEL_ONBOARDING_ANSWERS`
 *     (both fields `null`).
 *   - `setOnboarding({ selfieEditStyle: 'natural' })` produces a new
 *     `onboarding` reference where `selfieEditStyle === 'natural'` and
 *     `priorDiagnosis === null` (untouched).
 *   - `setOnboarding({ priorDiagnosis: 'professional' })` immediately
 *     afterwards produces a new reference where BOTH fields are present
 *     from their respective updates — the previous selfieEditStyle is NOT
 *     reset.
 *   - The previous `onboarding` object's identity is preserved across
 *     renders if no write occurred (the in-flight `prev` reference handed
 *     to the functional updater is the same object the consumer reads).
 *   - The `setOnboarding` reference itself is stable across renders so
 *     consumers can list it in a `useEffect` dependency array without
 *     spurious re-runs.
 */
export function FunnelStateProvider(
  props: FunnelStateProviderProps,
): React.ReactElement {
  const {
    children,
    initialOnboarding,
    initialDiagnosisInput,
    initialReferral,
    initialPayment,
  } = props;

  // `useState` is the entire engine here — no reducer, no external store,
  // no AsyncStorage (Phase 3). The initial value is computed lazily via the
  // function form so the (cheap) ternary only runs on first render rather
  // than on every render.
  const [onboarding, setOnboardingState] = React.useState<FunnelOnboardingAnswers>(
    () => initialOnboarding ?? INITIAL_FUNNEL_ONBOARDING_ANSWERS,
  );

  // Parallel useState for the Phase 2.3 diagnosisInput slice. Kept on a
  // separate state cell (rather than nested inside `onboarding`) so React's
  // bailout-on-equal-reference path treats writes to one slice independently
  // of the other — a `setOnboarding(...)` call does not invalidate the
  // `diagnosisInput` reference, and vice versa.
  const [diagnosisInput, setDiagnosisInputState] = React.useState<FunnelDiagnosisInput>(
    () => initialDiagnosisInput ?? INITIAL_FUNNEL_DIAGNOSIS_INPUT,
  );

  // `setOnboarding` is wrapped in `useCallback` so its identity is stable
  // across renders — combined with the `useMemo` on the context value below,
  // this guarantees consumers do not re-render purely because the updater
  // reference changed.
  //
  // Implementation note: we use `{ ...prev, ...patch }` rather than
  // `Object.assign(prev, patch)` to keep `prev` unmutated. The patch shape
  // is constrained by `FunnelOnboardingPatch` (string-literal-union-or-null
  // values only — no free text per the Seed constraint), so spreading it
  // into the new object cannot introduce out-of-domain values.
  const setOnboarding = React.useCallback<SetOnboarding>(
    (patch: FunnelOnboardingPatch) => {
      setOnboardingState((prev: FunnelOnboardingAnswers) => {
        const next: FunnelOnboardingAnswers = { ...prev, ...patch };
        return next;
      });
    },
    [],
  );

  // `setDiagnosisInput` mirrors `setOnboarding` exactly — same immutable
  // spread-merge, same stable identity via `useCallback`. Keeping the two
  // updaters structurally identical preserves the "parallel slices"
  // invariant declared on `FunnelStateValue`.
  const setDiagnosisInput = React.useCallback<SetDiagnosisInput>(
    (patch: FunnelDiagnosisInputPatch) => {
      setDiagnosisInputState((prev: FunnelDiagnosisInput) => {
        const next: FunnelDiagnosisInput = { ...prev, ...patch };
        return next;
      });
    },
    [],
  );

  // Phase 2.4 referral slice (step 10 — referral_gate). Same parallel-slice
  // pattern as `onboarding` and `diagnosisInput`: independent `useState`
  // cell, immutable spread-merge updater, stable identity via `useCallback`
  // so a write to one slice does not invalidate the reference identity of
  // any other slice — consumers that only subscribe to one slice will not
  // re-render on writes to the others.
  const [referral, setReferralState] = React.useState<FunnelReferral>(
    () => initialReferral ?? INITIAL_FUNNEL_REFERRAL,
  );

  // `setReferral` mirrors `setOnboarding` / `setDiagnosisInput` exactly —
  // same immutable spread-merge, same stable identity. Keeping the three
  // updaters structurally identical preserves the "parallel slices"
  // invariant declared on `FunnelStateValue` and makes the contract easy
  // to extend (Phase 2.4 sibling AC adds a `payment` slice that follows
  // the same template).
  const setReferral = React.useCallback<SetReferral>((patch: FunnelReferralPatch) => {
    setReferralState((prev: FunnelReferral) => {
      const next: FunnelReferral = { ...prev, ...patch };
      return next;
    });
  }, []);

  // Phase 2.4 payment slice (step 12 — payment_model). Same parallel-slice
  // pattern as the other slices: independent `useState` cell, immutable
  // spread-merge updater, stable identity via `useCallback`. Seed defaults
  // (Sub-AC 15.1) come from `INITIAL_FUNNEL_PAYMENT`: `selectedMethod: null`,
  // `isProcessing: false`, `isPremium: false`.
  const [payment, setPaymentState] = React.useState<FunnelPayment>(
    () => initialPayment ?? INITIAL_FUNNEL_PAYMENT,
  );

  // `setPayment` mirrors the other three slice updaters exactly — same
  // immutable spread-merge, same stable identity via `useCallback`. The
  // patch shape constrains `selectedMethod` to `PaymentMethod | null` (no
  // free-text widening) and the two flags to `boolean`, so spreading the
  // patch into the new object cannot introduce out-of-domain values.
  const setPayment = React.useCallback<SetPayment>((patch: FunnelPaymentPatch) => {
    setPaymentState((prev: FunnelPayment) => {
      const next: FunnelPayment = { ...prev, ...patch };
      return next;
    });
  }, []);

  // Sub-AC 15.2 — dedicated `setSelectedPaymentMethod` action.
  //
  // Routes through the same `useState` cell as `setPayment` so the immutable
  // spread-merge invariant holds: the previous `payment` reference is never
  // mutated in place, and a `setSelectedPaymentMethod('kakao')` write
  // produces a brand-new `payment` object with `isProcessing` and
  // `isPremium` carried over untouched from the previous snapshot.
  //
  // Why a dedicated `useCallback` (instead of inlining `setPayment({
  // selectedMethod: method })` at every call site):
  //   - Single-purpose action surface — the payment_model radio UI binds
  //     each option to exactly this action, with no risk of an unrelated
  //     payment-slice field being patched by mistake.
  //   - Type-narrowed argument — the signature is `(method: PaymentMethod |
  //     null) => void`, not `(patch: FunnelPaymentPatch) => void`, so a
  //     caller cannot widen the call to also toggle `isProcessing` or
  //     `isPremium` in the same action. Keeps the "method selection"
  //     concern surgically isolated from the payment-flow state machine.
  //   - Stable identity via `useCallback([])` so consumers can list it in
  //     `useEffect` dependency arrays without spurious re-runs.
  const setSelectedPaymentMethod = React.useCallback<SetSelectedPaymentMethod>(
    (method: PaymentMethod | null) => {
      setPaymentState((prev: FunnelPayment) => {
        // Bail out when the requested value matches the current selection
        // — React already short-circuits identical references, but the
        // early return makes the intent explicit and saves a downstream
        // `useMemo` rebuild when the user re-taps the already-selected
        // radio option.
        if (prev.selectedMethod === method) {
          return prev;
        }
        const next: FunnelPayment = { ...prev, selectedMethod: method };
        return next;
      });
    },
    [],
  );

  // Sub-AC 15.3 — dedicated `setPaymentProcessing` action.
  //
  // Routes through the same `useState` cell as `setPayment` /
  // `setSelectedPaymentMethod` so the immutable spread-merge invariant
  // holds: the previous `payment` reference is never mutated in place, and
  // a `setPaymentProcessing(true)` write produces a brand-new `payment`
  // object with `selectedMethod` and `isPremium` carried over untouched from
  // the previous snapshot.
  //
  // Why a dedicated `useCallback` (instead of inlining `setPayment({
  // isProcessing: value })` at every call site):
  //   - Single-purpose action surface — the payment_model "결제하기" CTA
  //     and the placeholder 250ms `setTimeout` cleanup both bind directly
  //     to this action, with no risk of an unrelated payment-slice field
  //     being patched by mistake.
  //   - Type-narrowed argument — the signature is `(isProcessing: boolean)
  //     => void`, not `(patch: FunnelPaymentPatch) => void`, so a caller
  //     cannot widen the call to also toggle `selectedMethod` or
  //     `isPremium` in the same action. Keeps the "in-flight flag"
  //     concern surgically isolated from the rest of the payment-flow
  //     state machine.
  //   - Stable identity via `useCallback([])` so consumers can list it in
  //     `useEffect` dependency arrays (the placeholder timer effect on
  //     payment_model lists it as a dep) without spurious re-runs.
  //
  // Bailout semantics mirror `setSelectedPaymentMethod`: a no-op write
  // (`setPaymentProcessing(false)` while `prev.isProcessing` is already
  // `false`) returns the previous reference verbatim so React short-circuits
  // the re-render and downstream `useMemo`s keyed on `payment` do not
  // rebuild.
  const setPaymentProcessing = React.useCallback<SetPaymentProcessing>(
    (isProcessing: boolean) => {
      setPaymentState((prev: FunnelPayment) => {
        if (prev.isProcessing === isProcessing) {
          return prev;
        }
        const next: FunnelPayment = { ...prev, isProcessing };
        return next;
      });
    },
    [],
  );

  // Sub-AC 15.4 — dedicated `setIsPremium` action.
  //
  // Routes through the same `useState` cell as `setPayment` /
  // `setSelectedPaymentMethod` / `setPaymentProcessing` so the immutable
  // spread-merge invariant holds: the previous `payment` reference is never
  // mutated in place, and a `setIsPremium(true)` write produces a brand-new
  // `payment` object with `selectedMethod` and `isProcessing` carried over
  // untouched from the previous snapshot.
  //
  // Why a dedicated `useCallback` (instead of inlining `setPayment({
  // isPremium: value })` at every call site):
  //   - Single-purpose action surface — the payment_model placeholder
  //     success flow flips the gate by binding directly to this action,
  //     with no risk of an unrelated payment-slice field being patched by
  //     mistake.
  //   - Type-narrowed argument — the signature is `(isPremium: boolean) =>
  //     void`, not `(patch: FunnelPaymentPatch) => void`, so a caller
  //     cannot widen the call to also toggle `selectedMethod` or
  //     `isProcessing` in the same action. Keeps the "premium unlock"
  //     concern surgically isolated from the rest of the payment-flow
  //     state machine.
  //   - Stable identity via `useCallback([])` so consumers can list it in
  //     `useEffect` dependency arrays without spurious re-runs.
  //
  // Bailout semantics mirror `setSelectedPaymentMethod` /
  // `setPaymentProcessing`: a no-op write (`setIsPremium(true)` while
  // `prev.isPremium` is already `true`) returns the previous reference
  // verbatim so React short-circuits the re-render and downstream
  // `useMemo`s keyed on `payment` do not rebuild — important because
  // `result_reveal` (the only consumer of `payment.isPremium` in this
  // phase) gates an expensive lock-overlay render off the slice reference.
  //
  // Mutual-exclusion with `isPreviewMode` (Seed constraint
  // "isPreviewMode and isPremium are mutually exclusive — premium entry
  // invalidates preview branch") is enforced at the consumer boundary
  // (`result_reveal` render-time branch selection), not inside this setter
  // — the action only flips the slice flag.
  const setIsPremium = React.useCallback<SetIsPremium>((isPremium: boolean) => {
    setPaymentState((prev: FunnelPayment) => {
      if (prev.isPremium === isPremium) {
        return prev;
      }
      const next: FunnelPayment = { ...prev, isPremium };
      return next;
    });
  }, []);

  // Stable context value reference — only rebuilt when one of the state
  // slices actually changes (every `set*` updater is itself stable via
  // useCallback, so they never trigger a rebuild on their own).
  const value = React.useMemo<FunnelStateValue>(
    () => ({
      onboarding,
      setOnboarding,
      diagnosisInput,
      setDiagnosisInput,
      referral,
      setReferral,
      payment,
      setPayment,
      setSelectedPaymentMethod,
      setPaymentProcessing,
      setIsPremium,
    }),
    [
      onboarding,
      setOnboarding,
      diagnosisInput,
      setDiagnosisInput,
      referral,
      setReferral,
      payment,
      setPayment,
      setSelectedPaymentMethod,
      setPaymentProcessing,
      setIsPremium,
    ],
  );

  return React.createElement(FunnelStateContext.Provider, { value }, children);
}

// ---------------------------------------------------------------------------
// `useFunnelState` re-export
//
// The strict (throws-when-outside-provider) `useFunnelState` hook lives in
// `../hooks/use-funnel-state.ts` per the project's `src/hooks/` convention
// (see `use-auto-advance-timer.ts`, `use-dummy.ts`). We re-export it here
// so existing call sites that import the hook from the provider module
// continue to resolve to the strict implementation — there is exactly one
// `useFunnelState` symbol in the app graph.
//
// Importing the hook eagerly would create a circular dependency (the hook
// imports `FunnelStateContext` from this file). The hook file itself only
// reads the Context's *type identity*, so the cycle is harmless at runtime
// — Node/Vite resolve the module graph lazily enough that the
// `React.useContext(...)` call in the hook always sees the populated
// Context object. The re-export below is a plain ES re-export, evaluated
// after both modules' top-level bindings settle.
// ---------------------------------------------------------------------------
export {
  useFunnelState,
  FunnelStateProviderMissingError,
} from '../hooks/use-funnel-state';
