/**
 * Unit test — `apps/mobile/src/analytics/track-payment-skipped.ts`
 * (Phase 2.6, Sub-AC 12.1 — captureFn spy pattern).
 *
 * Pins the live-wiring contract for `trackPaymentSkipped`:
 *
 *   - The function MUST invoke the injected `posthog.capture(...)` exactly
 *     once with the snake_case event-name literal `payment_skipped`
 *     (asserted against the exported `PAYMENT_SKIPPED_EVENT_NAME` constant
 *     so a rename in the module becomes a compile-time / test-time signal
 *     rather than silent drift) and the structured payload object the
 *     caller supplied. The constant invariant matches the Seed's
 *     "event_name === capture arg" cross-check axis.
 *
 *   - Degraded-mode contract: when `posthog` is `undefined` (the
 *     PostHogProvider's onboarding-degradation branch when EXPO_PUBLIC env
 *     vars are missing), the helper MUST be a silent no-op — no throw, no
 *     `console.log`, and the spy MUST record zero calls. This pins the Seed
 *     constraint "Degraded mode posthog undefined must produce silent no-op".
 *
 * Why a stub PostHog client (rather than `vi.mock('posthog-react-native')`):
 *   The Phase 2.6 DI signature is `(posthog: PostHog | undefined, payload)`
 *   — the helper takes the client as its first argument, so the unit test
 *   can construct a minimal `{ capture: vi.fn() }` stub and pass it
 *   directly. Module-level mocking is only required when the SUT itself
 *   calls `usePostHog()` (e.g. the auto-capture in `app/_layout.tsx`, where
 *   `tests/funnel-step-entered-capture.test.tsx` legitimately needs
 *   `vi.mock('posthog-react-native')` because the component reaches into
 *   the React context internally). Here the pass-through DI keeps the unit
 *   test dependency-free and faster.
 *
 * Why we cast the stub to `PostHog`:
 *   The `PostHog` class from `posthog-react-native` has ~40 public methods;
 *   the SUT only exercises `.capture(name, payload)`. Constructing a full
 *   structural match would be noise — the cast through `unknown` documents
 *   that the stub deliberately implements a narrow subset of the surface
 *   under test. Production code never sees this stub (only `usePostHog()`'s
 *   real client or `undefined`), so the cast is type-safe in context.
 *
 * Why two `it(...)` blocks (not a single combined one):
 *   The Seed mandates "Each module minimum 2 test cases happy path capture +
 *   degraded mode no-op". Separating them makes the failure mode actionable:
 *   if the happy-path assertion regresses, the degraded-mode test still
 *   confirms the no-op branch survives, and vice versa.
 */
import type { PostHog } from 'posthog-react-native';
import { describe, expect, it, vi } from 'vitest';

import {
  PAYMENT_SKIPPED_EVENT_NAME,
  trackPaymentSkipped,
  type TrackPaymentSkippedPayload,
} from '../src/analytics/track-payment-skipped';

describe('trackPaymentSkipped (Phase 2.6 live wiring, Sub-AC 12.1)', () => {
  it('invokes posthog.capture("payment_skipped", payload) exactly once on happy path', () => {
    // Stub the singleton PostHog client with a spied `.capture`. The DI
    // signature lets us hand this directly to the helper without touching
    // `posthog-react-native`'s real module.
    const captureFn = vi.fn();
    const posthog = { capture: captureFn } as unknown as PostHog;

    // The Phase 2.6 payload is an empty object — `TrackPaymentSkippedPayload`
    // resolves to `Record<string, never>` so the literal `{}` is the only
    // value the type permits. The explicit annotation pins the contract: if
    // a future phase widens the payload shape, this annotation forces a
    // call-site update.
    const payload: TrackPaymentSkippedPayload = {};

    trackPaymentSkipped(posthog, payload);

    // Single side effect: exactly one capture call. Forbids both
    // "no capture" regressions and "captures twice" regressions.
    expect(captureFn).toHaveBeenCalledTimes(1);

    // Assert against the exported constant rather than the duplicated
    // string literal `'payment_skipped'` so a rename in the SUT triggers a
    // compile-time / test-time failure here instead of silently diverging
    // from the PostHog dashboard's funnel definition.
    expect(captureFn).toHaveBeenCalledWith(PAYMENT_SKIPPED_EVENT_NAME, payload);

    // Belt-and-braces literal check: the constant MUST equal the exact
    // snake_case string the PostHog dashboard funnel is keyed on. This
    // closes the "event_name === capture arg" cross-check axis from the
    // Seed exit conditions.
    expect(PAYMENT_SKIPPED_EVENT_NAME).toBe('payment_skipped');
  });

  it('silently no-ops when posthog is undefined (degraded mode)', () => {
    // Degraded mode: the PostHogProvider's onboarding-degradation branch
    // (missing EXPO_PUBLIC_POSTHOG_API_KEY) returns `undefined` from
    // `usePostHog()`. The helper MUST swallow this and do nothing — no
    // throw, no `console.log`, zero captures recorded.
    const consoleSpy = vi
      .spyOn(console, 'log')
      .mockImplementation(() => undefined);
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    try {
      const payload: TrackPaymentSkippedPayload = {};

      // The call MUST NOT throw — `posthog?.capture(...)` optional chaining
      // short-circuits when the client is undefined.
      expect(() => trackPaymentSkipped(undefined, payload)).not.toThrow();

      // Zero `console.log` calls — the degraded path is silent, not "logs
      // a warning". This pins the Seed constraint "no console.log" residue
      // in the production module.
      expect(consoleSpy).toHaveBeenCalledTimes(0);
      expect(consoleErrorSpy).toHaveBeenCalledTimes(0);
      expect(consoleWarnSpy).toHaveBeenCalledTimes(0);
    } finally {
      consoleSpy.mockRestore();
      consoleErrorSpy.mockRestore();
      consoleWarnSpy.mockRestore();
    }
  });
});
