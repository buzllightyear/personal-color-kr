/**
 * Unit test — `apps/mobile/src/analytics/track-paywall-error.ts`
 * (Phase 2.6 — real PostHog `capture` wiring via client pass-through DI).
 *
 * Pins the post-Phase-2.6 contract for `trackPaywallError`:
 *
 *   1. **Happy path** — when a PostHog client is injected, the helper MUST
 *      invoke `posthog.capture(...)` exactly once with the snake_case event
 *      name literal `paywall_error` (sourced via the
 *      {@link PAYWALL_ERROR_EVENT_NAME} constant) AND the structured error
 *      payload (`placement` + `errorMessage`) the caller passed.
 *
 *   2. **Degraded mode (AC 11)** — when the injected client is `undefined`,
 *      the helper MUST silently no-op: `capture` is not invoked (call count
 *      === 0), no throw is propagated, and no console channel emits output.
 *
 * Why a dedicated test file (sibling to the four Phase 2.4 rewrites):
 *   The `paywall_error` event was introduced in Phase 2.5 alongside the
 *   Superwall paywall trigger (AC 16). The seed contract "2 new test files
 *   created for track-payment-skipped and track-paywall-error" pins this
 *   file as part of the Phase 2.6 wiring deliverable.
 *
 * Why the happy-path payload uses placement `'payment_model_unlock'`:
 *   Phase 2.5 ships exactly one Superwall placement, defined in
 *   `src/superwall/placements.ts` as the `'payment_model_unlock'` literal.
 *   The `SuperwallPlacement` union narrows the payload's `placement` field
 *   so unregistered placements fail at compile time, which the test
 *   structurally exercises by passing the only legal value.
 *
 * Why `errorMessage` is the user-facing Korean copy (not the raw native
 * exception):
 *   Per the Seed constraint "User-friendly Korean inline error text shown on
 *   SuperwallTriggerError", the event captures exactly the string the user
 *   saw — not the underlying native SDK exception (which may embed PII /
 *   transaction tokens). This test fixes a representative Korean copy
 *   variant so a regression that swaps the analytics surface to the raw
 *   exception text fails the assertion.
 */
import type { PostHog } from 'posthog-react-native';
import type { MockInstance } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PAYWALL_ERROR_EVENT_NAME,
  trackPaywallError,
  type TrackPaywallErrorPayload,
} from '../src/analytics/track-paywall-error';

describe('trackPaywallError (Phase 2.6 — real PostHog capture wiring)', () => {
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

  it('captures `paywall_error` with the supplied payload when posthog is present', () => {
    const payload: TrackPaywallErrorPayload = {
      placement: 'payment_model_unlock',
      errorMessage: '결제를 시작할 수 없습니다. 잠시 후 다시 시도해주세요.',
    };

    trackPaywallError(stubPostHog, payload);

    expect(captureFn).toHaveBeenCalledTimes(1);
    expect(captureFn).toHaveBeenCalledWith(PAYWALL_ERROR_EVENT_NAME, payload);
    expect(PAYWALL_ERROR_EVENT_NAME).toBe('paywall_error');
  });

  it('silently no-ops when posthog is undefined (degraded mode — AC 11)', () => {
    const payload: TrackPaywallErrorPayload = {
      placement: 'payment_model_unlock',
      errorMessage: '결제를 시작할 수 없습니다. 잠시 후 다시 시도해주세요.',
    };

    expect(() => trackPaywallError(undefined, payload)).not.toThrow();

    expect(captureFn).not.toHaveBeenCalled();
    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(consoleWarnSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });
});
