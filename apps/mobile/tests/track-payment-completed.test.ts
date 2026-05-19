/**
 * Unit test — `apps/mobile/src/analytics/track-payment-completed.ts`
 * (Sub-AC 18.5, Phase 2.4).
 *
 * Pins the placeholder contract for `trackPaymentCompleted`:
 *
 *   - No real PostHog client wiring (deferred to Phase 2.5 — Seed constraint
 *     "All external SDK interactions are noop placeholders with TODO
 *     comments").
 *   - The function MUST invoke `console.log` exactly once per call.
 *   - The `console.log` arguments MUST include the snake_case event-name
 *     literal `payment_completed` (Seed constraint: "PostHog event names use
 *     snake_case + verb form for Phase 2.5 reuse") AND the structured
 *     payload object carrying the transaction properties (`method` +
 *     `amountKrw`) so the swap to `posthog.capture('payment_completed',
 *     payload)` is a one-line edit.
 *
 * Why a single `it(...)` block:
 *   Sub-AC 18.5 explicitly scopes the test to "a single test asserting
 *   console.log is called with correct event name and transaction
 *   properties". One focused assertion is sufficient: the function under
 *   test has a single side effect (the `console.log` call) and no return
 *   value, so a single call + spy-introspection cycle covers the entire
 *   observable contract.
 *
 * Why we explicitly inspect the recorded `method` AND `amountKrw`
 * properties (not just `toContainEqual(payload)`):
 *   The Sub-AC wording — "correct event name and transaction properties" —
 *   calls out the transaction dimensions by name. Asserting the inner
 *   properties directly (`payload.method === 'kakao'` and
 *   `payload.amountKrw === 9900`) pins the contract at the field level, so
 *   a future regression that strips either field from the payload object
 *   (or renames one) fails this test even if the wrapper payload object
 *   itself still happens to be logged. This mirrors how
 *   `track-payment-method-selected.test.ts` (Sub-AC 18.4) covers the
 *   parallel `method` discriminator with explicit field-level
 *   introspection.
 *
 * Why `vi.spyOn(console, 'log').mockImplementation(() => undefined)`:
 *   Mirrors `tests/track-referral-shared.test.ts`,
 *   `tests/track-referral-skipped.test.ts`,
 *   `tests/track-social-evolution-skipped.test.ts`, and
 *   `tests/track-payment-method-selected.test.ts` (the sibling Sub-AC
 *   18.1 / 18.2 / 18.3 / 18.4 tests) and `tests/funnel-guards.test.ts`'s
 *   `console.warn` spies — the spy silences the placeholder log so
 *   vitest's output stays clean, while `.mock.calls[0]` still preserves
 *   the arguments for assertion.
 */
import type { MockInstance } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  trackPaymentCompleted,
  type TrackPaymentCompletedPayload,
} from '../src/analytics/track-payment-completed';

describe('trackPaymentCompleted (Phase 2.4 placeholder, Sub-AC 18.5)', () => {
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

  it('console.logs the `payment_completed` event with the supplied transaction properties', () => {
    // The explicit annotation forces the call site to satisfy
    // `TrackPaymentCompletedPayload` — if Phase 2.5 widens or renames the
    // payload shape, this test fails at compile time rather than silently
    // logging a stale payload. The literal `9900` matches `PAYMENT_AMOUNT_KRW`
    // (the hardcoded ₩9,900 one-time unlock price in
    // `src/funnel/payment-model-ctas.ts`) without importing the constant —
    // intentionally decoupled so a price tweak in Phase 2.5 does not
    // cascade-break this analytics contract test.
    const payload: TrackPaymentCompletedPayload = {
      method: 'kakao',
      amountKrw: 9900,
    };

    trackPaymentCompleted(payload);

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
    expect(callArgs).toContain('payment_completed');
    expect(callArgs).toContainEqual(payload);

    // Field-level assertion: the recorded payload must carry the exact
    // `method` AND `amountKrw` properties the caller passed (Sub-AC 18.5:
    // "transaction properties"). Searching `callArgs` for any object
    // containing both fields is robust against the call-format being
    // either `(prefix, name, payload)` or `(name, payload)` — both
    // legitimate placeholder shapes — without coupling the test to the
    // prefix position.
    const recordedPayload = callArgs.find(
      (arg): arg is TrackPaymentCompletedPayload =>
        typeof arg === 'object' &&
        arg !== null &&
        'method' in arg &&
        'amountKrw' in arg,
    );
    expect(recordedPayload).toBeDefined();
    expect(recordedPayload?.method).toBe('kakao');
    expect(recordedPayload?.amountKrw).toBe(9900);
  });
});
