/**
 * Unit test — `requestStoreReview` failure path handling.
 * Sub-AC 14b-3: StoreReview 실패 경로 처리 — API 비가용·iOS 제한으로
 * 요청 실패 시 에러 핸들러 호출 및 상태 롤백.
 *
 * Purpose:
 *   This file pins the FAILURE CONTRACT of the `requestStoreReview` helper:
 *   the guarantee that every failure mode (API unavailability, iOS
 *   restrictions, async rejection, synchronous throw) triggers the internal
 *   error handler (catch block), rolls the outcome state back to
 *   `{ attempted: false, available: false }` (or `attempted: true` for
 *   post-dispatch failures), and NEVER propagates a rejection to the caller.
 *
 * Why a dedicated file (not folded into request-store-review.test.ts):
 *   The sibling `request-store-review.test.ts` proves general branch
 *   coverage for the five outcome branches. THIS file focuses specifically
 *   on the two failure-mode triggers named in Sub-AC 14b-3:
 *     1. API 비가용 (API unavailability) — `isAvailableAsync()` throws or
 *        returns false. The error handler catches the throw / detects the
 *        false return and rolls back the `available` flag to `false` before
 *        returning early with `attempted: false`.
 *     2. iOS 제한 (iOS restriction) — `requestReview()` rejects
 *        asynchronously or throws synchronously after a successful
 *        availability probe. The error handler catches the SDK error and
 *        swallows it. The `attempted: true` flag is preserved (dispatch
 *        intent was fulfilled), but the native prompt was blocked by iOS.
 *
 * Error handler contract (에러 핸들러 호출):
 *   The two internal `try/catch` blocks in `requestStoreReview()` ARE the
 *   error handlers. Their invocation is observable through side-effects:
 *     - The helper resolves (never rejects) — the catch block absorbed the
 *       error and did not re-throw.
 *     - The outcome reflects the caught state (see state-rollback contract
 *       below).
 *     - `requestReview()` is NOT dispatched after an `isAvailableAsync()`
 *       error — the error handler returned early.
 *
 * State rollback contract (상태 롤백):
 *   "State" in this context is the mutable `available` local variable inside
 *   `requestStoreReview()` and the two fields of the returned
 *   `StoreReviewOutcome`:
 *     - `available` — starts at `false` before the probe. If the probe
 *       throws, the catch block returns BEFORE `available` is ever set to
 *       `true`. If the probe returns `false`, no state change occurred.
 *       In both cases the outcome reflects the rolled-back state:
 *       `available: false`.
 *     - `attempted` — starts logically at `false` (no dispatch yet). The
 *       flag is set to `true` only when `requestReview()` is dispatched. If
 *       the error occurs BEFORE dispatch (probe failure), `attempted` is
 *       rolled back to / stays at `false`. If the error occurs AFTER dispatch
 *       (async rejection, sync throw), `attempted` remains `true` (the
 *       dispatch happened, iOS blocked the prompt — the intent was fulfilled).
 *
 * Isolation boundary (Seed constraint):
 *   Mocks `expo-store-review` (the native SDK) directly — this is the
 *   HELPER-LEVEL test, so it owns the native seam. Route-level tests mock
 *   the helper itself and never touch `expo-store-review`.
 *
 * Branches under test:
 *   A. API unavailability — isAvailableAsync() throws
 *      A1. Generic network/API error → error handler catches → rollback
 *      A2. iOS-specific error type (stringified NSError) → same rollback
 *      A3. Android API error type → rollback on android platform
 *      A4. Non-Error thrown value (string) → handler still catches
 *      A5. Repeated failures → each call independently rolls back state
 *   B. iOS restriction — isAvailableAsync() returns false (rate-limited)
 *      B1. iOS platform, false probe → no dispatch, rollback
 *      B2. Android platform, false probe → same (device restriction)
 *      B3. False probe after a prior success → state is per-call, not global
 *   C. Post-dispatch iOS restriction — requestReview() fails after dispatch
 *      C1. Async rejection → error handler catches → attempted stays true
 *      C2. Synchronous throw → error handler catches → attempted stays true
 *      C3. Rejection with specific iOS error code → same swallow + attempted
 *   D. Helper never rejects — across ALL failure modes
 *      D1. isAvailableAsync throws → helper resolves (not rejects)
 *      D2. isAvailableAsync returns false → helper resolves
 *      D3. requestReview rejects → helper resolves
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted spies — declared via vi.hoisted so the vi.mock factories below
// (hoisted above any import) can close over them.
// ---------------------------------------------------------------------------
const storeReviewSpies = vi.hoisted(() => ({
  isAvailableAsync: vi.fn<[], Promise<boolean>>(),
  requestReview: vi.fn<[], Promise<void>>(),
}));

vi.mock('expo-store-review', () => ({
  isAvailableAsync: storeReviewSpies.isAvailableAsync,
  requestReview: storeReviewSpies.requestReview,
}));

// Mutable platform holder — the helper reads `Platform.OS` lazily at call
// time, so reassigning between tests is observed by the next invocation.
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

// ---------------------------------------------------------------------------
// Helper: flush any pending microtasks so fire-and-forget rejection handlers
// resolve before the next test assertion or the next test case.
// ---------------------------------------------------------------------------
const flushMicrotasks = (): Promise<void> =>
  Promise.resolve().then(() => Promise.resolve());

// ---------------------------------------------------------------------------
// Group A — API unavailability (에러 핸들러 호출 + 상태 롤백)
// Scenario: isAvailableAsync() THROWS.
// Error handler contract: the outer `try/catch` catches the throw,
//   `devWarn` is called (dev-only), and the function returns early WITHOUT
//   ever reaching the `requestReview()` dispatch branch.
// State rollback contract: `available` never transitions away from `false`
//   (it starts at false, the probe threw before setting it to true).
//   `attempted` was never set to `true`. Outcome: { attempted: false,
//   available: false, platform }.
// ---------------------------------------------------------------------------
describe('A — API unavailability: isAvailableAsync() throws (에러 핸들러 호출 + 상태 롤백)', () => {
  beforeEach(() => {
    storeReviewSpies.isAvailableAsync.mockReset();
    storeReviewSpies.requestReview.mockReset();
    platformHolder.os = 'ios';
  });

  afterEach(async () => {
    // Flush any detached promise rejections so they do not leak.
    await flushMicrotasks();
  });

  it('A1 — generic network/API error: error handler catches, state rolls back to { attempted: false, available: false }', async () => {
    storeReviewSpies.isAvailableAsync.mockRejectedValue(
      new Error('ExpoStoreReview: network unavailable'),
    );

    const outcome = await requestStoreReview();

    // Error handler invocation proof: helper resolved (not rejected), the
    // catch block absorbed the error. The requestReview dispatch was never
    // reached (pre-dispatch error handler path).
    expect(storeReviewSpies.requestReview).not.toHaveBeenCalled();
    // State rollback: available and attempted are both false — the
    // `available` variable never transitioned from its initial false value.
    expect(outcome.available).toBe(false);
    expect(outcome.attempted).toBe(false);
    expect(outcome.platform).toBe('ios');
  });

  it('A2 — iOS-specific NSError (stringified): error handler catches, state rolls back', async () => {
    // Simulates how the Expo SDK surfaces an iOS NSError when the Store
    // Review framework is not available (e.g. on simulator, in TestFlight
    // review, or when the entitlement is missing).
    storeReviewSpies.isAvailableAsync.mockRejectedValue(
      new Error('Error: SKStoreReviewController is not available on this device.'),
    );

    const outcome = await requestStoreReview();

    expect(storeReviewSpies.requestReview).not.toHaveBeenCalled();
    // State rollback: iOS restriction → error handler → available=false
    expect(outcome.available).toBe(false);
    expect(outcome.attempted).toBe(false);
    expect(outcome.platform).toBe('ios');
  });

  it('A3 — Android API error: error handler catches on android platform, state rolls back', async () => {
    platformHolder.os = 'android';
    storeReviewSpies.isAvailableAsync.mockRejectedValue(
      new Error('In-App Review API: not available'),
    );

    const outcome = await requestStoreReview();

    expect(storeReviewSpies.requestReview).not.toHaveBeenCalled();
    // State rollback on Android platform — same contract as iOS.
    expect(outcome.available).toBe(false);
    expect(outcome.attempted).toBe(false);
    // Platform is correctly captured even on the error path (platform is
    // read BEFORE any SDK call so it is always present on rollback).
    expect(outcome.platform).toBe('android');
  });

  it('A4 — non-Error thrown value (string): error handler still catches, state rolls back', async () => {
    // The catch block receives `unknown`; the string conversion in devWarn
    // handles this. Verifies the handler is not narrowed to `Error` only.
    storeReviewSpies.isAvailableAsync.mockRejectedValue('unexpected string rejection');

    const outcome = await requestStoreReview();

    expect(storeReviewSpies.requestReview).not.toHaveBeenCalled();
    expect(outcome.available).toBe(false);
    expect(outcome.attempted).toBe(false);
  });

  it('A5 — repeated failures: each call independently rolls back state (no global leak)', async () => {
    // The state rollback must be per-call, not per-module. Two sequential
    // failures must each produce the same rolled-back outcome without
    // interfering with each other.
    storeReviewSpies.isAvailableAsync.mockRejectedValue(new Error('API unavailable'));

    const firstOutcome = await requestStoreReview();
    const secondOutcome = await requestStoreReview();

    // Both calls roll back independently.
    expect(firstOutcome).toEqual({
      attempted: false,
      available: false,
      platform: 'ios',
    });
    expect(secondOutcome).toEqual({
      attempted: false,
      available: false,
      platform: 'ios',
    });
    // No dispatch ever reached on either call.
    expect(storeReviewSpies.requestReview).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Group B — iOS/Android restriction: isAvailableAsync() returns false
// Scenario: the OS rate-limiter or device restriction reports unavailable.
// Error handler contract: the explicit `if (!available)` check in the helper
//   is the error handler for this path. No `catch` is needed because the
//   probe didn't throw — the SDK returned a well-formed `false`. The handler
//   path returns early WITHOUT dispatching `requestReview()`.
// State rollback contract: `available` was set to `false` by the probe
//   (matching the SDK response). `attempted` was never set to `true` (no
//   dispatch). Outcome: { attempted: false, available: false, platform }.
// ---------------------------------------------------------------------------
describe('B — iOS/Android restriction: isAvailableAsync() returns false (상태 롤백)', () => {
  beforeEach(() => {
    storeReviewSpies.isAvailableAsync.mockReset();
    storeReviewSpies.requestReview.mockReset();
    platformHolder.os = 'ios';
  });

  it('B1 — iOS rate-limited (isAvailableAsync false): no dispatch, state { attempted: false, available: false }', async () => {
    // SKStoreReviewController.requestReview() is rate-limited by iOS — the
    // SDK signals this by returning false from isAvailableAsync().
    storeReviewSpies.isAvailableAsync.mockResolvedValue(false);

    const outcome = await requestStoreReview();

    // Error handler (unavailable branch) invoked — requestReview skipped.
    expect(storeReviewSpies.requestReview).not.toHaveBeenCalled();
    // State: available=false (SDK reported unavailable), attempted=false
    // (no dispatch — correct rollback to the pre-dispatch state).
    expect(outcome.available).toBe(false);
    expect(outcome.attempted).toBe(false);
    expect(outcome.platform).toBe('ios');
  });

  it('B2 — Android device restriction (isAvailableAsync false): same rollback on android', async () => {
    platformHolder.os = 'android';
    storeReviewSpies.isAvailableAsync.mockResolvedValue(false);

    const outcome = await requestStoreReview();

    expect(storeReviewSpies.requestReview).not.toHaveBeenCalled();
    expect(outcome.available).toBe(false);
    expect(outcome.attempted).toBe(false);
    expect(outcome.platform).toBe('android');
  });

  it('B3 — false probe is per-call (no carryover from prior success)', async () => {
    // After a prior successful call (available=true), a subsequent call with
    // available=false must independently roll back state. The `available`
    // local variable inside the helper is not global — each call starts fresh.
    storeReviewSpies.isAvailableAsync
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    storeReviewSpies.requestReview.mockResolvedValue(undefined);

    const firstOutcome = await requestStoreReview();
    const secondOutcome = await requestStoreReview();

    // First call: probe true → dispatch → attempted=true, available=true.
    expect(firstOutcome.available).toBe(true);
    expect(firstOutcome.attempted).toBe(true);

    // Second call: probe false → no dispatch → state rolled back.
    expect(secondOutcome.available).toBe(false);
    expect(secondOutcome.attempted).toBe(false);

    // Dispatch was called exactly once (only on the first, successful call).
    expect(storeReviewSpies.requestReview).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Group C — Post-dispatch iOS restriction: requestReview() fails after dispatch
// Scenario: isAvailableAsync() returns true (probe OK) but requestReview()
//   fails asynchronously (iOS OS-level rate limit or entitlement rejection)
//   or synchronously (framework error in release build).
// Error handler contract: the second `try/catch` block wrapping the
//   `requestReview()` call IS the error handler for this path. It swallows
//   the error — the dispatch WAS made, so the intent was fulfilled even if
//   iOS blocked the native prompt.
// State rollback contract: `attempted` remains `true` (dispatch intent
//   fulfilled — "attempted" tracks dispatch, not native success per the
//   fire-and-forget contract). `available` remains `true` (the probe
//   succeeded). This is intentional: the rollback for post-dispatch errors
//   is to "dispatch happened, native presentation may have failed."
// ---------------------------------------------------------------------------
describe('C — post-dispatch iOS restriction: requestReview() fails (에러 핸들러 호출)', () => {
  beforeEach(() => {
    storeReviewSpies.isAvailableAsync.mockReset();
    storeReviewSpies.requestReview.mockReset();
    platformHolder.os = 'ios';
  });

  afterEach(async () => {
    await flushMicrotasks();
  });

  it('C1 — async rejection: error handler catches async rejection, attempted stays true', async () => {
    storeReviewSpies.isAvailableAsync.mockResolvedValue(true);
    storeReviewSpies.requestReview.mockRejectedValue(
      new Error('SKStoreReviewController: prompt presentation failed'),
    );

    const outcome = await requestStoreReview();
    // Flush the detached rejection handler so the async catch runs.
    await flushMicrotasks();

    // Error handler invocation: the rejection was caught by the `.catch`
    // attached to the fire-and-forget promise. The helper resolved before
    // the rejection settled — it did NOT wait for requestReview() to settle.
    expect(storeReviewSpies.requestReview).toHaveBeenCalledTimes(1);
    // State: attempted=true (dispatch was made — the "state" at the
    // dispatch point is preserved, not rolled back to false). available=true
    // (probe succeeded before the post-dispatch error).
    expect(outcome.attempted).toBe(true);
    expect(outcome.available).toBe(true);
    expect(outcome.platform).toBe('ios');
  });

  it('C2 — synchronous throw: error handler catches sync throw, attempted stays true', async () => {
    storeReviewSpies.isAvailableAsync.mockResolvedValue(true);
    storeReviewSpies.requestReview.mockImplementation(() => {
      throw new Error('SKError: domain error code 1 (unsupported)');
    });

    const outcome = await requestStoreReview();

    // Synchronous throws from requestReview() are swallowed by the inner
    // try/catch. The dispatch was attempted (the call was made, the SDK
    // threw synchronously), so the "attempted" intent is preserved.
    expect(storeReviewSpies.requestReview).toHaveBeenCalledTimes(1);
    expect(outcome.attempted).toBe(true);
    expect(outcome.available).toBe(true);
    expect(outcome.platform).toBe('ios');
  });

  it('C3 — iOS-specific SKError code rejection: swallowed, attempted preserved', async () => {
    // Simulates the iOS error type that may surface when the Review
    // framework rejects mid-prompt (e.g. entitlement not satisfied or
    // OS-level rate limit exceeded after the probe returned true).
    storeReviewSpies.isAvailableAsync.mockResolvedValue(true);
    storeReviewSpies.requestReview.mockRejectedValue(
      Object.assign(new Error('SKError'), {
        code: 1, // SKErrorUnsupported
        domain: 'SKErrorDomain',
      }),
    );

    const outcome = await requestStoreReview();
    await flushMicrotasks();

    expect(outcome.attempted).toBe(true);
    expect(outcome.available).toBe(true);
    expect(storeReviewSpies.requestReview).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Group D — Helper NEVER rejects (에러 핸들러 호출 결과 검증)
// This group verifies the fundamental error-swallowing contract from the
// caller's perspective: no matter which failure mode occurs, `await
// requestStoreReview()` always resolves with a well-formed StoreReviewOutcome
// and NEVER rejects. This is the observable proof that the error handlers
// are invoked and effective (they don't re-throw).
// ---------------------------------------------------------------------------
describe('D — helper never rejects across all failure modes (에러 핸들러 결과)', () => {
  beforeEach(() => {
    storeReviewSpies.isAvailableAsync.mockReset();
    storeReviewSpies.requestReview.mockReset();
    platformHolder.os = 'ios';
  });

  afterEach(async () => {
    await flushMicrotasks();
  });

  it('D1 — isAvailableAsync() throws: helper resolves a well-formed outcome (never rejects)', async () => {
    storeReviewSpies.isAvailableAsync.mockRejectedValue(new Error('API error'));

    // This expect will fail (throw) if requestStoreReview() rejects.
    // The `await` also surfaces any unhandled rejection as a test failure.
    const outcome = await requestStoreReview();

    expect(outcome).toEqual({
      attempted: false,
      available: false,
      platform: 'ios',
    });
  });

  it('D2 — isAvailableAsync() returns false: helper resolves a well-formed outcome', async () => {
    storeReviewSpies.isAvailableAsync.mockResolvedValue(false);

    const outcome = await requestStoreReview();

    expect(outcome).toEqual({
      attempted: false,
      available: false,
      platform: 'ios',
    });
  });

  it('D3 — requestReview() rejects: helper resolves attempted=true (never propagates)', async () => {
    storeReviewSpies.isAvailableAsync.mockResolvedValue(true);
    storeReviewSpies.requestReview.mockRejectedValue(new Error('iOS restriction'));

    const outcome = await requestStoreReview();
    await flushMicrotasks();

    // The helper MUST resolve — the rejection handler inside the fire-and-
    // forget dispatch swallowed the error before it could propagate.
    expect(outcome).toEqual({
      attempted: true,
      available: true,
      platform: 'ios',
    });
  });

  it('D4 — outcome shape is always a complete StoreReviewOutcome regardless of failure mode', async () => {
    // Verify that every failure path produces a complete outcome with all
    // three required fields — no partial object, no undefined fields.
    const failures = [
      // API unavailability
      async (): Promise<void> => {
        storeReviewSpies.isAvailableAsync.mockRejectedValueOnce(
          new Error('unavailable'),
        );
      },
      // iOS restriction (probe false)
      async (): Promise<void> => {
        storeReviewSpies.isAvailableAsync.mockResolvedValueOnce(false);
      },
      // Post-dispatch rejection
      async (): Promise<void> => {
        storeReviewSpies.isAvailableAsync.mockResolvedValueOnce(true);
        storeReviewSpies.requestReview.mockRejectedValueOnce(new Error('iOS blocked'));
      },
    ];

    for (const setupFailure of failures) {
      await setupFailure();
      const outcome = await requestStoreReview();
      await flushMicrotasks();

      // All fields present on every failure path.
      expect(typeof outcome.attempted).toBe('boolean');
      expect(typeof outcome.available).toBe('boolean');
      expect(['ios', 'android', 'other']).toContain(outcome.platform);
    }
  });
});
