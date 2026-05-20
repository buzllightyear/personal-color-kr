/**
 * Unit test — `apps/mobile/src/analytics/track-payment-completed.ts`
 * (Phase 2.6 — real PostHog `capture` wiring via client pass-through DI).
 *
 * Pins the post-Phase-2.6 contract for `trackPaymentCompleted`:
 *
 *   1. **Happy path** — when a PostHog client is injected, the helper MUST
 *      invoke `posthog.capture(...)` exactly once with the snake_case event
 *      name literal `payment_completed` (sourced via the
 *      {@link PAYMENT_COMPLETED_EVENT_NAME} constant) AND the structured
 *      transaction payload (`method` + `amountKrw` + optional `restored`)
 *      the caller passed.
 *
 *   2. **Degraded mode (AC 11)** — when the injected client is `undefined`,
 *      the helper MUST silently no-op: `capture` is not invoked (call count
 *      === 0), no throw is propagated, and no console channel emits output.
 *
 * Why the happy-path payload includes `method: 'kakao'` and `restored: false`:
 *   The `method` field is intentionally retained as required (not optional)
 *   in Phase 2.5 for forward-compat with Phase 2.4 KakaoPay placeholder
 *   call-sites; the Superwall purchased-path call-site passes a sentinel
 *   `'kakao'` value (per the Seed warning "Phase 2.5 Superwall callers must
 *   still pass a sentinel PaymentMethod value"). `restored: false` exercises
 *   the explicit purchased-path discriminant established in Phase 2.5 Sub-AC
 *   18, distinguishing fresh purchases from re-attached subscriptions.
 */
import type { PostHog } from 'posthog-react-native';
import type { MockInstance } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PAYMENT_COMPLETED_EVENT_NAME,
  trackPaymentCompleted,
  type TrackPaymentCompletedPayload,
} from '../src/analytics/track-payment-completed';

describe('trackPaymentCompleted (Phase 2.6 — real PostHog capture wiring)', () => {
  const captureFn = vi.fn();
  const stubPostHog = { capture: captureFn } as unknown as PostHog;
  // See track-referral-shared.test.ts for the rationale on using the
  // un-constrained vitest `MockInstance` annotation.
  let consoleLogSpy: MockInstance;
  let consoleWarnSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  beforeEach(() => {
    captureFn.mockReset();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('captures `payment_completed` with the supplied transaction payload when posthog is present', () => {
    // Literal `9900` matches `PAYMENT_AMOUNT_KRW` (the hardcoded ₩9,900
    // one-time unlock price) without importing the constant — intentionally
    // decoupled so a future price tweak does not cascade-break this
    // analytics contract test. PII fields (transaction_id, receipt_token,
    // customer_email) are structurally absent from the payload type, per the
    // Seed constraint "PII absolutely prohibited in event payloads".
    const payload: TrackPaymentCompletedPayload = {
      method: 'kakao',
      amountKrw: 9900,
      restored: false,
    };

    trackPaymentCompleted(stubPostHog, payload);

    expect(captureFn).toHaveBeenCalledTimes(1);
    expect(captureFn).toHaveBeenCalledWith(PAYMENT_COMPLETED_EVENT_NAME, payload);
    expect(PAYMENT_COMPLETED_EVENT_NAME).toBe('payment_completed');
  });

  it('silently no-ops when posthog is undefined (degraded mode — AC 11)', () => {
    const payload: TrackPaymentCompletedPayload = {
      method: 'kakao',
      amountKrw: 9900,
      restored: false,
    };

    expect(() => trackPaymentCompleted(undefined, payload)).not.toThrow();

    expect(captureFn).not.toHaveBeenCalled();
    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(consoleWarnSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });
});
