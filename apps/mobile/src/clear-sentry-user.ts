/**
 * `clearSentryUser()` — the sign-out-side scaffolding helper that detaches the
 * authenticated user's correlation id from the active Sentry scope (Phase 7.3).
 *
 * # Why this module exists
 *
 * Phase 7.3 wires id-only user correlation into Sentry on the *sign-in* side
 * (`src/set-sentry-user.ts` :: `setSentryUser`, called from the Apple Sign In
 * success path). The mirror obligation is the *sign-out* side: once the user
 * is no longer authenticated, the previously-attached `{ id }` must be cleared
 * from the Sentry scope so that any error/transaction captured afterwards is
 * NOT mis-attributed to the just-departed user.
 *
 * Per the Seed constraint "No sign-out UX creation (only scaffolding helper)",
 * this module ships *only* the observability seam — it does not build any
 * sign-out screen, button, or navigation flow. It is the single, dependency-
 * injectable function a future sign-out handler will call; until that handler
 * exists the helper stands ready and is fully unit-tested in isolation.
 *
 * # Contract (mirrors the api Phase 7.2c `set_request_user` discipline)
 *
 *   1. **Clear, not redact** — calls `Sentry.setUser(null)`. Passing `null`
 *      (rather than `{}` or a sentinel id) is the SDK-blessed way to drop the
 *      user from the scope entirely, so subsequent events carry no user
 *      context at all until the next `setSentryUser({ id })`.
 *   2. **id-only discipline preserved** — there is nothing to send here (the
 *      whole point is to remove context), so the "only `{ id }` ever reaches
 *      Sentry" invariant from the set-side is trivially upheld: no PII, no
 *      email, no username ever flows through this path.
 *   3. **Fail-open** — observability instrumentation must NEVER break the
 *      sign-out path. Any throw from `Sentry.setUser` (SDK uninitialized after
 *      a fail-open `initSentry`, scope error, native bridge hiccup, …) is
 *      swallowed and logged once as a `sentry_clear_user_failed` `console.warn`
 *      — it never propagates. This is the third fail-open layer described by
 *      the Seed (native inherent no-op + JS init try/catch + setUser/clearUser
 *      try/catch), matching the api's `sentry_set_user_failed` warn-and-continue
 *      stance from Phase 7.2c.
 *
 * # Why `console.warn` with a structured-ish marker string
 *
 * The api logs `sentry_set_user_failed` through its JSON logger; the mobile app
 * has no server-side logger, so the closest parity is a single `console.warn`
 * whose first argument is the stable `sentry_clear_user_failed` marker (the
 * same convention `initSentry` uses for `sentry_init_skipped` /
 * `sentry_init_failed`). Tests assert against that marker rather than a
 * free-form message, so the log contract cannot silently drift.
 *
 * # Why the native SDK import is unconditional here
 *
 * `@sentry/react-native` is mocked wholesale in the vitest suite
 * (`vi.mock('@sentry/react-native', ...)`), so this module never resolves the
 * Objective-C-backed native shim under the Node test runner. At runtime the
 * import is the real SDK and `setUser(null)` is a safe no-op even when the SDK
 * was never initialized (the inherent first fail-open layer).
 */
import * as Sentry from '@sentry/react-native';

/**
 * Stable marker logged (as the first `console.warn` argument) when
 * `Sentry.setUser(null)` throws. Exported so unit tests can assert against the
 * constant instead of a duplicated string literal — a rename then surfaces as a
 * compile-time break at the single import site rather than a silent log drift.
 *
 * Mirrors the api's `sentry_set_user_failed` structured log key and the
 * `initSentry` `sentry_init_*` markers, keeping the mobile Sentry failure
 * vocabulary aligned across init / set / clear.
 */
export const SENTRY_CLEAR_USER_FAILED_MARKER = 'sentry_clear_user_failed' as const;

/**
 * Detach the authenticated user from the active Sentry scope (fail-open).
 *
 * Intended to be called from a future sign-out handler so that errors captured
 * after sign-out are not attributed to the departed user. Calls
 * `Sentry.setUser(null)` — the SDK contract for fully clearing user context —
 * and swallows any failure: a Sentry scope error must never break sign-out.
 *
 * The call is defensively wrapped; on failure a single
 * {@link SENTRY_CLEAR_USER_FAILED_MARKER} `console.warn` is emitted and the
 * function returns normally. It never throws and returns nothing — the caller's
 * sign-out flow is unaffected by Sentry's state.
 */
export function clearSentryUser(): void {
  try {
    Sentry.setUser(null);
  } catch {
    // Fail-open: observability must never break the sign-out path. Log once
    // with the stable marker (no user data to leak — we are clearing context)
    // and continue. Matches the api `sentry_set_user_failed` warn-and-continue
    // discipline from Phase 7.2c.
    console.warn(SENTRY_CLEAR_USER_FAILED_MARKER);
  }
}
