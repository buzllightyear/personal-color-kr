/**
 * Unit test — `requestStoreReview` helper, `isAvailableAsync()` THROW path
 * (`src/store-review/request-store-review.ts`).
 *
 * Single contract pinned by this file (the error-resilience AC):
 *   "Helper catches and swallows `isAvailableAsync()` exceptions, returning
 *    `{ attempted: false, available: false, platform }` and never dispatching
 *    `requestReview()`."
 *
 *   A misconfigured build (missing native module), a transient native bridge
 *   failure, or any other fault in the availability probe MUST be contained
 *   entirely inside the helper. The contract that depends on this:
 *     - The returned promise RESOLVES — it never rejects, so the rating-gate
 *       route's `void requestStoreReview().then(...)` is safe without a
 *       `.catch`, and navigation to `fake-loader` is never blocked.
 *     - `requestReview()` is NEVER dispatched once the probe has failed (there
 *       is nothing to attempt on an unknown-availability surface).
 *     - The outcome is structurally complete: `available` is forced to `false`
 *       and `platform` is still the narrowed value captured before the probe,
 *       so the `rating_prompt_completed` analytics payload stays well-formed
 *       even on the degraded path.
 *
 * Isolation boundary (Seed constraint):
 *   The helper's OWN tests mock the native module (`expo-store-review`)
 *   directly — route-level tests instead mock THIS helper. This file therefore
 *   drives the throw via the native spy, exercising the REAL helper
 *   implementation end-to-end.
 *
 * Both failure modes of the probe are covered:
 *   - an ASYNC rejection (`mockRejectedValue`), and
 *   - a SYNCHRONOUS throw (`mockImplementation(() => { throw })`),
 *   because the helper awaits the probe inside a single try/catch and must
 *   contain either shape identically.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted native-SDK spies. Declared via `vi.hoisted` so the `vi.mock` factory
// (itself hoisted above the SUT import) can close over them and each test can
// drive a specific throw shape. `requestReview` is a spy purely to assert it
// is NEVER invoked on the throw path.
// ---------------------------------------------------------------------------
const storeReviewSpies = vi.hoisted(() => ({
  isAvailableAsync: vi.fn<[], Promise<boolean>>(),
  requestReview: vi.fn<[], Promise<void>>(),
}));

vi.mock('expo-store-review', () => ({
  isAvailableAsync: storeReviewSpies.isAvailableAsync,
  requestReview: storeReviewSpies.requestReview,
}));

// Mutable platform holder so each case can pin `Platform.OS`. The helper reads
// `Platform.OS` lazily at call time, so reassigning this between cases is
// observed on the next `requestStoreReview()` invocation.
const platformHolder = vi.hoisted(() => ({ os: 'ios' as string }));

vi.mock('react-native', () => ({
  get Platform() {
    return {
      get OS() {
        return platformHolder.os;
      },
    };
  },
}));

import { requestStoreReview } from '../src/store-review/request-store-review';

describe('requestStoreReview — isAvailableAsync() throw path (error resilience)', () => {
  beforeEach(() => {
    storeReviewSpies.isAvailableAsync.mockReset();
    storeReviewSpies.requestReview.mockReset();
    platformHolder.os = 'ios';
  });

  it('swallows an ASYNC probe rejection and resolves a degraded outcome', async () => {
    storeReviewSpies.isAvailableAsync.mockRejectedValue(
      new Error('native module missing'),
    );

    const outcome = await requestStoreReview();

    // requestReview must NOT have been dispatched — availability is unknown.
    expect(storeReviewSpies.requestReview).not.toHaveBeenCalled();
    // Exactly the degraded, structurally-complete outcome.
    expect(outcome).toEqual({
      attempted: false,
      available: false,
      platform: 'ios',
    });
  });

  it('swallows a SYNCHRONOUS probe throw and resolves a degraded outcome', async () => {
    storeReviewSpies.isAvailableAsync.mockImplementation(() => {
      throw new Error('synchronous native probe boom');
    });

    const outcome = await requestStoreReview();

    expect(storeReviewSpies.isAvailableAsync).toHaveBeenCalledTimes(1);
    expect(storeReviewSpies.requestReview).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      attempted: false,
      available: false,
      platform: 'ios',
    });
  });

  it('NEVER rejects — the returned promise resolves on the throw path', async () => {
    storeReviewSpies.isAvailableAsync.mockRejectedValue(
      new Error('probe exploded'),
    );

    // `.resolves` asserts the promise settles fulfilled; if the helper let the
    // rejection propagate this assertion would fail. This is the load-bearing
    // guarantee the rating-gate route relies on (no `.catch`, navigation never
    // blocked).
    await expect(requestStoreReview()).resolves.toEqual({
      attempted: false,
      available: false,
      platform: 'ios',
    });
  });

  it('forces available=false even though the probe never returned a boolean', async () => {
    storeReviewSpies.isAvailableAsync.mockRejectedValue(new Error('boom'));

    const outcome = await requestStoreReview();

    // The probe resolved neither true nor false, yet `available` is a hard
    // `false` (not `undefined`) so the analytics dimension stays clean.
    expect(outcome.available).toBe(false);
    expect(typeof outcome.available).toBe('boolean');
    expect(outcome.attempted).toBe(false);
  });

  it('preserves the narrowed platform on the throw path (android)', async () => {
    platformHolder.os = 'android';
    storeReviewSpies.isAvailableAsync.mockRejectedValue(new Error('boom'));

    const outcome = await requestStoreReview();

    expect(outcome).toEqual({
      attempted: false,
      available: false,
      platform: 'android',
    });
  });

  it('preserves the narrowed platform on the throw path (other / web)', async () => {
    platformHolder.os = 'web';
    storeReviewSpies.isAvailableAsync.mockRejectedValue(new Error('boom'));

    const outcome = await requestStoreReview();

    expect(outcome).toEqual({
      attempted: false,
      available: false,
      platform: 'other',
    });
  });
});
