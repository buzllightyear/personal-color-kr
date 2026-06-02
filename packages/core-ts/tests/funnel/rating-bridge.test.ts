/**
 * Unit tests — RatingBridge (Sub-AC 8.3).
 *
 * Contract under test:
 *   - `createRatingBridge({ platform, requestReviewNative, now, appVersion })`
 *     returns a frozen façade exposing `requestReview` and `canPromptNow`.
 *   - On `platform === 'ios'` with a native binding present,
 *     `requestReview(stage)` invokes the binding exactly once and resolves
 *     with `{ outcome: 'requested', stage, platform: 'ios', promptedAt,
 *     appVersion, error: null }`.
 *   - On any non-iOS platform the binding is NEVER invoked and the result
 *     is `{ outcome: 'skipped_non_ios', stage, platform, promptedAt: null,
 *     appVersion: null, error: null }`.
 *   - On iOS without a binding the result is
 *     `{ outcome: 'skipped_native_unavailable', ... }`.
 *   - When the binding throws synchronously or rejects asynchronously the
 *     bridge catches the error and resolves with
 *     `{ outcome: 'failed', error: { reason, message }, ... }` without
 *     re-throwing.
 *   - Constructor validates options up-front and throws
 *     `RatingBridgeError` with a discriminated `reason` for malformed
 *     input.
 *   - All returned records are `Object.freeze`d.
 *
 * Coverage matrix:
 *   1. Constants — RATING_BRIDGE_PLATFORMS shape.
 *   2. Constructor validation:
 *      a. Non-object options → invalid_platform.
 *      b. Bad platform string → invalid_platform.
 *      c. Non-string / non-function platform → invalid_platform.
 *      d. Non-function requestReviewNative → invalid_native_binding.
 *      e. Non-function now → invalid_now.
 *      f. Bad appVersion type → invalid_app_version.
 *   3. canPromptNow:
 *      a. iOS + binding → true.
 *      b. iOS without binding → false.
 *      c. Non-iOS even with binding → false.
 *      d. Function-based platform that throws → false (defensive).
 *   4. requestReview happy path (iOS):
 *      a. Sync binding called exactly once; outcome=requested.
 *      b. Async binding awaited; outcome=requested.
 *      c. promptedAt comes from injected now().
 *      d. appVersion comes from injected source (string or function).
 *      e. Result is frozen, including the nested error field.
 *   5. requestReview short-circuits:
 *      a. platform='android' → skipped_non_ios, binding NOT invoked.
 *      b. platform='web' → skipped_non_ios.
 *      c. platform='unknown' → skipped_non_ios.
 *      d. platform='ios' + no binding → skipped_native_unavailable.
 *      e. Short-circuits never stamp promptedAt/appVersion.
 *   6. requestReview failure path (iOS):
 *      a. Sync throw → outcome=failed, reason=native_threw, message echoed.
 *      b. Async reject with Error → outcome=failed, reason=native_threw.
 *      c. Reject with custom NativeError → reason=native_rejected.
 *      d. Reject with non-Error string → message echoed.
 *      e. Result is still frozen.
 *      f. The bridge does NOT re-throw.
 *   7. requestReview stage validation:
 *      a. Stage 1/2/3/4 are accepted.
 *      b. Stage 0/5/'1'/null → RatingBridgeError invalid_stage.
 *   8. Dynamic platform: function-based platform re-evaluates on each call.
 *   9. createNoopRatingBridge:
 *      a. Default platform='unknown' → skipped_non_ios.
 *      b. Explicit 'android' / 'web' work too.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  RATING_BRIDGE_PLATFORMS,
  RatingBridgeError,
  createNoopRatingBridge,
  createRatingBridge,
  type RatingBridge,
  type RatingBridgeNativeBinding,
  type RatingBridgePlatform,
  type RatingBridgeResult,
} from '../../src/funnel/rating-bridge.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIosBridge(overrides?: {
  binding?: RatingBridgeNativeBinding;
  now?: () => string;
  appVersion?: string | (() => string | null);
}): { bridge: RatingBridge; binding: ReturnType<typeof vi.fn> } {
  const binding =
    overrides?.binding !== undefined
      ? (vi.fn(overrides.binding) as ReturnType<typeof vi.fn>)
      : (vi.fn(() => undefined) as ReturnType<typeof vi.fn>);
  const bridge = createRatingBridge({
    platform: 'ios',
    requestReviewNative: binding as unknown as RatingBridgeNativeBinding,
    now: overrides?.now ?? (() => '2026-05-16T12:00:00.000Z'),
    ...(overrides?.appVersion !== undefined
      ? { appVersion: overrides.appVersion }
      : {}),
  });
  return { bridge, binding };
}

// ---------------------------------------------------------------------------
// 1. Constants
// ---------------------------------------------------------------------------

describe('RATING_BRIDGE_PLATFORMS', () => {
  it('exposes ios, android, web, unknown in canonical order', () => {
    expect([...RATING_BRIDGE_PLATFORMS]).toEqual(['ios', 'android', 'web', 'unknown']);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(RATING_BRIDGE_PLATFORMS)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Constructor validation
// ---------------------------------------------------------------------------

describe('createRatingBridge — constructor validation', () => {
  it('rejects non-object options with invalid_platform', () => {
    expect(() =>
      createRatingBridge(null as unknown as Parameters<typeof createRatingBridge>[0]),
    ).toThrowError(RatingBridgeError);
  });

  it('rejects a bad platform string', () => {
    let caught: unknown;
    try {
      createRatingBridge({
        platform: 'macos' as unknown as RatingBridgePlatform,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RatingBridgeError);
    expect((caught as RatingBridgeError).reason).toBe('invalid_platform');
  });

  it('rejects a non-string / non-function platform', () => {
    let caught: unknown;
    try {
      createRatingBridge({
        platform: 42 as unknown as RatingBridgePlatform,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RatingBridgeError);
    expect((caught as RatingBridgeError).reason).toBe('invalid_platform');
  });

  it('rejects a non-function requestReviewNative', () => {
    let caught: unknown;
    try {
      createRatingBridge({
        platform: 'ios',
        requestReviewNative: 'not a function' as unknown as RatingBridgeNativeBinding,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RatingBridgeError);
    expect((caught as RatingBridgeError).reason).toBe('invalid_native_binding');
  });

  it('rejects a non-function `now`', () => {
    let caught: unknown;
    try {
      createRatingBridge({
        platform: 'ios',
        now: 'now' as unknown as () => string,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RatingBridgeError);
    expect((caught as RatingBridgeError).reason).toBe('invalid_now');
  });

  it('rejects a bad appVersion type', () => {
    let caught: unknown;
    try {
      createRatingBridge({
        platform: 'ios',
        appVersion: 42 as unknown as string,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RatingBridgeError);
    expect((caught as RatingBridgeError).reason).toBe('invalid_app_version');
  });

  it('accepts a function-based platform without invoking it', () => {
    const platformFn = vi.fn(() => 'ios' as RatingBridgePlatform);
    const bridge = createRatingBridge({ platform: platformFn });
    expect(bridge).toBeDefined();
    expect(platformFn).not.toHaveBeenCalled();
  });

  it('returns a frozen façade object', () => {
    const { bridge } = makeIosBridge();
    expect(Object.isFrozen(bridge)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. canPromptNow
// ---------------------------------------------------------------------------

describe('canPromptNow', () => {
  it('returns true on iOS with a native binding', () => {
    const { bridge } = makeIosBridge();
    expect(bridge.canPromptNow()).toBe(true);
  });

  it('returns false on iOS without a native binding', () => {
    const bridge = createRatingBridge({ platform: 'ios' });
    expect(bridge.canPromptNow()).toBe(false);
  });

  it('returns false on Android even with a binding', () => {
    const bridge = createRatingBridge({
      platform: 'android',
      requestReviewNative: vi.fn() as unknown as RatingBridgeNativeBinding,
    });
    expect(bridge.canPromptNow()).toBe(false);
  });

  it('returns false on web even with a binding', () => {
    const bridge = createRatingBridge({
      platform: 'web',
      requestReviewNative: vi.fn() as unknown as RatingBridgeNativeBinding,
    });
    expect(bridge.canPromptNow()).toBe(false);
  });

  it('returns false when the dynamic platform probe throws', () => {
    const bridge = createRatingBridge({
      platform: (() => {
        throw new Error('platform probe failed');
      }) as unknown as () => RatingBridgePlatform,
      requestReviewNative: vi.fn() as unknown as RatingBridgeNativeBinding,
    });
    expect(bridge.canPromptNow()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. requestReview happy path
// ---------------------------------------------------------------------------

describe('requestReview — iOS happy path', () => {
  it('invokes the sync native binding exactly once and resolves with outcome=requested', async () => {
    const { bridge, binding } = makeIosBridge();
    const result = await bridge.requestReview(1);
    expect(binding).toHaveBeenCalledTimes(1);
    expect(binding).toHaveBeenCalledWith();
    expect(result.outcome).toBe('requested');
    expect(result.stage).toBe(1);
    expect(result.platform).toBe('ios');
    expect(result.error).toBeNull();
  });

  it('awaits an async native binding before resolving', async () => {
    let resolveBinding: (() => void) | undefined;
    const bindingPromise = new Promise<void>((resolve) => {
      resolveBinding = resolve;
    });
    const binding: RatingBridgeNativeBinding = () => bindingPromise;
    const { bridge } = makeIosBridge({ binding });
    const reviewPromise = bridge.requestReview(2);
    // The bridge has not resolved yet because the binding hasn't resolved.
    let resolved = false;
    void reviewPromise.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);
    (resolveBinding as () => void)();
    const result = await reviewPromise;
    expect(result.outcome).toBe('requested');
    expect(result.stage).toBe(2);
  });

  it('stamps promptedAt from the injected now() hook', async () => {
    const { bridge } = makeIosBridge({
      now: () => '2026-05-16T15:30:00.000Z',
    });
    const result = await bridge.requestReview(3);
    expect(result.promptedAt).toBe('2026-05-16T15:30:00.000Z');
  });

  it('uses a string appVersion when provided', async () => {
    const { bridge } = makeIosBridge({ appVersion: '1.4.2' });
    const result = await bridge.requestReview(4);
    expect(result.appVersion).toBe('1.4.2');
  });

  it('uses a function appVersion when provided', async () => {
    const { bridge } = makeIosBridge({ appVersion: () => '2.0.0-beta' });
    const result = await bridge.requestReview(4);
    expect(result.appVersion).toBe('2.0.0-beta');
  });

  it('appVersion is null when not provided', async () => {
    const { bridge } = makeIosBridge();
    const result = await bridge.requestReview(1);
    expect(result.appVersion).toBeNull();
  });

  it('returns a frozen result with frozen nested error=null', async () => {
    const { bridge } = makeIosBridge();
    const result = await bridge.requestReview(1);
    expect(Object.isFrozen(result)).toBe(true);
    // Mutation attempts should not stick on frozen results.
    expect(() => {
      (result as { outcome: string }).outcome = 'failed';
    }).toThrowError(TypeError);
  });

  it('uses the default `now` (Date.toISOString) when none is injected', async () => {
    // We don't pin the time — just assert the shape is ISO-8601-ish.
    const binding = vi.fn(() => undefined);
    const bridge = createRatingBridge({
      platform: 'ios',
      requestReviewNative: binding as unknown as RatingBridgeNativeBinding,
    });
    const result = await bridge.requestReview(1);
    expect(result.outcome).toBe('requested');
    expect(result.promptedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('rejects a now() that returns a non-string', async () => {
    const binding = vi.fn(() => undefined);
    const bridge = createRatingBridge({
      platform: 'ios',
      requestReviewNative: binding as unknown as RatingBridgeNativeBinding,
      now: () => 42 as unknown as string,
    });
    await expect(bridge.requestReview(1)).rejects.toBeInstanceOf(RatingBridgeError);
  });

  it('rejects an appVersion function that returns an invalid value', async () => {
    const binding = vi.fn(() => undefined);
    const bridge = createRatingBridge({
      platform: 'ios',
      requestReviewNative: binding as unknown as RatingBridgeNativeBinding,
      appVersion: () => '' as unknown as string,
    });
    await expect(bridge.requestReview(1)).rejects.toBeInstanceOf(RatingBridgeError);
  });
});

// ---------------------------------------------------------------------------
// 5. requestReview short-circuits
// ---------------------------------------------------------------------------

describe('requestReview — short-circuits', () => {
  it('on android: never invokes binding, returns skipped_non_ios', async () => {
    const binding = vi.fn(() => undefined);
    const bridge = createRatingBridge({
      platform: 'android',
      requestReviewNative: binding as unknown as RatingBridgeNativeBinding,
    });
    const result = await bridge.requestReview(1);
    expect(binding).not.toHaveBeenCalled();
    expect(result.outcome).toBe('skipped_non_ios');
    expect(result.platform).toBe('android');
    expect(result.promptedAt).toBeNull();
    expect(result.appVersion).toBeNull();
    expect(result.error).toBeNull();
  });

  it('on web: returns skipped_non_ios', async () => {
    const bridge = createRatingBridge({ platform: 'web' });
    const result = await bridge.requestReview(2);
    expect(result.outcome).toBe('skipped_non_ios');
    expect(result.platform).toBe('web');
  });

  it('on unknown platform: returns skipped_non_ios', async () => {
    const bridge = createRatingBridge({ platform: 'unknown' });
    const result = await bridge.requestReview(3);
    expect(result.outcome).toBe('skipped_non_ios');
    expect(result.platform).toBe('unknown');
  });

  it('on ios without a binding: returns skipped_native_unavailable', async () => {
    const bridge = createRatingBridge({ platform: 'ios' });
    const result = await bridge.requestReview(4);
    expect(result.outcome).toBe('skipped_native_unavailable');
    expect(result.platform).toBe('ios');
    expect(result.promptedAt).toBeNull();
    expect(result.appVersion).toBeNull();
    expect(result.error).toBeNull();
  });

  it('short-circuit results are frozen', async () => {
    const bridge = createRatingBridge({ platform: 'android' });
    const result = await bridge.requestReview(1);
    expect(Object.isFrozen(result)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. requestReview failure path
// ---------------------------------------------------------------------------

describe('requestReview — failure handling', () => {
  it('catches a synchronous throw and resolves with outcome=failed', async () => {
    const binding = vi.fn(() => {
      throw new Error('StoreKit module not linked');
    });
    const bridge = createRatingBridge({
      platform: 'ios',
      requestReviewNative: binding as unknown as RatingBridgeNativeBinding,
    });
    const result = await bridge.requestReview(1);
    expect(result.outcome).toBe('failed');
    expect(result.error).not.toBeNull();
    expect(result.error?.reason).toBe('native_threw');
    expect(result.error?.message).toBe('StoreKit module not linked');
  });

  it('catches an async rejection with a generic Error', async () => {
    const binding = vi.fn(() => Promise.reject(new Error('async StoreKit failure')));
    const bridge = createRatingBridge({
      platform: 'ios',
      requestReviewNative: binding as unknown as RatingBridgeNativeBinding,
    });
    const result = await bridge.requestReview(2);
    expect(result.outcome).toBe('failed');
    expect(result.error?.reason).toBe('native_threw');
    expect(result.error?.message).toBe('async StoreKit failure');
  });

  it('classifies a NativeError as native_rejected', async () => {
    class NativeError extends Error {
      override readonly name = 'NativeError';
    }
    const binding = vi.fn(() => Promise.reject(new NativeError('OS-level reject')));
    const bridge = createRatingBridge({
      platform: 'ios',
      requestReviewNative: binding as unknown as RatingBridgeNativeBinding,
    });
    const result = await bridge.requestReview(3);
    expect(result.outcome).toBe('failed');
    expect(result.error?.reason).toBe('native_rejected');
    expect(result.error?.message).toBe('OS-level reject');
  });

  it('handles a non-Error reject value (string)', async () => {
    const binding = vi.fn(() => Promise.reject('plain string'));
    const bridge = createRatingBridge({
      platform: 'ios',
      requestReviewNative: binding as unknown as RatingBridgeNativeBinding,
    });
    const result = await bridge.requestReview(4);
    expect(result.outcome).toBe('failed');
    expect(result.error?.reason).toBe('native_threw');
    expect(result.error?.message).toBe('plain string');
  });

  it('handles a non-Error reject value (object)', async () => {
    const binding = vi.fn(() => Promise.reject({ foo: 'bar' }));
    const bridge = createRatingBridge({
      platform: 'ios',
      requestReviewNative: binding as unknown as RatingBridgeNativeBinding,
    });
    const result = await bridge.requestReview(1);
    expect(result.outcome).toBe('failed');
    expect(result.error?.message).toBe('unknown native failure');
  });

  it('does NOT re-throw — caller never sees a rejection', async () => {
    const binding = vi.fn(() => {
      throw new Error('boom');
    });
    const bridge = createRatingBridge({
      platform: 'ios',
      requestReviewNative: binding as unknown as RatingBridgeNativeBinding,
    });
    let threw = false;
    try {
      await bridge.requestReview(1);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });

  it('failed result is frozen, including the nested error object', async () => {
    const binding = vi.fn(() => {
      throw new Error('boom');
    });
    const bridge = createRatingBridge({
      platform: 'ios',
      requestReviewNative: binding as unknown as RatingBridgeNativeBinding,
    });
    const result = await bridge.requestReview(1);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.error)).toBe(true);
  });

  it('stamps promptedAt on a failed result (the attempt happened)', async () => {
    const binding = vi.fn(() => {
      throw new Error('boom');
    });
    const bridge = createRatingBridge({
      platform: 'ios',
      requestReviewNative: binding as unknown as RatingBridgeNativeBinding,
      now: () => '2026-05-16T20:00:00.000Z',
    });
    const result = await bridge.requestReview(1);
    expect(result.promptedAt).toBe('2026-05-16T20:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// 7. requestReview stage validation
// ---------------------------------------------------------------------------

describe('requestReview — stage validation', () => {
  it.each([1, 2, 3, 4] as const)('accepts stage %s', async (stage) => {
    const { bridge } = makeIosBridge();
    const result = await bridge.requestReview(stage);
    expect(result.stage).toBe(stage);
    expect(result.outcome).toBe('requested');
  });

  it.each([0, 5, -1, 1.5, '1', null, undefined, {}] as const)(
    'rejects invalid stage %s',
    async (bad) => {
      const { bridge } = makeIosBridge();
      let caught: unknown;
      try {
        await bridge.requestReview(
          bad as unknown as Parameters<RatingBridge['requestReview']>[0],
        );
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(RatingBridgeError);
      expect((caught as RatingBridgeError).reason).toBe('invalid_stage');
    },
  );
});

// ---------------------------------------------------------------------------
// 8. Dynamic platform
// ---------------------------------------------------------------------------

describe('requestReview — dynamic platform', () => {
  it('re-evaluates the platform function on each call', async () => {
    let platform: RatingBridgePlatform = 'android';
    const binding = vi.fn(() => undefined);
    const bridge = createRatingBridge({
      platform: () => platform,
      requestReviewNative: binding as unknown as RatingBridgeNativeBinding,
    });

    const r1 = await bridge.requestReview(1);
    expect(r1.outcome).toBe('skipped_non_ios');
    expect(binding).toHaveBeenCalledTimes(0);

    platform = 'ios';
    const r2 = await bridge.requestReview(1);
    expect(r2.outcome).toBe('requested');
    expect(binding).toHaveBeenCalledTimes(1);
  });

  it('rejects when the dynamic platform returns an unknown value', async () => {
    const bridge = createRatingBridge({
      platform: () => 'macos' as unknown as RatingBridgePlatform,
    });
    let caught: unknown;
    try {
      await bridge.requestReview(1);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RatingBridgeError);
    expect((caught as RatingBridgeError).reason).toBe('invalid_platform');
  });
});

// ---------------------------------------------------------------------------
// 9. createNoopRatingBridge
// ---------------------------------------------------------------------------

describe('createNoopRatingBridge', () => {
  it('defaults to platform=unknown and skips', async () => {
    const bridge = createNoopRatingBridge();
    const result = await bridge.requestReview(1);
    expect(result.outcome).toBe('skipped_non_ios');
    expect(result.platform).toBe('unknown');
    expect(bridge.canPromptNow()).toBe(false);
  });

  it('honours explicit android platform', async () => {
    const bridge = createNoopRatingBridge('android');
    const result = await bridge.requestReview(2);
    expect(result.platform).toBe('android');
    expect(result.outcome).toBe('skipped_non_ios');
  });

  it('honours explicit web platform', async () => {
    const bridge = createNoopRatingBridge('web');
    const result = await bridge.requestReview(3);
    expect(result.platform).toBe('web');
    expect(result.outcome).toBe('skipped_non_ios');
  });
});

// ---------------------------------------------------------------------------
// Smoke: result type narrowing example
// ---------------------------------------------------------------------------

describe('RatingBridgeResult', () => {
  it('can be narrowed on outcome by call sites', async () => {
    const { bridge } = makeIosBridge();
    const result: RatingBridgeResult = await bridge.requestReview(1);
    if (result.outcome === 'requested') {
      // Type-level: stage/platform/promptedAt are accessible.
      expect(result.stage).toBeDefined();
      expect(result.error).toBeNull();
    } else {
      // Other branches still expose the same shape.
      expect(result.outcome).toBeDefined();
    }
  });
});
