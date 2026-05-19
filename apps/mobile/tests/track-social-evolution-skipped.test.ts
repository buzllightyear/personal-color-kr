/**
 * Unit test — `apps/mobile/src/analytics/track-social-evolution-skipped.ts`
 * (Sub-AC 18.3, Phase 2.4).
 *
 * Pins the placeholder contract for `trackSocialEvolutionSkipped`:
 *
 *   - No real PostHog client wiring (deferred to Phase 2.5 — Seed constraint
 *     "All external SDK interactions are noop placeholders with TODO
 *     comments").
 *   - The function MUST invoke `console.log` exactly once per call.
 *   - The `console.log` arguments MUST include the snake_case event-name
 *     literal `social_evolution_skipped` (Seed constraint: "PostHog event
 *     names use snake_case + verb form for Phase 2.5 reuse") AND the
 *     structured payload object so the swap to
 *     `posthog.capture('social_evolution_skipped', payload)` is a one-line
 *     edit.
 *
 * Why a single `it(...)` block:
 *   Sub-AC 18.3 explicitly scopes the test to "a single test asserting
 *   console.log is called with correct event name and properties". One
 *   focused assertion is sufficient: the function under test has a single
 *   side effect (the `console.log` call) and no return value, so a single
 *   call + spy-introspection cycle covers the entire observable contract.
 *
 * Why no dimension fields in the payload:
 *   The skip path has a single binary outcome — the user tapped the skip
 *   button on `social_evolution` — so there is no analogue of
 *   `trackReferralShared`'s `method` discriminator. The payload type
 *   `TrackSocialEvolutionSkippedPayload` resolves to `Record<string, never>`
 *   in Phase 2.4; the test passes `{}` and asserts the empty object is
 *   logged alongside the event-name constant. Phase 2.5 may add additive
 *   optional fields (e.g. `branch`, `dwell_ms`) without changing this
 *   test's call site.
 *
 * Why `vi.spyOn(console, 'log').mockImplementation(() => undefined)`:
 *   Mirrors `tests/track-referral-shared.test.ts` and
 *   `tests/track-referral-skipped.test.ts` (the sibling Sub-AC 18.1 / 18.2
 *   tests) and `tests/funnel-guards.test.ts`'s `console.warn` spies — the
 *   spy silences the placeholder log so vitest's output stays clean, while
 *   `.mock.calls[0]` still preserves the arguments for assertion.
 */
import type { MockInstance } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  trackSocialEvolutionSkipped,
  type TrackSocialEvolutionSkippedPayload,
} from '../src/analytics/track-social-evolution-skipped';

describe('trackSocialEvolutionSkipped (Phase 2.4 placeholder, Sub-AC 18.3)', () => {
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

  it('console.logs the `social_evolution_skipped` event with the supplied payload', () => {
    // The Phase 2.4 payload is an empty object — `TrackSocialEvolutionSkippedPayload`
    // resolves to `Record<string, never>` so the literal `{}` is the only
    // value the type permits. The variable + explicit annotation make the
    // contract visible at the call site: if Phase 2.5 widens the payload
    // shape, every downstream consumer is forced to revisit this annotation.
    const payload: TrackSocialEvolutionSkippedPayload = {};

    trackSocialEvolutionSkipped(payload);

    // Single side effect: exactly one console.log call. Forbids both
    // "no log" regressions and "logs twice" regressions.
    expect(logSpy).toHaveBeenCalledTimes(1);

    // The recorded arguments MUST contain the snake_case event-name literal
    // and the structured payload object so the Phase 2.5 swap to a real
    // `posthog.capture(name, payload)` is mechanical. We do not pin the
    // exact prefix label (e.g. `[analytics:placeholder]`) so the placeholder
    // wrapper can be tweaked for log-readability without breaking the test
    // — the contract under test is "event name + properties appear in the
    // call arguments", not the cosmetic prefix.
    const callArgs = logSpy.mock.calls[0] ?? [];
    expect(callArgs).toContain('social_evolution_skipped');
    expect(callArgs).toContainEqual(payload);
  });
});
