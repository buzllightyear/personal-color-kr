/**
 * Unit test — `requestStoreReview` helper (store-review native seam).
 *
 * Scope:
 *   Exercises the REAL implementation exported from
 *   `apps/mobile/src/store-review/request-store-review.ts`. Per the Seed
 *   isolation boundary, the helper's OWN tests mock the native module
 *   (`expo-store-review`) directly — route-level tests instead mock this
 *   helper. This file therefore owns the contract for how the helper
 *   translates the SDK's `isAvailableAsync()` / `requestReview()` surface
 *   into the {@link StoreReviewOutcome} and how it enforces the
 *   fire-and-forget + error-swallowing guarantees.
 *
 * Branches under test:
 *   1. available=true  → requestReview() dispatched, outcome
 *                        `{ attempted: true, available: true, platform }`.
 *   2. available=false → requestReview() NOT called, outcome
 *                        `{ attempted: false, available: false, platform }`.
 *   3. isAvailableAsync() throws → swallowed, requestReview() NOT called,
 *                        outcome `{ attempted: false, available: false }`.
 *   4. requestReview() rejects asynchronously → swallowed, helper still
 *                        resolves `{ attempted: true }` and never rejects.
 *   5. platform narrowing → Platform.OS mapped to ios | android | other.
 *
 * Mocking strategy:
 *   - `vi.mock('expo-store-review', ...)` replaces the native package with
 *     hoisted spies so vitest never resolves the native module.
 *   - `vi.mock('react-native', ...)` supplies a mutable `Platform.OS` so the
 *     platform-narrowing branch can be driven per case. The helper reads
 *     `Platform.OS` at call time, so mutating the mock between cases works
 *     without re-importing the helper.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted spies for the native SDK surface. Declared via vi.hoisted so the
// vi.mock factory below can close over them and each test can drive a
// specific availability / dispatch path.
// ---------------------------------------------------------------------------
const storeReviewSpies = vi.hoisted(() => ({
  isAvailableAsync: vi.fn<[], Promise<boolean>>(),
  requestReview: vi.fn<[], Promise<void>>(),
}));

vi.mock('expo-store-review', () => ({
  isAvailableAsync: storeReviewSpies.isAvailableAsync,
  requestReview: storeReviewSpies.requestReview,
}));

// Mutable platform holder so each test can pin Platform.OS. The helper reads
// `Platform.OS` lazily inside `requestStoreReview`, so reassigning this
// between cases is observed on the next call.
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

describe('requestStoreReview — available=true path', () => {
  beforeEach(() => {
    storeReviewSpies.isAvailableAsync.mockReset();
    storeReviewSpies.requestReview.mockReset();
    platformHolder.os = 'ios';
  });

  it('dispatches requestReview() and returns attempted+available true', async () => {
    storeReviewSpies.isAvailableAsync.mockResolvedValue(true);
    storeReviewSpies.requestReview.mockResolvedValue(undefined);

    const outcome = await requestStoreReview();

    expect(storeReviewSpies.isAvailableAsync).toHaveBeenCalledTimes(1);
    // requestReview is dispatched synchronously during the helper call, so it
    // has already been invoked by the time the helper's promise resolves.
    expect(storeReviewSpies.requestReview).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({
      attempted: true,
      available: true,
      platform: 'ios',
    });
  });

  it('checks availability BEFORE dispatching requestReview()', async () => {
    const callOrder: string[] = [];
    storeReviewSpies.isAvailableAsync.mockImplementation(async () => {
      callOrder.push('isAvailableAsync');
      return true;
    });
    storeReviewSpies.requestReview.mockImplementation(async () => {
      callOrder.push('requestReview');
    });

    await requestStoreReview();

    expect(callOrder).toEqual(['isAvailableAsync', 'requestReview']);
  });
});

describe('requestStoreReview — available=false path', () => {
  beforeEach(() => {
    storeReviewSpies.isAvailableAsync.mockReset();
    storeReviewSpies.requestReview.mockReset();
    platformHolder.os = 'android';
  });

  it('does NOT dispatch requestReview() and reports unavailable', async () => {
    storeReviewSpies.isAvailableAsync.mockResolvedValue(false);

    const outcome = await requestStoreReview();

    expect(storeReviewSpies.isAvailableAsync).toHaveBeenCalledTimes(1);
    expect(storeReviewSpies.requestReview).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      attempted: false,
      available: false,
      platform: 'android',
    });
  });
});

describe('requestStoreReview — isAvailableAsync throws path', () => {
  beforeEach(() => {
    storeReviewSpies.isAvailableAsync.mockReset();
    storeReviewSpies.requestReview.mockReset();
    platformHolder.os = 'ios';
  });

  it('swallows the error, skips dispatch, and reports unavailable', async () => {
    storeReviewSpies.isAvailableAsync.mockRejectedValue(new Error('native probe boom'));

    // The helper must NOT reject — it resolves a well-formed outcome.
    const outcome = await requestStoreReview();

    expect(storeReviewSpies.requestReview).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      attempted: false,
      available: false,
      platform: 'ios',
    });
  });
});

describe('requestStoreReview — fire-and-forget rejection resilience', () => {
  beforeEach(() => {
    storeReviewSpies.isAvailableAsync.mockReset();
    storeReviewSpies.requestReview.mockReset();
    platformHolder.os = 'ios';
  });

  it('swallows an async requestReview() rejection and still resolves attempted=true', async () => {
    storeReviewSpies.isAvailableAsync.mockResolvedValue(true);
    storeReviewSpies.requestReview.mockRejectedValue(
      new Error('prompt present failed'),
    );

    const outcome = await requestStoreReview();

    expect(storeReviewSpies.requestReview).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({
      attempted: true,
      available: true,
      platform: 'ios',
    });
    // Flush the detached rejection handler microtask so no unhandled
    // rejection leaks into the next test.
    await Promise.resolve();
  });

  it('swallows a synchronous requestReview() throw and still resolves attempted=true', async () => {
    storeReviewSpies.isAvailableAsync.mockResolvedValue(true);
    storeReviewSpies.requestReview.mockImplementation(() => {
      throw new Error('sync boom');
    });

    const outcome = await requestStoreReview();

    expect(storeReviewSpies.requestReview).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({
      attempted: true,
      available: true,
      platform: 'ios',
    });
  });
});

describe('requestStoreReview — platform narrowing', () => {
  beforeEach(() => {
    storeReviewSpies.isAvailableAsync.mockReset();
    storeReviewSpies.requestReview.mockReset();
    storeReviewSpies.isAvailableAsync.mockResolvedValue(false);
  });

  afterEach(() => {
    platformHolder.os = 'ios';
  });

  it('maps Platform.OS "ios" to platform "ios"', async () => {
    platformHolder.os = 'ios';
    const outcome = await requestStoreReview();
    expect(outcome.platform).toBe('ios');
  });

  it('maps Platform.OS "android" to platform "android"', async () => {
    platformHolder.os = 'android';
    const outcome = await requestStoreReview();
    expect(outcome.platform).toBe('android');
  });

  it('maps any non-native Platform.OS (e.g. "web") to platform "other"', async () => {
    platformHolder.os = 'web';
    const outcome = await requestStoreReview();
    expect(outcome.platform).toBe('other');
  });
});
