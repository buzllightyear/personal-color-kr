/**
 * `clear-token-on-unauthorized.ts` — the auth self-heal seam.
 *
 * The problem it fixes (the #100 stale-token trap, generalised):
 *   The step-7 sign-in gate trusts the *presence* of a Keychain token, not its
 *   validity. So an invalid token — expired, or minted against a rotated
 *   `JWT_SECRET` (e.g. the Fly → Render backend move) — silently passes the
 *   gate, then 401s every authed call (catalog / gallery / generate) with no
 *   in-app way to recover. The user is stuck until a reinstall + key-namespace
 *   bump. Token EXPIRY makes this a normal-operation hazard, not a one-off
 *   migration artifact.
 *
 * The fix:
 *   When an authed call fails with a 401 / `unauthorized` error, discard the
 *   stored token. The gate checks the Keychain on its next mount (and on the
 *   next cold launch), finds nothing, shows the Apple button, and the user
 *   re-authenticates against the live backend — no reinstall, no code change.
 *   Future secret rotations and token expiries now self-heal.
 *
 * Why a tiny dedicated module:
 *   Three routes need the identical "on 401, clear the token" reaction. Keeping
 *   the detection + clear in one injectable function means the routes call one
 *   line, and the behaviour is unit-tested once (not re-asserted per route).
 */
import { isUnauthorized } from './api-error';
import { clearAuthToken } from './storage/auth-token-storage';

/** Optional dependency overrides for {@link clearTokenOnUnauthorized}. */
export interface ClearTokenOnUnauthorizedDeps {
  /** Predicate deciding whether the error is a 401 (defaults to {@link isUnauthorized}). */
  readonly isUnauthorizedError?: (err: unknown) => boolean;
  /** Token removal (defaults to {@link clearAuthToken}). */
  readonly clear?: () => Promise<void>;
}

/**
 * If `err` means the stored session is invalid (401 / `unauthorized`), clear the
 * persisted access token so the next gate mount forces a fresh sign-in.
 *
 * @returns `true` when a token clear was performed, `false` otherwise — so a
 *   caller can branch (e.g. flip auth state) on whether the session was reset.
 *   Never throws for a non-401 error; it simply no-ops and returns `false`.
 */
export async function clearTokenOnUnauthorized(
  err: unknown,
  deps: ClearTokenOnUnauthorizedDeps = {},
): Promise<boolean> {
  const detect = deps.isUnauthorizedError ?? isUnauthorized;
  if (!detect(err)) {
    return false;
  }
  const clear = deps.clear ?? clearAuthToken;
  await clear();
  return true;
}
