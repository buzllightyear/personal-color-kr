/**
 * `setSentryUser({ id })` — the sign-in-side scaffolding helper that attaches
 * the authenticated user's correlation id to the active Sentry scope
 * (Phase 7.3).
 *
 * # Why this module exists
 *
 * Phase 7.3 wires id-only user correlation into Sentry on the *sign-in* side.
 * Once Apple Sign In succeeds (`src/submit-sign-in-with-apple.ts`), the user's
 * numeric id (stringified) is attached to the Sentry scope so that every error
 * and transaction captured afterwards is correlated to that user — WITHOUT ever
 * sending email, name, or any other PII. The mirror obligation on sign-out is
 * `src/clear-sentry-user.ts` :: `clearSentryUser`.
 *
 * Like its clear-side twin, this module is a single, dependency-injectable
 * function that the auth-success path calls; it builds no UX and owns no auth
 * flow — only the observability seam.
 *
 * # Contract (mirrors the api Phase 7.2c `set_request_user` discipline)
 *
 *   1. **id-only** — calls `Sentry.setUser({ id })` and NOTHING else. The
 *      payload type is `{ id: string }`, and the implementation re-constructs a
 *      fresh `{ id }` object rather than forwarding the caller's object verbatim,
 *      so even a defensively over-broad argument cannot leak extra fields into
 *      Sentry. This is the sole `userId` PII concept from the ontology — no
 *      email, username, IP, or any other attribute ever flows through here.
 *   2. **Fail-open** — observability instrumentation must NEVER break the
 *      sign-in path. Any throw from `Sentry.setUser` (SDK uninitialized after a
 *      fail-open `initSentry`, scope error, native bridge hiccup, …) is
 *      swallowed and logged once as a `sentry_set_user_failed` `console.warn` —
 *      it never propagates. This is the third fail-open layer described by the
 *      Seed (native inherent no-op + JS init try/catch + setUser/clearUser
 *      try/catch), matching the api's `sentry_set_user_failed`
 *      warn-and-continue stance from Phase 7.2c.
 *
 * # Why `console.warn` with a structured-ish marker string
 *
 * The api logs `sentry_set_user_failed` through its JSON logger; the mobile app
 * has no server-side logger, so the closest parity is a single `console.warn`
 * whose first argument is the stable `sentry_set_user_failed` marker (the same
 * convention `initSentry` uses for `sentry_init_skipped` / `sentry_init_failed`
 * and `clearSentryUser` uses for `sentry_clear_user_failed`). Tests assert
 * against that marker rather than a free-form message, so the log contract
 * cannot silently drift.
 *
 * # Why the native SDK import is unconditional here
 *
 * `@sentry/react-native` is mocked wholesale in the vitest suite
 * (`vi.mock('@sentry/react-native', ...)`), so this module never resolves the
 * Objective-C-backed native shim under the Node test runner. At runtime the
 * import is the real SDK and `setUser({ id })` is a safe no-op even when the SDK
 * was never initialized (the inherent first fail-open layer).
 */
import * as Sentry from '@sentry/react-native';

/**
 * The id-only payload accepted by {@link setSentryUser}. Deliberately the sole
 * `userId` PII concept from the ontology — there is intentionally no `email`,
 * `username`, or any other field, so the id-only discipline is enforced by the
 * type system at every call site, not just by convention.
 */
export interface SentryUserPayload {
  /** The authenticated user's numeric id, stringified. The only PII sent. */
  readonly id: string;
}

/**
 * Stable marker logged (as the first `console.warn` argument) when
 * `Sentry.setUser({ id })` throws. Exported so unit tests can assert against the
 * constant instead of a duplicated string literal — a rename then surfaces as a
 * compile-time break at the single import site rather than a silent log drift.
 *
 * Mirrors the api's `sentry_set_user_failed` structured log key and the
 * `initSentry` `sentry_init_*` / `clearSentryUser` `sentry_clear_user_failed`
 * markers, keeping the mobile Sentry failure vocabulary aligned across
 * init / set / clear.
 */
export const SENTRY_SET_USER_FAILED_MARKER = 'sentry_set_user_failed' as const;

/**
 * Attach the authenticated user's id to the active Sentry scope (fail-open).
 *
 * Intended to be called from the Apple Sign In success path so that errors
 * captured while signed in are correlated to the user by id alone. Forwards a
 * freshly-constructed `{ id }` to `Sentry.setUser` — never the caller's object —
 * so no PII beyond the id can leak, and swallows any failure: a Sentry scope
 * error must never break sign-in.
 *
 * The call is defensively wrapped; on failure a single
 * {@link SENTRY_SET_USER_FAILED_MARKER} `console.warn` is emitted and the
 * function returns normally. It never throws and returns nothing — the caller's
 * sign-in flow is unaffected by Sentry's state.
 */
export function setSentryUser(user: SentryUserPayload): void {
  try {
    // Re-construct the object so ONLY `id` ever reaches Sentry, even if the
    // caller (defensively) handed an over-broad object. Upholds the ontology's
    // "userId is the sole PII field" invariant at the boundary.
    Sentry.setUser({ id: user.id });
  } catch {
    // Fail-open: observability must never break the sign-in path. Log once with
    // the stable marker and continue. Matches the api `sentry_set_user_failed`
    // warn-and-continue discipline from Phase 7.2c.
    console.warn(SENTRY_SET_USER_FAILED_MARKER);
  }
}
