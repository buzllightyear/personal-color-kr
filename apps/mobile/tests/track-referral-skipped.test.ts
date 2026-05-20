/**
 * Unit test — `apps/mobile/src/analytics/track-referral-skipped.ts`
 * (Phase 2.6 — real PostHog `capture` wiring via client pass-through DI).
 *
 * Pins the post-Phase-2.6 contract for `trackReferralSkipped`:
 *
 *   1. **Happy path** — when a PostHog client is injected, the helper MUST
 *      invoke `posthog.capture(...)` exactly once with the snake_case event
 *      name literal `referral_skipped` (sourced via the
 *      {@link REFERRAL_SKIPPED_EVENT_NAME} constant so a rename catches at
 *      compile time) AND the empty-object payload the caller passed.
 *
 *   2. **Degraded mode (AC 11)** — when the injected client is `undefined`,
 *      the helper MUST silently no-op: `capture` is not invoked (call count
 *      === 0), no throw is propagated, and no console channel emits output.
 *
 * Mirrors the structural shape of `tests/track-referral-shared.test.ts` so
 * the six analytics helpers (referral_shared, referral_skipped,
 * social_evolution_skipped, payment_completed, payment_skipped,
 * paywall_error) stay reviewable side-by-side under a uniform test pattern.
 */
import type { PostHog } from 'posthog-react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  REFERRAL_SKIPPED_EVENT_NAME,
  trackReferralSkipped,
  type TrackReferralSkippedPayload,
} from '../src/analytics/track-referral-skipped';

describe('trackReferralSkipped (Phase 2.6 — real PostHog capture wiring)', () => {
  const captureFn = vi.fn();
  const stubPostHog = { capture: captureFn } as unknown as PostHog;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

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

  it('captures `referral_skipped` with the supplied payload when posthog is present', () => {
    // `TrackReferralSkippedPayload` resolves to `Record<string, never>` so
    // `{}` is the only value the type permits. The explicit annotation
    // forces a Phase-2.7+ payload widening to revisit this call site.
    const payload: TrackReferralSkippedPayload = {};

    trackReferralSkipped(stubPostHog, payload);

    expect(captureFn).toHaveBeenCalledTimes(1);
    expect(captureFn).toHaveBeenCalledWith(REFERRAL_SKIPPED_EVENT_NAME, payload);
    expect(REFERRAL_SKIPPED_EVENT_NAME).toBe('referral_skipped');
  });

  it('silently no-ops when posthog is undefined (degraded mode — AC 11)', () => {
    const payload: TrackReferralSkippedPayload = {};

    expect(() => trackReferralSkipped(undefined, payload)).not.toThrow();

    // Capture call count MUST be exactly 0 in degraded mode — the helper's
    // `posthog?.capture(...)` optional-chain guard short-circuits to
    // `undefined` and never invokes the recorder.
    expect(captureFn).not.toHaveBeenCalled();
    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(consoleWarnSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });
});
