/**
 * Unit test — `storage/auth-token-storage.ts` (Keychain-backed JWT persistence).
 *
 * The native `expo-secure-store` is aliased to an inert stub in
 * `vitest.config.ts`; here we drive the save / read / clear wrappers through an
 * injected in-memory store to pin the round-trip, the blank-normalises-to-null
 * read, and the namespaced key contract without touching the real Keychain.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  AUTH_TOKEN_STORE_KEY,
  clearAuthToken,
  readAuthToken,
  saveAuthToken,
  type SecureStoreLike,
} from '../src/storage/auth-token-storage';

function inMemoryStore(initial: Record<string, string> = {}): SecureStoreLike & {
  dump: () => Record<string, string>;
} {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItemAsync: (key) => Promise.resolve(map.get(key) ?? null),
    setItemAsync: (key, value) => {
      map.set(key, value);
      return Promise.resolve();
    },
    deleteItemAsync: (key) => {
      map.delete(key);
      return Promise.resolve();
    },
    dump: () => Object.fromEntries(map),
  };
}

describe('auth-token-storage', () => {
  it('persists a token under the namespaced pck.auth.* key and reads it back', async () => {
    const store = inMemoryStore();
    await saveAuthToken('eyJ.backend.jwt', { store });
    expect(store.dump()).toEqual({ [AUTH_TOKEN_STORE_KEY]: 'eyJ.backend.jwt' });
    expect(await readAuthToken({ store })).toBe('eyJ.backend.jwt');
  });

  it('returns null when no token has been stored', async () => {
    const store = inMemoryStore();
    expect(await readAuthToken({ store })).toBeNull();
  });

  it('normalises a blank stored value to null', async () => {
    const store = inMemoryStore({ [AUTH_TOKEN_STORE_KEY]: '   ' });
    expect(await readAuthToken({ store })).toBeNull();
  });

  it('rejects an empty token rather than persisting a useless value', async () => {
    const setItemAsync = vi.fn();
    await expect(
      saveAuthToken('   ', { store: { ...inMemoryStore(), setItemAsync } }),
    ).rejects.toThrow();
    expect(setItemAsync).not.toHaveBeenCalled();
  });

  it('clears a stored token', async () => {
    const store = inMemoryStore({ [AUTH_TOKEN_STORE_KEY]: 'eyJ.backend.jwt' });
    await clearAuthToken({ store });
    expect(store.dump()).toEqual({});
    expect(await readAuthToken({ store })).toBeNull();
  });
});
