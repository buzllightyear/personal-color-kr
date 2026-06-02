/**
 * Unit test — `requestStoreReview` helper `__DEV__`-gated diagnostics.
 *
 * Scope (the dev-observability AC):
 *   Pins the contract that the store-review helper emits a `console.warn`
 *   breadcrumb on each of its three terminal paths — DISPATCH, UNAVAILABLE,
 *   and ERROR-SWALLOWED — but ONLY when the React Native `__DEV__` global is
 *   truthy. Production builds (`__DEV__ === false`) and the bare node/vitest
 *   runtime (`__DEV__` undefined) MUST stay completely silent: no
 *   `console.warn`, no `console.log`, no user-visible side effect (Seed
 *   constraint: "No console.log in production code; `__DEV__`-gated
 *   console.warn only").
 *
 * Why a separate file from `request-store-review.test.ts`:
 *   That file owns the OUTCOME / fire-and-forget contract; this file owns the
 *   orthogonal observability contract. Keeping them apart means the
 *   `__DEV__`-toggling global mutation here never leaks into the outcome
 *   suite, and each file stays small and single-purpose.
 *
 * Mocking strategy (mirrors the sibling helper test):
 *   - `vi.mock('expo-store-review', ...)` swaps the native package for hoisted
 *     spies so vitest never resolves the native module and each path can be
 *     driven deterministically.
 *   - `vi.mock('react-native', ...)` supplies a mutable `Platform.OS` (the
 *     helper reads it lazily, so a per-case reassignment is observed).
 *   - `globalThis.__DEV__` is toggled per case and fully restored afterwards
 *     so neither the production-silent assertions nor other test files see a
 *     mutated global.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storeReviewSpies = vi.hoisted(() => ({
  isAvailableAsync: vi.fn<[], Promise<boolean>>(),
  requestReview: vi.fn<[], Promise<void>>(),
}));

vi.mock('expo-store-review', () => ({
  isAvailableAsync: storeReviewSpies.isAvailableAsync,
  requestReview: storeReviewSpies.requestReview,
}));

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

// `__DEV__` is a React Native runtime global absent from the vitest node
// environment. Capture whatever (if anything) it was so each case can set it
// explicitly and the suite can restore the original afterwards.
const devGlobal = globalThis as typeof globalThis & { __DEV__?: boolean };
const ORIGINAL_DEV = Object.prototype.hasOwnProperty.call(devGlobal, '__DEV__')
  ? devGlobal.__DEV__
  : undefined;
const HAD_DEV = Object.prototype.hasOwnProperty.call(devGlobal, '__DEV__');

function setDev(value: boolean | undefined): void {
  if (value === undefined) {
    delete devGlobal.__DEV__;
    return;
  }
  devGlobal.__DEV__ = value;
}

// Helper so `warnSpy`'s type is inferred precisely (avoids the generic
// variance mismatch of an explicit `ReturnType<typeof vi.spyOn>` annotation).
function createWarnSpy(): ReturnType<typeof spyOnWarn> {
  return spyOnWarn();
}
function spyOnWarn() {
  return vi.spyOn(console, 'warn').mockImplementation(() => undefined);
}

let warnSpy: ReturnType<typeof createWarnSpy>;

beforeEach(() => {
  storeReviewSpies.isAvailableAsync.mockReset();
  storeReviewSpies.requestReview.mockReset();
  platformHolder.os = 'ios';
  warnSpy = createWarnSpy();
});

afterEach(() => {
  warnSpy.mockRestore();
  setDev(HAD_DEV ? ORIGINAL_DEV : undefined);
});

describe('requestStoreReview — __DEV__-gated console.warn (dev build)', () => {
  beforeEach(() => {
    setDev(true);
  });

  it('warns on the DISPATCH path (available=true)', async () => {
    storeReviewSpies.isAvailableAsync.mockResolvedValue(true);
    storeReviewSpies.requestReview.mockResolvedValue(undefined);

    await requestStoreReview();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = warnSpy.mock.calls[0]?.[0];
    expect(message).toEqual(expect.stringContaining('[store-review]'));
    expect(String(message).toLowerCase()).toEqual(expect.stringContaining('dispatch'));
  });

  it('warns on the UNAVAILABLE path (available=false)', async () => {
    storeReviewSpies.isAvailableAsync.mockResolvedValue(false);

    await requestStoreReview();

    expect(storeReviewSpies.requestReview).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = warnSpy.mock.calls[0]?.[0];
    expect(message).toEqual(expect.stringContaining('[store-review]'));
    expect(String(message).toLowerCase()).toEqual(
      expect.stringContaining('unavailable'),
    );
  });

  it('warns on the ERROR-SWALLOWED path (isAvailableAsync throws)', async () => {
    storeReviewSpies.isAvailableAsync.mockRejectedValue(new Error('native probe boom'));

    await requestStoreReview();

    expect(storeReviewSpies.requestReview).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = warnSpy.mock.calls[0]?.[0];
    expect(message).toEqual(expect.stringContaining('[store-review]'));
    // The swallowed-error breadcrumb surfaces the underlying cause for
    // simulator / TestFlight debugging.
    expect(String(message)).toEqual(expect.stringContaining('native probe boom'));
  });
});

describe('requestStoreReview — production build stays silent (__DEV__ === false)', () => {
  beforeEach(() => {
    setDev(false);
  });

  it('emits NO console.warn on the dispatch path', async () => {
    storeReviewSpies.isAvailableAsync.mockResolvedValue(true);
    storeReviewSpies.requestReview.mockResolvedValue(undefined);

    await requestStoreReview();

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('emits NO console.warn on the unavailable path', async () => {
    storeReviewSpies.isAvailableAsync.mockResolvedValue(false);

    await requestStoreReview();

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('emits NO console.warn on the error-swallowed path', async () => {
    storeReviewSpies.isAvailableAsync.mockRejectedValue(new Error('silent in prod'));

    await requestStoreReview();

    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe('requestStoreReview — bare runtime stays silent (__DEV__ undefined)', () => {
  beforeEach(() => {
    setDev(undefined);
  });

  it('does not throw and emits no console.warn when __DEV__ is undefined', async () => {
    storeReviewSpies.isAvailableAsync.mockResolvedValue(false);

    await expect(requestStoreReview()).resolves.toEqual({
      attempted: false,
      available: false,
      platform: 'ios',
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
