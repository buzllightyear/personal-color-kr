/**
 * Funnel guard stubs — state-dependent decisions for the 12-step funnel.
 *
 * Why this file is prefixed with an underscore:
 *   Expo Router treats any filename starting with `_` as a NON-route file,
 *   so it will not be picked up as a navigable screen. This lets us colocate
 *   the guard utilities inside the `(funnel)` route group without leaking a
 *   `/_guards` URL into the navigation tree.
 *
 * Why every guard is a stub:
 *   Real state lookup (funnel state machine, AsyncStorage rating-skip count,
 *   PostHog feature flags, Supabase subscription_active) lands in Phase 3/4.
 *   Until then, every guard returns a CONSERVATIVE DEFAULT — the answer that
 *   preserves the linear 1→12 navigation invariant when state cannot be
 *   resolved — and emits a `console.warn` so callers cannot silently rely on
 *   the placeholder in production. The fail-loud signal is intentional:
 *   silent defaults would let real wiring regress unnoticed.
 *
 * Conservative defaults — quick reference:
 *   - `shouldDismissRating()`       → `false`  (SHOW the rating step; do not skip)
 *   - `shouldBypassReferral()`      → `false`  (no step-10 invited-state bypass)
 *   - `shouldSkipFunnelSubscribed()` → `false`  (no funnel skip for active subscribers)
 *
 * Each guard is a pure function (no parameters, no closure over module
 * state), which makes them trivial to unit test and to swap for real
 * state-reading implementations later without changing call sites.
 */

/**
 * Sub-AC 6.1 — Rating-skip guard.
 *
 * Question this guard answers:
 *   "Should the funnel SKIP the rating-gate step (step 6) for this user?"
 *
 * Real implementation (Phase 3/4) will read:
 *   1. AsyncStorage key tracking how many times the user has dismissed the
 *      iOS `SKStoreReviewController` / Android in-app review prompt.
 *   2. A debounce window (e.g. "skip if dismissed ≥ 2 times in last 30
 *      days") sourced from a PostHog feature flag.
 *
 * Stub behaviour:
 *   - Returns `false` so the funnel SHOWS the rating step. This keeps the
 *     linear 12-step invariant intact: an under-specified guard must never
 *     silently skip a step.
 *   - Emits `console.warn` mentioning the guard name and its stub status so
 *     any caller exercising this code path in non-development environments
 *     produces a loud, greppable signal.
 *
 * The function is intentionally synchronous + parameter-free. State-reading
 * implementations will be added by introducing a sibling async variant
 * (e.g. `useShouldDismissRating()` React hook) rather than mutating this
 * pure signature.
 */
export function shouldDismissRating(): boolean {
  // Fail-loud: every invocation produces a warning. We deliberately do NOT
  // batch or debounce — a silent stub is exactly the failure mode this
  // guard is designed to prevent. The message names the function so a
  // developer reading logs can locate it without grepping.

  console.warn(
    '[funnel/_guards] shouldDismissRating() called — stub returning conservative default `false`. Real rating-skip state lookup is not implemented yet (Phase 3/4).',
  );

  // Conservative default: do NOT skip the rating step until real state
  // lookup is wired. Returning `false` preserves linear 1→12 navigation.
  return false;
}

/**
 * Sub-AC 6.2 — Referral / invited-state bypass guard.
 *
 * Question this guard answers:
 *   "Should the funnel BYPASS step 10 (the KR-variant referral / invited
 *    state landing) for this user?"
 *
 * Context — why this guard exists:
 *   Step 10 of the v0.2 funnel is the Korean-market invited-state screen
 *   reached via the `/r/<code>` referral deep link. Users arriving via a
 *   valid referral code are normally pinned to step 10 so they can claim
 *   the invitation, but a handful of state-dependent edge cases warrant
 *   skipping it (e.g. the referral has already been redeemed, the code is
 *   expired, the user is the inviter themselves, A/B variant disables the
 *   invited path). Those branches require state that does not yet exist
 *   (referral-code redemption status from Supabase, A/B flag from PostHog,
 *   user-identity match), so this stub stands in for them.
 *
 * Real implementation (Phase 3/4) will read:
 *   1. Supabase `referrals` table to confirm the referral code is unredeemed
 *      and still within its expiry window.
 *   2. The current user's identity vs. the inviter's user_id (self-referral
 *      must always bypass).
 *   3. A PostHog feature flag toggling the invited-state experience on/off
 *      for cohort-level A/B experiments.
 *
 * Stub behaviour:
 *   - Returns the conservative default `false` so the funnel SHOWS step 10
 *     (does NOT bypass it). Choosing `false` preserves the linear 12-step
 *     invariant: an under-specified guard must never silently skip a step
 *     a user might legitimately need to see.
 *   - Emits `console.warn` mentioning the guard name and its stub status so
 *     any caller exercising this code path in non-development environments
 *     produces a loud, greppable signal. A silent default would let the
 *     real wiring regress unnoticed.
 *
 * The function is intentionally synchronous + parameter-free, mirroring
 * `shouldDismissRating()`. When real state-reading lands it will be added
 * via a sibling async/hook variant (e.g. `useShouldBypassReferral()`)
 * rather than mutating this pure signature.
 */
export function shouldBypassReferral(): boolean {
  // Fail-loud: every invocation produces a warning. We deliberately do NOT
  // batch or debounce — a silent stub is exactly the failure mode this
  // guard is designed to prevent. The message names the function so a
  // developer reading logs can locate it without grepping.

  console.warn(
    '[funnel/_guards] shouldBypassReferral() called — stub returning conservative default `false`. Real referral / invited-state lookup is not implemented yet (Phase 3/4).',
  );

  // Conservative default: do NOT bypass the referral / invited-state step
  // until real state lookup is wired. Returning `false` preserves linear
  // 1→12 navigation and keeps the invited landing experience visible.
  return false;
}

/**
 * Sub-AC 6.3 — Returning-user subscription-active funnel-skip guard.
 *
 * Question this guard answers:
 *   "Should the funnel be SKIPPED entirely for a returning user who already
 *    has an active subscription?"
 *
 * Context — why this guard exists:
 *   A returning user whose `subscription_active === true` (i.e. a paid
 *   customer in good standing) should bypass the 12-step acquisition funnel
 *   and land directly in the post-payment experience — re-running them
 *   through the funnel would be both UX-hostile (re-asking questions they
 *   already answered) and revenue-irrelevant (no upsell happens here).
 *   Conversely, a user without an active subscription must complete the
 *   funnel as normal.
 *
 * Real implementation (Phase 3/4) will read:
 *   1. Supabase `profiles.subscription_active` (or the canonical billing
 *      table) keyed by the authenticated user's id.
 *   2. A short-lived in-memory / AsyncStorage cache so the funnel entry
 *      decision does not block on a network round-trip.
 *   3. Optionally a PostHog feature flag to disable the bypass during
 *      a re-onboarding A/B experiment.
 *
 * Stub behaviour:
 *   - Returns the conservative default `false` so the funnel SHOWS its full
 *     12-step path. Choosing `false` preserves the linear 1→12 invariant:
 *     an under-specified guard must never silently skip the entire funnel
 *     — that would route an unauthenticated or unsubscribed user straight
 *     past the acquisition flow and break revenue attribution.
 *   - Emits `console.warn` mentioning the guard name and its stub status so
 *     any caller exercising this code path in non-development environments
 *     produces a loud, greppable signal. A silent default would let real
 *     wiring regress unnoticed.
 *
 * The function is intentionally synchronous + parameter-free, mirroring
 * the other two guards. When real state-reading lands it will be added via
 * a sibling async/hook variant (e.g. `useShouldSkipFunnelSubscribed()`)
 * rather than mutating this pure signature.
 */
export function shouldSkipFunnelSubscribed(): boolean {
  // Fail-loud: every invocation produces a warning. We deliberately do NOT
  // batch or debounce — a silent stub is exactly the failure mode this
  // guard is designed to prevent. The message names the function so a
  // developer reading logs can locate it without grepping.

  console.warn(
    '[funnel/_guards] shouldSkipFunnelSubscribed() called — stub returning conservative default `false`. Real returning-user subscription_active lookup is not implemented yet (Phase 3/4).',
  );

  // Conservative default: do NOT skip the funnel for any user until real
  // subscription state lookup is wired. Returning `false` preserves the
  // linear 12-step invariant and keeps revenue attribution intact.
  return false;
}
