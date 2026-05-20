/**
 * Unit test — `apps/mobile/src/analytics/track-referral-shared.ts`
 * (Phase 2.6 — real PostHog `capture` wiring via client pass-through DI).
 *
 * Pins the post-Phase-2.6 contract for `trackReferralShared`:
 *
 *   1. **Happy path** — when a PostHog client is injected, the helper MUST
 *      invoke `posthog.capture(...)` exactly once with the snake_case event
 *      name literal `referral_shared` (sourced via the
 *      {@link REFERRAL_SHARED_EVENT_NAME} constant so a rename catches at
 *      compile time) AND the structured payload object the caller passed.
 *
 *   2. **Degraded mode (AC 11)** — when the injected client is `undefined`
 *      (the onboarding-degraded path established in
 *      `src/providers/PostHogProvider.tsx` when `posthogApiKey` is missing
 *      from `expoConfig.extra`), the helper MUST silently no-op:
 *        - `capture` MUST NOT be invoked (call count === 0).
 *        - The helper MUST NOT throw.
 *        - The helper MUST NOT fall back to `console.log` / `console.warn` /
 *          `console.error` (the Phase-2.4 placeholder logger is fully retired
 *          per the Seed constraint "zero residual console.log/TODO(phase-2.6)").
 *
 * Why a stub `{ capture: vi.fn() }` rather than the real PostHog class:
 *   The helper accepts the client by parameter (DI), so the test does not
 *   need to mock the `posthog-react-native` module at all — it just supplies
 *   a duck-typed stub satisfying the `Pick<PostHog, 'capture'>` shape the
 *   helper uses. This mirrors the `captureFn = vi.fn()` recorder pattern
 *   already established by `tests/funnel-step-entered-capture.test.tsx` for
 *   the Phase 2.2 root-layout auto-capture.
 *
 * Why the degraded-mode test cast (`as unknown as PostHog`) is unnecessary:
 *   The helper signature accepts `PostHog | undefined`, so `undefined` is a
 *   direct literal — no cast required. This keeps the assertion explicit:
 *   the degraded-mode path is the literal-undefined branch, not a partial
 *   or null stub.
 */
import type { PostHog } from 'posthog-react-native';
import type { MockInstance } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  REFERRAL_SHARED_EVENT_NAME,
  trackReferralShared,
  type TrackReferralSharedPayload,
} from '../src/analytics/track-referral-shared';

describe('trackReferralShared (Phase 2.6 — real PostHog capture wiring)', () => {
  // PostHog `capture` recorder. `vi.fn()` returns a strongly-typed Mock with
  // `.mock.calls` introspection — the helper hands it the event-name string
  // and the payload object as the only two arguments.
  const captureFn = vi.fn();
  // Stub posthog client — only the `capture` method is exercised by the
  // helper, so a `Pick<PostHog, 'capture'>` shape suffices. Cast through
  // `unknown` to satisfy the full `PostHog` parameter type without pulling
  // in the SDK's heavy class shape.
  const stubPostHog = { capture: captureFn } as unknown as PostHog;
  // Console spies prove the Phase-2.4 placeholder logger has been fully
  // retired — degraded mode in particular must produce zero console output.
  // Use vitest's `MockInstance` without generics to sidestep React Native's
  // override of the global `console` type (which does not expose 'log' /
  // 'warn' / 'error' as method names that `ReturnType<typeof vi.spyOn<...>>`
  // can constrain). The `.toHaveBeenCalled` / `.mockRestore` assertions used
  // below come from the assertion / mock interfaces themselves, so the
  // unconstrained `MockInstance` annotation is sufficient.
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

  it('captures `referral_shared` with the supplied payload when posthog is present', () => {
    const payload: TrackReferralSharedPayload = { method: 'kakao' };

    trackReferralShared(stubPostHog, payload);

    // Single side effect: exactly one capture call with the snake_case
    // event-name constant and the structured payload. The constant import
    // (rather than a duplicated string literal) ensures a rename of
    // `REFERRAL_SHARED_EVENT_NAME` is caught at compile time.
    expect(captureFn).toHaveBeenCalledTimes(1);
    expect(captureFn).toHaveBeenCalledWith(REFERRAL_SHARED_EVENT_NAME, payload);
    expect(REFERRAL_SHARED_EVENT_NAME).toBe('referral_shared');
  });

  it('silently no-ops when posthog is undefined (degraded mode — AC 11)', () => {
    const payload: TrackReferralSharedPayload = { method: 'copy_link' };

    // Degraded mode invariant: the helper must NOT throw when the injected
    // client is undefined. Wrapping the call in an arrow lets vitest assert
    // the absence-of-throw without swallowing a real exception via try/catch.
    expect(() => trackReferralShared(undefined, payload)).not.toThrow();

    // Capture call count MUST be exactly 0 in degraded mode — the helper's
    // `posthog?.capture(...)` optional-chain guard short-circuits to
    // `undefined` and never invokes the recorder. This invariant pins the
    // Seed constraint "Degraded mode posthog undefined must produce silent
    // no-op — no throw no console.log capture called 0 times".
    expect(captureFn).not.toHaveBeenCalled();
    // The Phase 2.4 placeholder logger is fully retired — degraded mode
    // emits nothing on any console channel.
    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(consoleWarnSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });
});
