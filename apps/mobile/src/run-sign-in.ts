/**
 * `run-sign-in.ts` — the Sign in with Apple orchestration glue. Sequences the
 * three seams that, together, replace the throwaway `EXPO_PUBLIC_DEV_AUTH_TOKEN`
 * dev-token seam with a real, persisted backend session:
 *
 *   1. {@link acquireAppleCredential} — native Sign in with Apple → an
 *      {@link AppleSignInCredential} (or `null` on cancel / unavailable).
 *   2. `submitSignInWithApple` (via the real {@link createSignInWithAppleTransport})
 *      — POST the credential to `/v1/auth/sign-in-with-apple`, clearing the
 *      stashed referral code + correlating Sentry on success (those concerns
 *      live inside `submitSignInWithApple`).
 *   3. {@link saveAuthToken} — persist the returned access token to the Keychain
 *      so the diagnosis round-trip works now AND across cold relaunches.
 *
 * Outcome contract (drives the diagnosis-input gate UI):
 *   - `signed_in` — token persisted; the gate flips to the capture surface.
 *   - `canceled`  — the user dismissed the system sheet (or Apple auth is
 *     unavailable). A silent no-op: the gate stays put, no error shown.
 *   - `error`     — a genuine failure (native error, network drop, or a non-200
 *     auth rejection such as a 401 invalid_apple_token). `httpStatus` carries
 *     the server status when the failure was an HTTP response, else `null`.
 *
 * Never throws — every failure path is folded into a `SignInResult` so the
 * caller (a `void`-fired press handler in the route) cannot trip an unhandled
 * rejection. Dependency-injected so the success / cancel / error branches are
 * unit-testable without the native module, a live HTTP client, or the Keychain.
 */
import { acquireAppleCredential } from './acquire-apple-credential';
import { createSignInWithAppleTransport } from './sign-in-with-apple-transport';
import {
  submitSignInWithApple,
  type SignInHttpResponse,
} from './submit-sign-in-with-apple';
import { saveAuthToken } from './storage/auth-token-storage';
import type { AppleSignInCredential } from './sign-in-with-apple-request-body';

/** The HTTP status that marks a successful sign-in. */
const HTTP_OK = 200 as const;

/**
 * The terminal outcome of a {@link runSignIn} attempt. A discriminated union so
 * the gate UI can branch exhaustively: flip to capture on `signed_in`, stay put
 * silently on `canceled`, surface a message on `error`.
 */
export type SignInResult =
  | { readonly status: 'signed_in'; readonly userId: string | null }
  | { readonly status: 'canceled' }
  | { readonly status: 'error'; readonly httpStatus: number | null };

/** Optional dependency overrides for {@link runSignIn}. */
export interface RunSignInDeps {
  /** Native credential acquisition (defaults to {@link acquireAppleCredential}). */
  readonly acquire?: () => Promise<AppleSignInCredential | null>;
  /**
   * The credential → backend round-trip. Defaults to `submitSignInWithApple`
   * wired against the real `fetch` transport (which also clears the referral
   * stash + correlates Sentry on a 200). Injected whole in tests so the
   * orchestrator's branching is exercised without AsyncStorage or a live HTTP
   * client.
   */
  readonly signIn?: (credential: AppleSignInCredential) => Promise<SignInHttpResponse>;
  /** Token persistence (defaults to {@link saveAuthToken}). */
  readonly persistToken?: (token: string) => Promise<void>;
}

const defaultSignIn = (
  credential: AppleSignInCredential,
): Promise<SignInHttpResponse> =>
  submitSignInWithApple(credential, createSignInWithAppleTransport());

/**
 * Drive the full Sign in with Apple flow and resolve a {@link SignInResult}.
 *
 * @param deps - optional acquire / signIn / persistToken overrides.
 * @returns the terminal outcome; never throws.
 */
export async function runSignIn(deps: RunSignInDeps = {}): Promise<SignInResult> {
  const acquire = deps.acquire ?? acquireAppleCredential;
  const signIn = deps.signIn ?? defaultSignIn;
  const persistToken = deps.persistToken ?? saveAuthToken;

  let credential: AppleSignInCredential | null;
  try {
    credential = await acquire();
  } catch {
    // A non-cancel native error (acquireAppleCredential rethrows those).
    return { status: 'error', httpStatus: null };
  }
  if (credential === null) {
    // User cancelled the sheet, or Apple auth is unavailable — silent no-op.
    return { status: 'canceled' };
  }

  let response: SignInHttpResponse;
  try {
    response = await signIn(credential);
  } catch {
    // Network drop / transport failure.
    return { status: 'error', httpStatus: null };
  }

  if (
    response.status !== HTTP_OK ||
    response.accessToken === undefined ||
    response.accessToken.length === 0
  ) {
    // A non-200 auth rejection (e.g. 401 invalid_apple_token) or a 200 missing
    // the token — either way there is no session to persist.
    return { status: 'error', httpStatus: response.status };
  }

  try {
    await persistToken(response.accessToken);
  } catch {
    return { status: 'error', httpStatus: response.status };
  }

  return {
    status: 'signed_in',
    userId: response.userId !== undefined ? String(response.userId) : null,
  };
}
