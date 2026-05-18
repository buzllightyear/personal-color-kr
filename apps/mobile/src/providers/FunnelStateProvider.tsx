/**
 * `FunnelStateProvider` — React Context provider for the personal-color-kr
 * funnel screens (steps 1–5 in MVP, expanded in later phases).
 *
 * Sub-AC 7.2 responsibilities:
 *   1. Expose a `FunnelStateContext` keyed on the typed contract from
 *      `src/contracts/funnel-state.ts` (`FunnelStateValue`). All consumers
 *      read this same Context via the `useFunnelState()` hook so there is a
 *      single source of truth for the in-flight onboarding answers.
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
  INITIAL_FUNNEL_ONBOARDING_ANSWERS,
  type FunnelOnboardingAnswers,
  type FunnelOnboardingPatch,
  type FunnelStateValue,
  type SetOnboarding,
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
  const { children, initialOnboarding } = props;

  // `useState` is the entire engine here — no reducer, no external store,
  // no AsyncStorage (Phase 3). The initial value is computed lazily via the
  // function form so the (cheap) ternary only runs on first render rather
  // than on every render.
  const [onboarding, setOnboardingState] =
    React.useState<FunnelOnboardingAnswers>(
      () => initialOnboarding ?? INITIAL_FUNNEL_ONBOARDING_ANSWERS,
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

  // Stable context value reference — only rebuilt when `onboarding` actually
  // changes (since `setOnboarding` is itself stable via useCallback).
  const value = React.useMemo<FunnelStateValue>(
    () => ({
      onboarding,
      setOnboarding,
    }),
    [onboarding, setOnboarding],
  );

  return React.createElement(
    FunnelStateContext.Provider,
    { value },
    children,
  );
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
