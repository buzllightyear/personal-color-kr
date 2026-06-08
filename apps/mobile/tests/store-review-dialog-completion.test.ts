/**
 * Unit test — Sub-AC 14b-2
 * `requestStoreReview` helper: SKStoreReviewController call + dialog display
 * completion callback handling (success path).
 *
 * Seed AC:
 *   "StoreReview 요청 실행 및 성공 경로 — SKStoreReviewController(또는 StoreKit
 *    mock) 호출 후 다이얼로그 표시 완료 콜백 처리 단위 테스트"
 *
 * What this file pins (the three-part contract):
 *
 *   Part 1 — SKStoreReviewController is called:
 *     `expo-store-review.requestReview()` is invoked exactly once when
 *     `isAvailableAsync()` returns `true`. This is the StoreKit native call
 *     that triggers the iOS system review dialog. On Android the same call
 *     exercises the Play In-App Review path; the helper is cross-platform.
 *
 *   Part 2 — dialog display completion callback:
 *     The helper's returned promise (the "completion callback" the caller
 *     `.then`-chains) resolves with `{ attempted: true, available: true,
 *     platform }` after the `requestReview()` call is dispatched.  This
 *     resolution IS the observable completion signal for callers:
 *       `void requestStoreReview().then(outcome => trackRatingPromptCompleted(...))`
 *     iOS does not surface whether the dialog was actually shown
 *     (SKStoreReviewController is opaque / rate-limited); the `attempted: true`
 *     flag tells the caller that the dispatch was issued.
 *
 *   Part 3 — fire-and-forget timing (callback precedes dialog settle):
 *     The helper's promise resolves BEFORE the `requestReview()` dialog promise
 *     itself settles.  The caller's `.then` callback fires immediately after
 *     the availability probe resolves — not after the dialog lifecycle.  If
 *     the helper awaited the dialog promise, it would never resolve in tests
 *     that keep the dialog pending; the fact that the helper DOES resolve
 *     proves the invariant.
 *
 * Why a separate file from `request-store-review.test.ts`:
 *   That file owns the overall outcome-shape and error-resilience contracts
 *   (all branches of the helper). This file owns the focused dialog-completion-
 *   callback contract introduced in Sub-AC 14b-2 — specifically the TIMING
 *   relationship between the helper's completion signal and the underlying
 *   dialog promise lifecycle. Keeping them apart lets these timing assertions
 *   stand alone without cluttering the base contract suite.
 *
 * Isolation boundary (Seed constraint):
 *   The helper's OWN tests mock `expo-store-review` directly (the native SDK
 *   seam). Route-level tests instead mock this helper. This file exercises
 *   the REAL helper implementation against the `expo-store-review` mock.
 *
 * Mocking strategy (mirrors the sibling helper test):
 *   - `vi.mock('expo-store-review', ...)` replaces the native package with
 *     hoisted spies so vitest never resolves the native module.
 *   - `vi.mock('react-native', ...)` supplies a mutable `Platform.OS` so the
 *     platform-narrowing branch can be driven per case.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted spies for the native SDK surface.  Declared via vi.hoisted so the
// vi.mock factory below can close over them and each test can drive a specific
// path independently.
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

// ===========================================================================
// Part 1 — SKStoreReviewController is called
// ===========================================================================
describe('requestStoreReview — SKStoreReviewController call (Sub-AC 14b-2 Part 1)', () => {
  beforeEach(() => {
    storeReviewSpies.isAvailableAsync.mockReset();
    storeReviewSpies.requestReview.mockReset();
    platformHolder.os = 'ios';
  });

  it('calls requestReview() exactly once when isAvailableAsync() returns true', async () => {
    storeReviewSpies.isAvailableAsync.mockResolvedValue(true);
    storeReviewSpies.requestReview.mockResolvedValue(undefined);

    await requestStoreReview();

    expect(storeReviewSpies.requestReview).toHaveBeenCalledTimes(1);
  });

  it('calls requestReview() with no arguments (SKStoreReviewController signature)', async () => {
    storeReviewSpies.isAvailableAsync.mockResolvedValue(true);
    storeReviewSpies.requestReview.mockResolvedValue(undefined);

    await requestStoreReview();

    // `SKStoreReviewController.requestReview(in:)` / `expo-store-review.requestReview()`
    // takes no arguments. Confirm the call site passes nothing.
    expect(storeReviewSpies.requestReview).toHaveBeenCalledWith();
  });

  it('does NOT call requestReview() when isAvailableAsync() returns false', async () => {
    // Negative control: only a truthy availability triggers the SKStoreReviewController call.
    storeReviewSpies.isAvailableAsync.mockResolvedValue(false);

    await requestStoreReview();

    expect(storeReviewSpies.requestReview).not.toHaveBeenCalled();
  });

  it('calls requestReview() synchronously after the availability probe resolves', async () => {
    // The dispatch is synchronous inside the async helper — it runs in the same
    // microtask turn immediately after `await isAvailableAsync()` settles.
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

// ===========================================================================
// Part 2 — completion callback: helper resolves with the correct outcome
// ===========================================================================
describe('requestStoreReview — dialog completion callback outcome (Sub-AC 14b-2 Part 2)', () => {
  beforeEach(() => {
    storeReviewSpies.isAvailableAsync.mockReset();
    storeReviewSpies.requestReview.mockReset();
    platformHolder.os = 'ios';
  });

  it('resolves the completion callback with { attempted: true, available: true, platform: "ios" }', async () => {
    storeReviewSpies.isAvailableAsync.mockResolvedValue(true);
    storeReviewSpies.requestReview.mockResolvedValue(undefined);

    const outcome = await requestStoreReview();

    expect(outcome).toEqual({
      attempted: true,
      available: true,
      platform: 'ios',
    });
  });

  it('resolves the completion callback with platform: "android" on the Android surface', async () => {
    platformHolder.os = 'android';
    storeReviewSpies.isAvailableAsync.mockResolvedValue(true);
    storeReviewSpies.requestReview.mockResolvedValue(undefined);

    const outcome = await requestStoreReview();

    expect(outcome).toEqual({
      attempted: true,
      available: true,
      platform: 'android',
    });
  });

  it('attempted=true in the callback outcome confirms the dispatch was issued', async () => {
    // `attempted` is the authoritative signal that requestReview() was
    // dispatched. The caller's .then callback (rating-gate route) uses this
    // field to populate the `rating_prompt_completed` analytics event.
    storeReviewSpies.isAvailableAsync.mockResolvedValue(true);
    storeReviewSpies.requestReview.mockResolvedValue(undefined);

    const outcome = await requestStoreReview();

    expect(outcome.attempted).toBe(true);
    // The spy call confirms the native layer was reached, matching `attempted`.
    expect(storeReviewSpies.requestReview).toHaveBeenCalledTimes(1);
  });

  it('the completion callback promise always fulfills — it never rejects', async () => {
    // The caller uses `void requestStoreReview().then(...)` with no .catch,
    // relying on the helper never rejecting. Verify this via `.resolves`.
    storeReviewSpies.isAvailableAsync.mockResolvedValue(true);
    storeReviewSpies.requestReview.mockResolvedValue(undefined);

    await expect(requestStoreReview()).resolves.toMatchObject({
      attempted: true,
      available: true,
    });
  });

  it('the completion callback resolves before requestReview() promise settles', async () => {
    // The helper is fire-and-forget: it returns immediately after dispatching
    // requestReview(), without awaiting the dialog's own lifecycle promise.
    // This test keeps the dialog promise pending and proves the helper resolves
    // anyway — if it awaited the dialog, `await requestStoreReview()` below
    // would hang forever.
    storeReviewSpies.isAvailableAsync.mockResolvedValue(true);

    let resolveDialog!: () => void;
    const dialogPromise = new Promise<void>((resolve) => {
      resolveDialog = resolve;
    });
    storeReviewSpies.requestReview.mockImplementation(() => dialogPromise);

    // This await must complete even though dialogPromise is still pending.
    const outcome = await requestStoreReview();

    // Callback received the correct outcome before the dialog settled.
    expect(outcome).toEqual({ attempted: true, available: true, platform: 'ios' });
    expect(storeReviewSpies.requestReview).toHaveBeenCalledTimes(1);

    // Release the dialog after the callback has already been delivered.
    resolveDialog();
    await Promise.resolve();
  });
});

// ===========================================================================
// Part 3 — fire-and-forget: callback precedes dialog settle + clean teardown
// ===========================================================================
describe('requestStoreReview — fire-and-forget timing (Sub-AC 14b-2 Part 3)', () => {
  beforeEach(() => {
    storeReviewSpies.isAvailableAsync.mockReset();
    storeReviewSpies.requestReview.mockReset();
    platformHolder.os = 'ios';
  });

  it('dialog resolve after callback delivery causes no unhandled rejection or side effects', async () => {
    // Scenario: dialog completes after the route's .then callback has already
    // processed the outcome. The detached rejection handler attached inside
    // the helper must absorb any future errors silently.
    storeReviewSpies.isAvailableAsync.mockResolvedValue(true);

    let resolveDialog!: () => void;
    const dialogPromise = new Promise<void>((resolve) => {
      resolveDialog = resolve;
    });
    storeReviewSpies.requestReview.mockImplementation(() => dialogPromise);

    // Await the helper — callback delivered.
    const outcome = await requestStoreReview();
    expect(outcome.attempted).toBe(true);

    // Now resolve the dialog asynchronously. The helper has already returned.
    resolveDialog();
    await Promise.resolve();
    await Promise.resolve();
    // Test passes by NOT throwing — the detached resolve is silently ignored.
  });

  it('dialog reject after callback delivery is swallowed (no unhandled rejection)', async () => {
    // Even when the dialog rejects AFTER the helper has returned, the rejection
    // handler already attached inside the helper absorbs the error silently.
    storeReviewSpies.isAvailableAsync.mockResolvedValue(true);

    let rejectDialog!: (err: Error) => void;
    const dialogPromise = new Promise<void>((_resolve, reject) => {
      rejectDialog = reject;
    });
    storeReviewSpies.requestReview.mockImplementation(() => dialogPromise);

    // Callback delivered with attempted=true.
    const outcome = await requestStoreReview();
    expect(outcome.attempted).toBe(true);

    // Reject the dialog after the helper has already returned and the callback
    // has been delivered. The helper's .catch handler must absorb this.
    rejectDialog(new Error('dialog dismissed by system after callback'));
    await Promise.resolve();
    await Promise.resolve();
    // No unhandled rejection propagates — test passes.
  });

  it('helper resolves once (idempotent completion callback) on repeated calls', async () => {
    // Each call to requestStoreReview() produces exactly one completion
    // callback, no matter how many times the helper is invoked.
    storeReviewSpies.isAvailableAsync.mockResolvedValue(true);
    storeReviewSpies.requestReview.mockResolvedValue(undefined);

    const [outcome1, outcome2] = await Promise.all([
      requestStoreReview(),
      requestStoreReview(),
    ]);

    // Both callbacks delivered the correct outcome.
    expect(outcome1).toEqual({ attempted: true, available: true, platform: 'ios' });
    expect(outcome2).toEqual({ attempted: true, available: true, platform: 'ios' });
    // Two independent calls → two requestReview() dispatches.
    expect(storeReviewSpies.requestReview).toHaveBeenCalledTimes(2);
  });
});
