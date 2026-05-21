/**
 * Unit test — `apps/mobile/src/analytics/track-tone-switched.ts`
 * (Phase 3.3 Sub-AC 13.3).
 */
import type { PostHog } from 'posthog-react-native';
import type { MockInstance } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  TONE_SWITCHED_EVENT_NAME,
  trackToneSwitched,
  type TrackToneSwitchedPayload,
} from '../src/analytics/track-tone-switched';

describe('trackToneSwitched (Phase 3.3 — Sub-AC 13.3)', () => {
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
    expect(TONE_SWITCHED_EVENT_NAME).toBe('tone_switched');
  });

  it('invokes capture once with the event name and payload (happy path)', () => {
    const payload: TrackToneSwitchedPayload = {
      from: 'summer-cool',
      to: 'autumn-warm',
    };

    trackToneSwitched(stubPostHog, payload);

    expect(captureFn).toHaveBeenCalledTimes(1);
    expect(captureFn).toHaveBeenCalledWith(TONE_SWITCHED_EVENT_NAME, {
      from: 'summer-cool',
      to: 'autumn-warm',
    });
  });

  it('silently no-ops in degraded mode (posthog === undefined)', () => {
    expect(() =>
      trackToneSwitched(undefined, { from: 'spring-warm', to: 'winter-cool' }),
    ).not.toThrow();

    expect(captureFn).not.toHaveBeenCalled();
    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(consoleWarnSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });
});
