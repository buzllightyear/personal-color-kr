/**
 * `getAuthToken(deps)` — the single async resolver for the backend access token
 * the authenticated endpoints (`POST /v1/diagnose`) require.
 *
 * Resolution order (stored wins):
 *   1. the Keychain-persisted token minted by a real Apple Sign In
 *      ({@link readAuthToken}) — the production path, surviving cold relaunches;
 *   2. the throwaway `EXPO_PUBLIC_DEV_AUTH_TOKEN` dev seam
 *      ({@link getDevAuthToken}) — the pre-membership fallback that let the
 *      diagnosis round-trip be exercised before Apple Sign In was wired.
 *
 * Returning `null` when neither is present preserves the funnel's graceful
 * degradation: the diagnosis call site treats a `null` token as "skip the real
 * call, fall back to the static teaser".
 *
 * This module supersedes the read-side of `config/dev-auth-token.ts` at the
 * diagnosis call site; the dev seam remains only as the secondary fallback so a
 * developer without a signed-in session can still inject a hand-minted token.
 *
 * Async (unlike the old synchronous dev-only read) because the persisted token
 * lives in the Keychain via `expo-secure-store`, whose reads are Promise-based.
 */
import { readAuthToken } from '../storage/auth-token-storage';
import { getDevAuthToken } from './dev-auth-token';

/** Optional dependency overrides for {@link getAuthToken}. */
export interface GetAuthTokenDeps {
  /** Read the Keychain-persisted token (defaults to {@link readAuthToken}). */
  readonly readStored?: () => Promise<string | null>;
  /** Read the dev-seam token (defaults to {@link getDevAuthToken}). */
  readonly devToken?: () => string | null;
}

/**
 * Resolve the access token to attach to authenticated requests, preferring the
 * persisted real session over the dev seam.
 *
 * @param deps - optional stored/dev reader overrides (default to the real ones).
 * @returns the token, or `null` when neither source has one.
 */
export async function getAuthToken(
  deps: GetAuthTokenDeps = {},
): Promise<string | null> {
  const readStored = deps.readStored ?? (() => readAuthToken());
  const devToken = deps.devToken ?? getDevAuthToken;

  const stored = await readStored();
  if (stored !== null && stored.length > 0) {
    return stored;
  }
  return devToken();
}
