/**
 * Unit test — `apps/mobile/src/analytics/track-referral-shared.ts`
 * (Sub-AC 18.1, Phase 2.4).
 *
 * Pins the placeholder contract for `trackReferralShared`:
 *
 *   - No real PostHog client wiring (deferred to Phase 2.5 — Seed constraint
 *     "All external SDK interactions are noop placeholders with TODO
 *     comments").
 *   - The function MUST invoke `console.log` exactly once per call.
 *   - The `console.log` arguments MUST include the snake_case event name
 *     literal `referral_shared` (Seed constraint: "PostHog event names use
 *     snake_case + verb form for Phase 2.5 reuse") AND the structured
 *     payload object so the swap to `posthog.capture('referral_shared',
 *     payload)` is a one-line edit.
 *
 * Why a single `it(...)` block:
 *   Sub-AC 18.1 explicitly scopes the test to "a single test asserting
 *   console.log is called with correct event name and properties". One
 *   focused assertion is sufficient: the function under test has a single
 *   side effect (the `console.log` call) and no return value, so a single
 *   call + spy-introspection cycle covers the entire observable contract.
 *
 * Why `vi.spyOn(console, 'log').mockImplementation(() => undefined)`:
 *   Mirrors the convention used by `tests/funnel-guards.test.ts` for
 *   `console.warn` spies — the spy silences the placeholder log so vitest's
 *   output stays clean, while `.mock.calls[0]` still preserves the
 *   arguments for assertion.
 */
import type { MockInstance } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  trackReferralShared,
  type TrackReferralSharedPayload,
} from '../src/analytics/track-referral-shared';

describe('trackReferralShared (Phase 2.4 placeholder, Sub-AC 18.1)', () => {
  // `console.log`'s real signature is
  // `(message?: any, ...optionalParams: any[]) => void`. We narrow the spy
  // generics to that exact tuple so `.mock.calls[0]` is typed as
  // `[any?, ...any[]]` and the variadic-arg assertions below compile under
  // TS strict.
  let logSpy: MockInstance<[message?: unknown, ...optionalParams: unknown[]], void>;

  beforeEach(() => {
    logSpy = vi
      .spyOn(console, 'log')
      .mockImplementation(() => undefined) as MockInstance<
      [message?: unknown, ...optionalParams: unknown[]],
      void
    >;
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('console.logs the `referral_shared` event with the supplied payload', () => {
    const payload: TrackReferralSharedPayload = { method: 'kakao' };

    trackReferralShared(payload);

    // Single side effect: exactly one console.log call. Forbids both
    // "no log" regressions and "logs twice" regressions.
    expect(logSpy).toHaveBeenCalledTimes(1);

    // The recorded arguments MUST contain the snake_case event-name literal
    // and the structured payload object so the Phase 2.5 swap to a real
    // `posthog.capture(name, payload)` is mechanical. We do not pin the
    // exact prefix label (e.g. `[analytics:placeholder]`) so the placeholder
    // wrapper can be tweaked for log-readability without breaking the test
    // — the contract under test is "event name + payload appear in the call
    // arguments", not the cosmetic prefix.
    const callArgs = logSpy.mock.calls[0] ?? [];
    expect(callArgs).toContain('referral_shared');
    expect(callArgs).toContainEqual(payload);
  });
});
