/**
 * `useFunnelState` — strict (fail-loud) hook that reads the funnel state from
 * the nearest `<FunnelStateProvider>` (Sub-AC 7.3).
 *
 * Behavioural contract:
 *   - When mounted INSIDE a `<FunnelStateProvider>`, the hook returns the live
 *     `FunnelStateValue` snapshot — the immutable `onboarding` answers and the
 *     stable `setOnboarding` updater — exactly as published by the provider.
 *     Components subscribing through this hook re-render whenever
 *     `setOnboarding(...)` produces a new `onboarding` reference (React's
 *     standard Context subscription semantics).
 *   - When invoked OUTSIDE any provider, the hook throws a
 *     `FunnelStateProviderMissingError`. This is the "fail-loud" guard the
 *     Seed contract requires: a funnel screen mounted without the layout
 *     wrapper is a programming bug (the layout at
 *     `app/(funnel)/_layout.tsx` is responsible for wrapping every funnel
 *     route with `<FunnelStateProvider>`), and silently returning a fallback
 *     would mask that bug behind correct-looking UI rendering — the user
 *     would tap a segmented control and the answer would vanish.
 *
 * Why a sentinel `undefined` (not a default object literal):
 *   React's `createContext` requires a default value. To detect "no provider
 *   above me", we use the canonical pattern of `createContext<FunnelStateValue
 *   | undefined>(undefined)` — `undefined` is unambiguously "no provider"
 *   because the provider always supplies a real value via its
 *   `useMemo(...)` bundle. The strict hook narrows the type from
 *   `FunnelStateValue | undefined` back to `FunnelStateValue` after the
 *   runtime undefined check, so downstream callers see the same precise
 *   shape the contract module declares without any optional-chaining noise.
 *
 * Why a custom Error class (not a bare `Error`):
 *   Distinguishing "hook misuse" from a generic runtime error helps test
 *   suites assert the precise failure mode (`expect(...).toThrow(
 *   FunnelStateProviderMissingError)`) and lets future error-boundary code
 *   surface a developer-actionable message rather than a stack trace from
 *   somewhere deep in React. The class is exported alongside the hook so
 *   tests and error boundaries can reference the same constructor.
 *
 * Why this file lives in `src/hooks/` (not `src/providers/`):
 *   The `src/hooks/` directory is the project's established location for
 *   reusable custom hooks (see `use-auto-advance-timer.ts`, `use-dummy.ts`).
 *   Co-locating screen-facing hooks here keeps the provider file focused on
 *   provider-only concerns (Context creation, state owner, updater wiring)
 *   and avoids cyclic imports between providers/ and the hook consumers.
 *
 * Re-export note:
 *   `FunnelStateProvider.tsx` re-exports this `useFunnelState` so existing
 *   call sites that already import from the provider module continue to
 *   resolve to the strict (throwing) implementation — there is exactly one
 *   `useFunnelState` symbol in the app graph, and it is this one.
 *
 * @example
 *   import { useFunnelState } from '../../src/hooks/use-funnel-state';
 *
 *   function OnboardingPriming(): JSX.Element {
 *     const { onboarding, setOnboarding } = useFunnelState();
 *     return (
 *       <Button
 *         onPress={() => setOnboarding({ selfieEditStyle: 'natural' })}
 *         selected={onboarding.selfieEditStyle === 'natural'}
 *       />
 *     );
 *   }
 */
import * as React from 'react';

import type { FunnelStateValue } from '../contracts/funnel-state';
import { FunnelStateContext } from '../providers/FunnelStateProvider';

/**
 * Error thrown by {@link useFunnelState} when the hook is invoked outside a
 * `<FunnelStateProvider>` subtree. Exported so tests can assert the precise
 * error type and future error boundaries can pattern-match on it.
 *
 * The message intentionally names both the consumer (`useFunnelState`) and
 * the missing wrapper (`FunnelStateProvider`) so a developer reading a stack
 * trace immediately knows where to mount the provider.
 */
export class FunnelStateProviderMissingError extends Error {
  // Stable `name` so `error.name === 'FunnelStateProviderMissingError'` works
  // even after minification (which can erase `constructor.name`).
  // `override` is required because `Error.prototype.name` is declared on the
  // built-in (the project enables `noImplicitOverride` via TS strict mode).
  public override readonly name = 'FunnelStateProviderMissingError';

  public constructor() {
    super(
      'useFunnelState must be called inside a <FunnelStateProvider>. ' +
        'Mount the provider in app/(funnel)/_layout.tsx so every funnel screen ' +
        'shares one source of truth for onboarding answers.',
    );
    // Preserve the prototype chain across the TS → ES5 downlevel transform
    // (extending built-ins like `Error` is otherwise broken under
    // `target: es5`). No-op under modern targets but harmless to include.
    Object.setPrototypeOf(this, FunnelStateProviderMissingError.prototype);
  }
}

/**
 * Read the funnel state from the nearest {@link FunnelStateContext}.
 *
 * Returns the live `{ onboarding, setOnboarding }` bundle. Throws
 * {@link FunnelStateProviderMissingError} when invoked without a surrounding
 * `<FunnelStateProvider>` (fail-loud guard for the funnel screens).
 *
 * @throws {FunnelStateProviderMissingError} if no provider is mounted above.
 */
export function useFunnelState(): FunnelStateValue {
  const value = React.useContext(FunnelStateContext);
  if (value === undefined) {
    throw new FunnelStateProviderMissingError();
  }
  return value;
}
