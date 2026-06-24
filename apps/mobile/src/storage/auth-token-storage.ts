/**
 * Backend access-token persistence — the `expo-secure-store` (iOS Keychain)
 * boundary for the HS256 JWT minted by `POST /v1/auth/sign-in-with-apple`.
 *
 * Why SecureStore (not AsyncStorage):
 *   The access token is a bearer credential — anyone holding it can call the
 *   authenticated endpoints (`/v1/diagnose`) as the user until it expires.
 *   AsyncStorage is plaintext on disk; `expo-secure-store` persists to the iOS
 *   Keychain (hardware-encrypted, app-sandboxed), which is the correct home for
 *   a credential. This wrapper is therefore deliberately separate from the
 *   `referral-storage.ts` AsyncStorage stash — different sensitivity, different
 *   backing store.
 *
 * Why it survives a cold relaunch:
 *   Persisting the token lets a returning user skip re-authentication — the
 *   diagnosis token resolver (`config/auth-token.ts`) reads it here so the real
 *   `POST /v1/diagnose` round-trip works across app restarts without a fresh
 *   Apple Sign In.
 *
 * Why dependency-injected:
 *   `expo-secure-store` is a native module — unavailable in the vitest node env
 *   (aliased to an inert stub). Injecting the store lets the save / read / clear
 *   contract be unit-tested against an in-memory map without the real Keychain.
 */
import * as SecureStore from 'expo-secure-store';

/**
 * SecureStore namespaced key for the backend access token. The `pck.auth.*`
 * prefix (personal-color-kr) makes the key grep-discoverable and collision-safe
 * against the AsyncStorage `pck.referral.*` / `pck.post_payment.*` keys.
 *
 * `.v2` suffix (2026-06-24): the backend moved Fly → Render, which rotated
 * `JWT_SECRET`, so every token minted against the old backend is now invalid
 * (401). iOS Keychain persists SecureStore items across app DELETION + reinstall,
 * so a stale `.accessToken` token survives uninstall, auto-passes the
 * `diagnosis-input` sign-in gate (it checks token *presence*, not validity), and
 * then 401s every authed call (catalog/gallery) with no way to re-auth in-app.
 * Bumping the key namespace is the only reliable client-side invalidation: the
 * new build reads `.v2` (empty) → the gate shows → the user re-auths against
 * Render and gets a valid token. Follow-up (tracked): clear the token on a 401
 * from an authed endpoint so future secret rotations / expiries self-heal.
 */
export const AUTH_TOKEN_STORE_KEY = 'pck.auth.accessToken.v2' as const;

/**
 * Minimal structural slice of `expo-secure-store` this module drives —
 * injectable so the unit test supplies an in-memory map instead of the
 * native Keychain.
 */
export interface SecureStoreLike {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

/** Optional dependency override for the SecureStore backend. */
export interface AuthTokenStorageDeps {
  readonly store?: SecureStoreLike;
}

const defaultStore: SecureStoreLike = {
  getItemAsync: SecureStore.getItemAsync,
  setItemAsync: SecureStore.setItemAsync,
  deleteItemAsync: SecureStore.deleteItemAsync,
};

/**
 * Persist the backend access token to the Keychain.
 *
 * @throws when `token` is blank — a useless empty credential is a programming
 *   error at the call site (the sign-in transport only resolves a token on an
 *   HTTP 200), never a value worth storing.
 */
export async function saveAuthToken(
  token: string,
  deps: AuthTokenStorageDeps = {},
): Promise<void> {
  const trimmed = token.trim();
  if (trimmed.length === 0) {
    throw new Error('saveAuthToken: refusing to persist a blank access token');
  }
  const store = deps.store ?? defaultStore;
  await store.setItemAsync(AUTH_TOKEN_STORE_KEY, trimmed);
}

/**
 * Read the persisted access token, or `null` when none is stored (or the stored
 * value is blank — normalised so the diagnosis resolver treats "nothing usable"
 * uniformly as `null`).
 */
export async function readAuthToken(
  deps: AuthTokenStorageDeps = {},
): Promise<string | null> {
  const store = deps.store ?? defaultStore;
  const raw = await store.getItemAsync(AUTH_TOKEN_STORE_KEY);
  if (raw === null) {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Remove the persisted access token (sign-out / token-invalidation cleanup). */
export async function clearAuthToken(deps: AuthTokenStorageDeps = {}): Promise<void> {
  const store = deps.store ?? defaultStore;
  await store.deleteItemAsync(AUTH_TOKEN_STORE_KEY);
}
