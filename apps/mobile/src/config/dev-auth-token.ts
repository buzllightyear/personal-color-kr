/**
 * `getDevAuthToken()` — a TEMPORARY development seam for the backend JWT that
 * `POST /v1/diagnose` (and other authenticated endpoints) require.
 *
 * Why this exists (and why it is temporary):
 *   The real access token is minted by `POST /v1/auth/sign-in-with-apple`,
 *   which is gated on the Apple Developer membership (Apple Sign In cannot be
 *   exercised until the account is active). Until that auth-session store is
 *   wired, this accessor lets a developer inject a hand-minted token via the
 *   `EXPO_PUBLIC_DEV_AUTH_TOKEN` env var so the diagnosis round-trip can be
 *   exercised end-to-end against a running backend before membership lands.
 *
 *   When the Apple Sign In session store is implemented, the diagnosis call
 *   site should read the token from that store instead, and this module should
 *   be deleted. It is deliberately isolated to a single import site so that
 *   removal is a one-file change.
 *
 * Defensive contract:
 *   Returns `null` when the var is unset or blank — the diagnosis call site
 *   treats a `null` token as "skip the real call, fall back to the static
 *   teaser", so a developer without a token sees the existing fake-scan
 *   behaviour rather than a crash or a guaranteed-401 network call.
 *
 * Why `EXPO_PUBLIC_`:
 *   Expo inlines `process.env.EXPO_PUBLIC_*` into the JS bundle at build time.
 *   A dev JWT is non-secret-by-nature (short-lived, developer-scoped) and only
 *   present in local builds — never a production secret — so the
 *   `EXPO_PUBLIC_` channel is acceptable for this throwaway seam.
 */

/** The Expo public env var carrying a hand-minted dev JWT (throwaway seam). */
export const DEV_AUTH_TOKEN_ENV_KEY = 'EXPO_PUBLIC_DEV_AUTH_TOKEN' as const;

/**
 * Resolve the development access token from the environment.
 *
 * @returns the configured token, or `null` when the env var is unset / blank.
 */
export function getDevAuthToken(): string | null {
  const raw = process.env[DEV_AUTH_TOKEN_ENV_KEY];
  if (raw === undefined || raw.length === 0) {
    return null;
  }
  return raw;
}
