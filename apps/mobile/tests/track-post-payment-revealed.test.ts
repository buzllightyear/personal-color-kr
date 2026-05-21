/**
 * Unit test — `apps/mobile/src/analytics/track-post-payment-revealed.ts`
 * (Phase 3.3 Sub-AC 13.1).
 *
 * Pins the same DI contract as `track-referral-shared.test.ts`:
 *   1. Happy path — calls `posthog.capture(POST_PAYMENT_REVEALED_EVENT_NAME, { ...payload })`
 *      exactly once with the snake_case literal and the structured payload.
 *   2. Degraded mode (posthog === undefined) — silent no-op, no throw, no console output.
 *   3. EVENT_NAME constant matches the wire-format literal verbatim.
 */
import type { PostHog } from 'posthog-react-native';
import type { MockInstance } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  POST_PAYMENT_REVEALED_EVENT_NAME,
  trackPostPaymentRevealed,
  type TrackPostPaymentRevealedPayload,
} from '../src/analytics/track-post-payment-revealed';

describe('trackPostPaymentRevealed (Phase 3.3 — Sub-AC 13.1)', () => {
  const captureFn = vi.fn();
  const stubPostHog = { capture: captureFn } as unknown as PostHog;
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

  it('pins the event-name constant to the snake_case wire literal', () => {
    expect(POST_PAYMENT_REVEALED_EVENT_NAME).toBe('post_payment_revealed');
  });

  it('invokes capture once with the event name and payload (happy path)', () => {
    const payload: TrackPostPaymentRevealedPayload = { season: 'summer-cool' };

    trackPostPaymentRevealed(stubPostHog, payload);

    expect(captureFn).toHaveBeenCalledTimes(1);
    expect(captureFn).toHaveBeenCalledWith(POST_PAYMENT_REVEALED_EVENT_NAME, {
      season: 'summer-cool',
    });
  });

  it('silently no-ops in degraded mode (posthog === undefined)', () => {
    expect(() =>
      trackPostPaymentRevealed(undefined, { season: 'winter-cool' }),
    ).not.toThrow();

    expect(captureFn).not.toHaveBeenCalled();
    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(consoleWarnSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('covers all 4 Season values without type error', () => {
    const seasons: TrackPostPaymentRevealedPayload['season'][] = [
      'spring-warm',
      'summer-cool',
      'autumn-warm',
      'winter-cool',
    ];

    for (const season of seasons) {
      trackPostPaymentRevealed(stubPostHog, { season });
    }

    expect(captureFn).toHaveBeenCalledTimes(4);
  });
});
