/**
 * Unit test — `config/auth-token.ts` (access-token resolution order).
 *
 * Drives `getAuthToken` through injected `readStored` / `devToken` seams to pin
 * the "persisted real session wins, dev seam is the fallback, else null"
 * contract without touching the Keychain or `process.env`.
 */
import { describe, expect, it, vi } from 'vitest';

import { getAuthToken } from '../src/config/auth-token';

describe('getAuthToken', () => {
  it('returns the persisted token and never consults the dev seam', async () => {
    const devToken = vi.fn();
    const result = await getAuthToken({
      readStored: () => Promise.resolve('eyJ.backend.jwt'),
      devToken,
    });
    expect(result).toBe('eyJ.backend.jwt');
    expect(devToken).not.toHaveBeenCalled();
  });

  it('falls back to the dev seam when no token is persisted', async () => {
    const result = await getAuthToken({
      readStored: () => Promise.resolve(null),
      devToken: () => 'dev-token',
    });
    expect(result).toBe('dev-token');
  });

  it('treats a blank persisted value as absent and falls back to the dev seam', async () => {
    const result = await getAuthToken({
      readStored: () => Promise.resolve(''),
      devToken: () => 'dev-token',
    });
    expect(result).toBe('dev-token');
  });

  it('returns null when neither source has a token', async () => {
    const result = await getAuthToken({
      readStored: () => Promise.resolve(null),
      devToken: () => null,
    });
    expect(result).toBeNull();
  });
});
