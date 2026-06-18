/**
 * `submitSignInWithApple(credential, transport, deps)` — the orchestration
 * glue that POSTs an Apple Sign In and, on a successful response (HTTP 200),
 * clears the stashed referral code from AsyncStorage (Phase 4.5, ontology
 * `stashed_referral_code` — "cleanup after attribution").
 *
 * Why this module exists:
 *   Three pure pieces already exist and are independently unit-tested:
 *     - `buildSignInWithAppleRequestBody` reads the stashed code and assembles
 *       the wire body (attach side, AC 13);
 *     - `clearStashedReferralCode` removes the AsyncStorage key (cleanup side,
 *       `referral-storage.ts`).
 *   What was missing is the seam that *sequences* them around the network
 *   call: build the body → POST it → and ONLY when the server accepted the
 *   sign-in (HTTP 200) remove the stash so the same code can never be
 *   re-attributed on a later sign-in. This module is that seam, kept as a
 *   standalone dependency-injected function so the "when exactly is the stash
 *   cleared" decision is unit-testable without a live HTTP client, expo
 *   modules, or a real AsyncStorage backend.
 *
 * The Seed-locked semantics this module encodes:
 *   - **clear on HTTP 200 only** — a successful sign-in is the single trigger
 *     for cleanup. Any non-200 status (network/auth/server error) leaves the
 *     stash intact so the referral code survives for the user's next attempt.
 *     This mirrors the server contract where attribution rides inside the
 *     auth transaction: if the auth call did not succeed, the code has not
 *     been (and must remain available to be) attributed.
 *   - **idempotent cleanup** — the clear runs on every 200, including an
 *     organic sign-up where nothing was stashed. `clearStashedReferralCode`
 *     is a no-op on an absent key, so the contract is simply "clear on 200",
 *     not the more fragile "clear only when a code was sent".
 *   - **no attribution logic client-side** — validity, self-referral and
 *     already-attributed guards all live server-side and silently skip; the
 *     client merely forwards what it stashed and, on success, forgets it.
 *
 * Scope discipline:
 *   This function owns sequencing only. The HTTP transport is injected (the
 *   caller wires a real `fetch` against `POST /v1/auth/sign-in-with-apple`),
 *   so this module pulls in no network dependency and stays portable across
 *   the test environment and the app runtime.
 */
import {
  buildSignInWithAppleRequestBody,
  type AppleSignInCredential,
  type SignInWithAppleRequestBody,
  type StashedReferralCodeReader,
} from './sign-in-with-apple-request-body';
import {
  clearStashedReferralCode,
  readStashedReferralCode,
} from './storage/referral-storage';
import { setSentryUser, type SentryUserPayload } from './set-sentry-user';

/**
 * The HTTP-status-bearing result of the sign-in POST. Deliberately minimal —
 * this module only needs the status code to decide whether the sign-in
 * succeeded (HTTP 200) and the stash may be cleared. The caller's transport
 * adapter maps its real HTTP response down to this shape.
 *
 * On a successful sign-in (HTTP 200) the server returns the inline
 * `response.user` projection; the transport adapter surfaces that user's id
 * here as `userId` so the success path can attach it to the Sentry scope
 * (Phase 7.3, ontology `userId` — the sole PII field correlated to Sentry).
 * It is optional because the *only* thing the clear-on-200 contract requires
 * is the status code; a transport that omits `userId` (or a non-200 response)
 * simply skips the Sentry correlation without breaking sign-in.
 */
export interface SignInHttpResponse {
  readonly status: number;
  readonly userId?: string | number;
  /**
   * The backend-issued HS256 access token from a successful sign-in
   * (`response.access_token`). Surfaced by the transport adapter so the
   * orchestration layer (`run-sign-in.ts`) can persist it to the Keychain.
   * Optional because the clear-on-200 / Sentry concerns this module owns need
   * only the status + user id; a transport that omits it (or a non-200
   * response) simply yields no token to persist.
   */
  readonly accessToken?: string;
}

/**
 * The injectable network seam: given the assembled request body, perform the
 * `POST /v1/auth/sign-in-with-apple` and resolve to its HTTP status. Injected
 * so tests drive the success / failure branches without a live HTTP client,
 * and so the app can wire a real `fetch` at the call site.
 */
export type SignInWithAppleTransport = (
  body: SignInWithAppleRequestBody,
) => Promise<SignInHttpResponse>;

/**
 * The HTTP status that marks a successful sign-in and therefore triggers the
 * cleanup of the stashed referral code.
 */
const HTTP_OK = 200 as const;

/**
 * Optional dependency overrides for the stash read / clear side effects.
 * Both default to the real AsyncStorage-backed wrappers; tests inject
 * in-memory stubs to assert the clear-on-200 contract.
 */
export interface SubmitSignInWithAppleDeps {
  readonly readStash?: StashedReferralCodeReader;
  readonly clearStash?: () => Promise<void>;
  /**
   * Override for the Sentry user-correlation seam. Defaults to the real
   * {@link setSentryUser} (id-only, fail-open). Injected so tests can assert
   * the success path attaches the user id without resolving the native
   * `@sentry/react-native` SDK.
   */
  readonly setUser?: (user: SentryUserPayload) => void;
}

/**
 * POST an Apple Sign In and clear the stashed referral code on success.
 *
 * Sequence:
 *   1. read the stashed referral code and assemble the request body
 *      (delegated to `buildSignInWithAppleRequestBody`);
 *   2. hand the body to the injected `transport` (the real HTTP POST);
 *   3. ONLY when the response status is exactly 200, clear the stash so the
 *      same referral code is never re-attributed on a subsequent sign-in, and
 *      — when the transport surfaced the authenticated user's id — attach that
 *      id (stringified) to the Sentry scope via {@link setSentryUser} so every
 *      error captured while signed in is correlated to the user by id alone
 *      (Phase 7.3, ontology `userId`). The Sentry call is fail-open inside
 *      `setSentryUser`, so observability never breaks sign-in.
 *
 * The transport's response is returned verbatim so the caller can drive
 * navigation / error UI off the same status this function inspected.
 *
 * @param credential - the Apple Sign In credential fields (camelCase).
 * @param transport - injectable HTTP seam performing the actual POST.
 * @param deps - optional stash read / clear / setUser overrides (default to
 *   the real AsyncStorage wrappers and the real id-only Sentry seam).
 * @returns the transport's HTTP response.
 */
export async function submitSignInWithApple(
  credential: AppleSignInCredential,
  transport: SignInWithAppleTransport,
  deps: SubmitSignInWithAppleDeps = {},
): Promise<SignInHttpResponse> {
  const readStash = deps.readStash ?? readStashedReferralCode;
  const clearStash = deps.clearStash ?? clearStashedReferralCode;
  const setUser = deps.setUser ?? setSentryUser;

  const body = await buildSignInWithAppleRequestBody(credential, readStash);
  const response = await transport(body);
  if (response.status === HTTP_OK) {
    await clearStash();
    // Auth success: correlate the authenticated user with Sentry by id alone
    // (`String(userId)`). Guarded on presence so a transport that omits the id
    // never sends a bogus `"undefined"` user; `setSentryUser` is itself
    // fail-open and id-only, so no PII leaks and sign-in is never blocked.
    if (response.userId != null) {
      setUser({ id: String(response.userId) });
    }
  }
  return response;
}
