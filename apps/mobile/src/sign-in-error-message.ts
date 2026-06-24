/**
 * `sign-in-error-message.ts` — map a `runSignIn` failure to user-facing Korean
 * copy, distinguishing "couldn't reach the backend" from "the backend rejected
 * the sign-in".
 *
 * Why the distinction matters (the lesson from the sign-in debugging saga):
 *   Every sign-in failure used to show one generic line ("로그인에 실패했어요").
 *   But the real cause was usually that the (free-tier) backend was asleep or
 *   mid-redeploy, so the POST never reached a live instance — a transient,
 *   not-your-fault condition. A single message made the user suspect their own
 *   credentials and gave the developer no on-screen signal to tell a server
 *   outage apart from a genuine rejection.
 *
 * The discriminant is `runSignIn`'s `httpStatus`:
 *   - `null`   → no completed HTTP response: a native acquire failure, a
 *                dropped connection, or the backend was unreachable. Usually
 *                transient → nudge a retry and name the connection as suspect.
 *   - a number → the backend returned a non-200 (e.g. 401 invalid_apple_token):
 *                a genuine sign-in rejection.
 */

/** Connectivity / unreachable-backend copy (httpStatus === null). */
export const SIGN_IN_NETWORK_MESSAGE =
  '지금 서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.';

/** Backend-rejection copy (a non-200 HTTP status came back). */
export const SIGN_IN_REJECTED_MESSAGE = '로그인에 실패했어요. 다시 시도해 주세요.';

/**
 * Pick the sign-in error copy for a `runSignIn` `'error'` outcome.
 *
 * @param httpStatus - the `httpStatus` from the `SignInResult`: `null` when no
 *   HTTP response completed, else the backend's status code.
 */
export function signInErrorMessage(httpStatus: number | null): string {
  return httpStatus === null ? SIGN_IN_NETWORK_MESSAGE : SIGN_IN_REJECTED_MESSAGE;
}
