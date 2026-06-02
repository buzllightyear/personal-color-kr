/**
 * Unit test — `apps/mobile/src/analytics/track-rating-prompt-completed.ts`
 * (store-review wiring — real PostHog `capture` via client pass-through DI).
 *
 * Pins the analytics contract for the rating-gate submit CTA:
 *
 *   1. **Happy path** — when a PostHog client is injected, the helper MUST
 *      invoke `posthog.capture(...)` exactly once with the snake_case event
 *      name literal `rating_prompt_completed` (sourced via the
 *      {@link RATING_PROMPT_COMPLETED_EVENT_NAME} constant so a rename catches
 *      at compile time) AND the `{ attempted, available, platform }` payload
 *      the caller passed (the `requestStoreReview` outcome).
 *
 *   2. **Degraded mode** — when the injected client is `undefined`, the helper
 *      MUST silently no-op: `capture` is not invoked (call count === 0), no
 *      throw is propagated, and no console channel emits output.
 *
 * Mirrors the structural shape of `tests/track-referral-skipped.test.ts` so the
 * analytics helpers stay reviewable side-by-side under a uniform test pattern.
 */
import type { PostHog } from 'posthog-react-native';
import type { MockInstance } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RATING_PROMPT_COMPLETED_EVENT_NAME,
  trackRatingPromptCompleted,
  type TrackRatingPromptCompletedPayload,
} from '../src/analytics/track-rating-prompt-completed';

describe('trackRatingPromptCompleted (store-review submit analytics)', () => {
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

  it('captures `rating_prompt_completed` with {attempted, available, platform} when posthog is present', () => {
    const payload: TrackRatingPromptCompletedPayload = {
      attempted: true,
      available: true,
      platform: 'ios',
    };

    trackRatingPromptCompleted(stubPostHog, payload);

    expect(captureFn).toHaveBeenCalledTimes(1);
    expect(captureFn).toHaveBeenCalledWith(
      RATING_PROMPT_COMPLETED_EVENT_NAME,
      expect.objectContaining({
        attempted: true,
        available: true,
        platform: 'ios',
      }),
    );
    expect(RATING_PROMPT_COMPLETED_EVENT_NAME).toBe('rating_prompt_completed');
  });

  it('forwards the unavailable/not-attempted outcome verbatim (android)', () => {
    const payload: TrackRatingPromptCompletedPayload = {
      attempted: false,
      available: false,
      platform: 'android',
    };

    trackRatingPromptCompleted(stubPostHog, payload);

    expect(captureFn).toHaveBeenCalledTimes(1);
    expect(captureFn).toHaveBeenCalledWith(
      RATING_PROMPT_COMPLETED_EVENT_NAME,
      expect.objectContaining({
        attempted: false,
        available: false,
        platform: 'android',
      }),
    );
  });

  it('silently no-ops when posthog is undefined (degraded mode)', () => {
    const payload: TrackRatingPromptCompletedPayload = {
      attempted: true,
      available: true,
      platform: 'other',
    };

    expect(() => trackRatingPromptCompleted(undefined, payload)).not.toThrow();

    expect(captureFn).not.toHaveBeenCalled();
    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(consoleWarnSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });
});
