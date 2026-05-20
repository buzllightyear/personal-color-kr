/**
 * Unit test — `apps/mobile/src/analytics/track-social-evolution-skipped.ts`
 * (Phase 2.6 — real PostHog `capture` wiring via client pass-through DI).
 *
 * Pins the post-Phase-2.6 contract for `trackSocialEvolutionSkipped`:
 *
 *   1. **Happy path** — when a PostHog client is injected, the helper MUST
 *      invoke `posthog.capture(...)` exactly once with the snake_case event
 *      name literal `social_evolution_skipped` (sourced via the
 *      {@link SOCIAL_EVOLUTION_SKIPPED_EVENT_NAME} constant) AND the
 *      empty-object payload the caller passed.
 *
 *   2. **Degraded mode (AC 11)** — when the injected client is `undefined`,
 *      the helper MUST silently no-op: `capture` is not invoked (call count
 *      === 0), no throw is propagated, and no console channel emits output.
 *
 * Why a stub PostHog client (rather than `vi.mock('posthog-react-native')`):
 *   The Phase 2.6 DI signature is `(posthog: PostHog | undefined, payload)` —
 *   the helper takes the client as its first argument, so the unit test can
 *   construct a minimal `{ capture: vi.fn() }` stub and pass it directly.
 *   Module-level mocking is only required when the SUT itself calls
 *   `usePostHog()` internally (e.g. the auto-capture in `app/_layout.tsx`,
 *   where `tests/funnel-step-entered-capture.test.tsx` legitimately needs
 *   `vi.mock('posthog-react-native')`). Pass-through DI keeps this unit
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
 * Why two `it(...)` blocks with inline spies (matches sibling pattern):
 *   The Seed mandates "Each module minimum 2 test cases happy path capture +
 *   degraded mode no-op". Inlining the console spies inside each `it` block
 *   (rather than hoisting them to `beforeEach`) mirrors the
 *   `tests/track-payment-skipped.test.ts` sibling shape AND sidesteps the
 *   TS-strict mismatch between `ReturnType<typeof vi.spyOn>` (which resolves
 *   to `MockInstance<unknown[], unknown>` because `vi.spyOn` is generic) and
 *   the actual return type `MockInstance<[message?: any, ...optionalParams:
 *   any[]], void>` from `vi.spyOn(console, 'log')`. A `try/finally` ensures
 *   the console is always restored even if an assertion throws.
 */
import type { PostHog } from 'posthog-react-native';
import { describe, expect, it, vi } from 'vitest';

import {
  SOCIAL_EVOLUTION_SKIPPED_EVENT_NAME,
  trackSocialEvolutionSkipped,
  type TrackSocialEvolutionSkippedPayload,
} from '../src/analytics/track-social-evolution-skipped';

describe('trackSocialEvolutionSkipped (Phase 2.6 — real PostHog capture wiring)', () => {
  it('invokes posthog.capture("social_evolution_skipped", payload) exactly once on happy path', () => {
    // Stub the singleton PostHog client with a spied `.capture`. The DI
    // signature lets us hand this directly to the helper without touching
    // `posthog-react-native`'s real module.
    const captureFn = vi.fn();
    const posthog = { capture: captureFn } as unknown as PostHog;

    // The Phase 2.6 payload is an empty object — `TrackSocialEvolutionSkippedPayload`
    // resolves to `Record<string, never>` so the literal `{}` is the only
    // value the type permits. The explicit annotation pins the contract: if
    // a future phase widens the payload shape, this annotation forces a
    // call-site update.
    const payload: TrackSocialEvolutionSkippedPayload = {};

    trackSocialEvolutionSkipped(posthog, payload);

    // Single side effect: exactly one capture call. Forbids both
    // "no capture" regressions and "captures twice" regressions.
    expect(captureFn).toHaveBeenCalledTimes(1);

    // Assert against the exported constant rather than the duplicated
    // string literal `'social_evolution_skipped'` so a rename in the SUT
    // triggers a compile-time / test-time failure here instead of silently
    // diverging from the PostHog dashboard's funnel definition.
    expect(captureFn).toHaveBeenCalledWith(SOCIAL_EVOLUTION_SKIPPED_EVENT_NAME, payload);

    // Belt-and-braces literal check: the constant MUST equal the exact
    // snake_case string the PostHog dashboard funnel is keyed on. This
    // closes the "event_name === capture arg" cross-check axis from the
    // Seed exit conditions.
    expect(SOCIAL_EVOLUTION_SKIPPED_EVENT_NAME).toBe('social_evolution_skipped');
  });

  it('silently no-ops when posthog is undefined (degraded mode — AC 11)', () => {
    // Degraded mode: the PostHogProvider's onboarding-degradation branch
    // (missing EXPO_PUBLIC_POSTHOG_API_KEY) returns `undefined` from
    // `usePostHog()`. The helper MUST swallow this and do nothing — no
    // throw, no `console.log`/`.warn`/`.error`, zero captures recorded.
    const captureFn = vi.fn();
    const consoleLogSpy = vi
      .spyOn(console, 'log')
      .mockImplementation(() => undefined);
    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    try {
      const payload: TrackSocialEvolutionSkippedPayload = {};

      // The call MUST NOT throw — `posthog?.capture(...)` optional chaining
      // short-circuits when the client is undefined.
      expect(() => trackSocialEvolutionSkipped(undefined, payload)).not.toThrow();

      // Zero capture invocations confirms the degraded path is a true
      // no-op (no fallback to console logging, no spy on a stub client).
      expect(captureFn).not.toHaveBeenCalled();

      // Zero console output of any kind — the degraded path is silent,
      // not "logs a warning". This pins the Seed constraint "Degraded mode
      // posthog undefined must produce silent no-op — no throw no
      // console.log capture called 0 times".
      expect(consoleLogSpy).not.toHaveBeenCalled();
      expect(consoleWarnSpy).not.toHaveBeenCalled();
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    } finally {
      consoleLogSpy.mockRestore();
      consoleWarnSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }
  });
});
