/**
 * Unit test — `apps/mobile/src/analytics/track-post-payment-tab-viewed.ts`
 * (Phase 3.3 Sub-AC 13.2).
 */
import type { PostHog } from 'posthog-react-native';
import type { MockInstance } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  POST_PAYMENT_TAB_VIEWED_EVENT_NAME,
  trackPostPaymentTabViewed,
  type TrackPostPaymentTabViewedPayload,
} from '../src/analytics/track-post-payment-tab-viewed';

describe('trackPostPaymentTabViewed (Phase 3.3 — Sub-AC 13.2)', () => {
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
    expect(POST_PAYMENT_TAB_VIEWED_EVENT_NAME).toBe('post_payment_tab_viewed');
  });

  it('invokes capture once with the event name and payload (happy path)', () => {
    const payload: TrackPostPaymentTabViewedPayload = { tab: 'edit' };

    trackPostPaymentTabViewed(stubPostHog, payload);

    expect(captureFn).toHaveBeenCalledTimes(1);
    expect(captureFn).toHaveBeenCalledWith(POST_PAYMENT_TAB_VIEWED_EVENT_NAME, {
      tab: 'edit',
    });
  });

  it('silently no-ops in degraded mode (posthog === undefined)', () => {
    expect(() => trackPostPaymentTabViewed(undefined, { tab: 'guide' })).not.toThrow();

    expect(captureFn).not.toHaveBeenCalled();
    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(consoleWarnSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('covers all 4 tabs without type error', () => {
    const tabs: TrackPostPaymentTabViewedPayload['tab'][] = [
      'edit',
      'diagnosis',
      'guide',
      'curation',
    ];

    for (const tab of tabs) {
      trackPostPaymentTabViewed(stubPostHog, { tab });
    }

    expect(captureFn).toHaveBeenCalledTimes(4);
  });
});
