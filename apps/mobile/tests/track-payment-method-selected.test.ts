/**
 * Unit test — `apps/mobile/src/analytics/track-payment-method-selected.ts`
 * (Sub-AC 18.4, Phase 2.4).
 *
 * Pins the placeholder contract for `trackPaymentMethodSelected`:
 *
 *   - No real PostHog client wiring (deferred to Phase 2.5 — Seed constraint
 *     "All external SDK interactions are noop placeholders with TODO
 *     comments").
 *   - The function MUST invoke `console.log` exactly once per call.
 *   - The `console.log` arguments MUST include the snake_case event-name
 *     literal `payment_method_selected` (Seed constraint: "PostHog event
 *     names use snake_case + verb form for Phase 2.5 reuse") AND the
 *     structured payload object containing the selected `method` so the
 *     swap to `posthog.capture('payment_method_selected', payload)` is a
 *     one-line edit.
 *
 * Why a single `it(...)` block:
 *   Sub-AC 18.4 explicitly scopes the test to "a single test asserting
 *   console.log is called with correct event name and selected method
 *   property". One focused assertion is sufficient: the function under test
 *   has a single side effect (the `console.log` call) and no return value,
 *   so a single call + spy-introspection cycle covers the entire observable
 *   contract.
 *
 * Why we explicitly inspect the recorded `method` property (not just
 * `toContainEqual(payload)`):
 *   The Sub-AC wording — "correct event name AND selected method property"
 *   — calls out the method dimension by name. Asserting the inner property
 *   directly (`payload.method === 'kakao'`) pins the contract at the field
 *   level, so a future regression that strips the `method` field from the
 *   payload object (or renames it) fails this test even if the wrapper
 *   payload object itself still happens to be logged. This mirrors how
 *   `track-referral-shared.test.ts` covers the parallel `method`
 *   discriminator, just with explicit field-level introspection.
 *
 * Why `vi.spyOn(console, 'log').mockImplementation(() => undefined)`:
 *   Mirrors `tests/track-referral-shared.test.ts`,
 *   `tests/track-referral-skipped.test.ts`, and
 *   `tests/track-social-evolution-skipped.test.ts` (the sibling Sub-AC
 *   18.1 / 18.2 / 18.3 tests) and `tests/funnel-guards.test.ts`'s
 *   `console.warn` spies — the spy silences the placeholder log so
 *   vitest's output stays clean, while `.mock.calls[0]` still preserves
 *   the arguments for assertion.
 */
import type { MockInstance } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  trackPaymentMethodSelected,
  type TrackPaymentMethodSelectedPayload,
} from '../src/analytics/track-payment-method-selected';

describe('trackPaymentMethodSelected (Phase 2.4 placeholder, Sub-AC 18.4)', () => {
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

  it('console.logs the `payment_method_selected` event with the supplied method property', () => {
    // The explicit annotation forces the call site to satisfy
    // `TrackPaymentMethodSelectedPayload` — if Phase 2.5 widens or renames
    // the payload shape, this test fails at compile time rather than
    // silently logging a stale payload.
    const payload: TrackPaymentMethodSelectedPayload = { method: 'kakao' };

    trackPaymentMethodSelected(payload);

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
    expect(callArgs).toContain('payment_method_selected');
    expect(callArgs).toContainEqual(payload);

    // Field-level assertion: the recorded payload must carry the exact
    // `method` property the caller passed (Sub-AC 18.4: "selected method
    // property"). Searching `callArgs` for any object containing
    // `{ method: 'kakao' }` is robust against the call-format being either
    // `(prefix, name, payload)` or `(name, payload)` — both legitimate
    // placeholder shapes — without coupling the test to the prefix
    // position.
    const recordedPayload = callArgs.find(
      (arg): arg is TrackPaymentMethodSelectedPayload =>
        typeof arg === 'object' &&
        arg !== null &&
        'method' in arg,
    );
    expect(recordedPayload).toBeDefined();
    expect(recordedPayload?.method).toBe('kakao');
  });
});
