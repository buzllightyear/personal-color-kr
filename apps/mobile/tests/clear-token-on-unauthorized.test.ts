/**
 * Unit test — `clearTokenOnUnauthorized` (auth self-heal).
 *
 * Verifies the seam clears the persisted token exactly when the caught error
 * means the session is invalid (401 / `unauthorized`) and no-ops otherwise.
 */
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../src/api-error';
import { clearTokenOnUnauthorized } from '../src/clear-token-on-unauthorized';

describe('clearTokenOnUnauthorized', () => {
  it('clears the token and returns true on a 401 ApiError', async () => {
    const clear = vi.fn(async () => undefined);
    const did = await clearTokenOnUnauthorized(new ApiError(401), { clear });
    expect(did).toBe(true);
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it("clears on a kind:'unauthorized' error (generation client)", async () => {
    const clear = vi.fn(async () => undefined);
    const did = await clearTokenOnUnauthorized({ kind: 'unauthorized' }, { clear });
    expect(did).toBe(true);
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('does NOT clear (returns false) on a non-401 / network / unknown error', async () => {
    const clear = vi.fn(async () => undefined);
    expect(await clearTokenOnUnauthorized(new ApiError(500), { clear })).toBe(false);
    expect(await clearTokenOnUnauthorized({ kind: 'network' }, { clear })).toBe(false);
    expect(await clearTokenOnUnauthorized(new Error('x'), { clear })).toBe(false);
    expect(clear).not.toHaveBeenCalled();
  });

  it('honours an injected detector override', async () => {
    const clear = vi.fn(async () => undefined);
    const did = await clearTokenOnUnauthorized(new Error('anything'), {
      isUnauthorizedError: () => true,
      clear,
    });
    expect(did).toBe(true);
    expect(clear).toHaveBeenCalledTimes(1);
  });
});
