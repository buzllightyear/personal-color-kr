/**
 * Unit test — `apps/mobile/src/analytics/track-post-payment-content-engaged.ts`
 * (Phase 3.3 Sub-AC 13.4).
 */
import type { PostHog } from 'posthog-react-native';
import type { MockInstance } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  POST_PAYMENT_CONTENT_ENGAGED_EVENT_NAME,
  trackPostPaymentContentEngaged,
  type TrackPostPaymentContentEngagedPayload,
} from '../src/analytics/track-post-payment-content-engaged';

describe('trackPostPaymentContentEngaged (Phase 3.3 — Sub-AC 13.4)', () => {
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
    expect(POST_PAYMENT_CONTENT_ENGAGED_EVENT_NAME).toBe(
      'post_payment_content_engaged',
    );
  });

  it('invokes capture once with the event name and payload (happy path)', () => {
    const payload: TrackPostPaymentContentEngagedPayload = {
      tab: 'guide',
      action: 'tile_opened',
    };

    trackPostPaymentContentEngaged(stubPostHog, payload);

    expect(captureFn).toHaveBeenCalledTimes(1);
    expect(captureFn).toHaveBeenCalledWith(POST_PAYMENT_CONTENT_ENGAGED_EVENT_NAME, {
      tab: 'guide',
      action: 'tile_opened',
    });
  });

  it('silently no-ops in degraded mode (posthog === undefined)', () => {
    expect(() =>
      trackPostPaymentContentEngaged(undefined, {
        tab: 'curation',
        action: 'item_tapped',
      }),
    ).not.toThrow();

    expect(captureFn).not.toHaveBeenCalled();
    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(consoleWarnSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('accepts free-form action strings while keeping tab closed-enum', () => {
    trackPostPaymentContentEngaged(stubPostHog, {
      tab: 'edit',
      action: 'cta_pressed',
    });
    trackPostPaymentContentEngaged(stubPostHog, {
      tab: 'edit',
      action: 'preview_zoomed',
    });

    expect(captureFn).toHaveBeenCalledTimes(2);
  });
});
