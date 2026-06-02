/**
 * Internal-only funnel-route allowlist — Sub-AC 2.2 contract.
 *
 * Purpose:
 *   The 12 funnel screens at `apps/mobile/app/(funnel)/` split into two
 *   disjoint cohorts:
 *
 *     - 3 EXTERNALLY-ALLOWED kebab slugs that have a legitimate deep-link
 *       entry point (`welcome-hook` via `/<kebab>?utm`, `result-reveal` via
 *       `/s/:token` or `/result-reveal`, `referral-gate` via `/r/:code`).
 *
 *     - 9 INTERNAL-ONLY kebab slugs that may ONLY be reached by an
 *       in-funnel navigation transition from the previous step. An external
 *       URL pointing at any one of them must be rejected at the deep-link
 *       layer and redirected to `welcome-hook` per the seed contract's
 *       security invariant: "9 internal-only 화면은 external deep link
 *       접근 불가 (security invariant)".
 *
 *   This module owns the source of truth for that 9-slug set + the pure
 *   decision predicate that callers use to classify a URL path.
 *
 * Why a separate module:
 *   The 6-path deep-link scheme constants (`deep-link-paths.ts`) and the
 *   funnel screens block (`linking.config.ts`) deliberately do NOT encode
 *   this security boundary — each of those modules has a different concern
 *   (path schemes, kebab-slug parity). Mixing the blocking allowlist into
 *   either would couple two unrelated invariants and make a future contrib-
 *   utor more likely to mutate them in lockstep when only one needs to
 *   change. Isolating the blocker here keeps the security invariant
 *   single-sourced and trivially auditable.
 *
 * Why pure functions:
 *   Every export here is parameter-free (`getInternalOnlyFunnelKebabSlugs`)
 *   or takes a single string argument (`isInternalOnlyFunnelKebabSlug`,
 *   `isExternalDeepLinkAllowedFunnelKebabSlug`). No module-level mutable
 *   state, no closure over the environment. That keeps unit tests trivial
 *   and lets the deep-link handler call the predicate inline without
 *   worrying about caching, memoisation, or initialisation order.
 *
 * Frozen invariants:
 *   - `INTERNAL_ONLY_FUNNEL_KEBAB_SLUGS` is `Object.freeze`d so a downstream
 *     consumer cannot mutate the source of truth at runtime.
 *   - The set has EXACTLY 9 entries — pinned both as a literal-typed
 *     constant (`TOTAL_INTERNAL_ONLY_FUNNEL_KEBAB_SLUGS = 9`) and at runtime
 *     by the sibling test.
 *   - The internal-only set and the external-allowed set are DISJOINT and
 *     their union equals `FUNNEL_KEBAB_SLUGS_ORDERED`. The sibling test
 *     verifies this so a future contributor cannot accidentally promote
 *     an internal screen to external (or vice versa) without updating
 *     both lists.
 */
import {
  FUNNEL_KEBAB_SLUGS,
  FUNNEL_KEBAB_SLUGS_ORDERED,
  type FunnelKebabSlug,
} from './linking.config.js';

// ---------------------------------------------------------------------------
// External-allowed allowlist (the complement of the 9 internal-only slugs)
// ---------------------------------------------------------------------------

/**
 * The 3 funnel kebab slugs that have a legitimate external deep-link
 * entry point.
 *
 *   1. `welcome-hook`  — utm-tagged campaign landing (`/<kebab>?utm…`).
 *      Per seed contract, the welcome-hook screen is the canonical entry
 *      for any external arrival; deep links targeting any other internal
 *      slug redirect HERE.
 *
 *   2. `result-reveal` — share-token preview (`/s/:token`, `/result-reveal`).
 *      Recipients of a shared diagnosis land directly on a read-only
 *      `result-reveal` view; the deep-link handler activates
 *      `isPreviewMode = true` to gate edit/upload actions.
 *
 *   3. `referral-gate` — referral entry (`/r/:code`).
 *      Users following a friend's referral link land at the Korean-market
 *      step-10 referral-gate screen after server-side attribution.
 *
 * These three slugs are pinned as literal members of a tuple type so a
 * future rename in `FUNNEL_KEBAB_SLUGS` would surface as a compile error
 * here rather than silently shifting the security boundary.
 */
const EXTERNAL_ALLOWED_FUNNEL_KEBAB_SLUGS_TUPLE = [
  FUNNEL_KEBAB_SLUGS.welcome_hook,
  FUNNEL_KEBAB_SLUGS.result_reveal,
  FUNNEL_KEBAB_SLUGS.referral_gate,
] as const;

/**
 * Frozen, ordered list of the 3 externally-allowed funnel kebab slugs.
 *
 * Exported for symmetry with `INTERNAL_ONLY_FUNNEL_KEBAB_SLUGS` and for
 * callers that need to render an explicit allowlist (e.g. analytics
 * preview, debug overlay). The blocking decision predicate
 * `isInternalOnlyFunnelKebabSlug` consumes this set as the complement.
 */
export const EXTERNAL_ALLOWED_FUNNEL_KEBAB_SLUGS: readonly FunnelKebabSlug[] =
  Object.freeze([...EXTERNAL_ALLOWED_FUNNEL_KEBAB_SLUGS_TUPLE]);

/**
 * Total count of externally-allowed funnel kebab slugs. Encoded as a
 * literal `3` rather than a computed length so the test suite can pin
 * the count at both the type level (any change to the literal will not
 * compile) and at runtime.
 */
export const TOTAL_EXTERNAL_ALLOWED_FUNNEL_KEBAB_SLUGS = 3 as const;

// ---------------------------------------------------------------------------
// Internal-only blocking allowlist (the 9 slugs callers MUST block)
// ---------------------------------------------------------------------------

/**
 * Compute the 9 internal-only funnel kebab slugs as the set difference
 * `FUNNEL_KEBAB_SLUGS_ORDERED \ EXTERNAL_ALLOWED_FUNNEL_KEBAB_SLUGS`.
 *
 * Why derive instead of inline:
 *   The seed contract is "9 internal-only, 3 external-allowed, 12 total".
 *   By computing one from the other we make a stale list impossible — if
 *   a 13th step is ever introduced, this derivation either errors out
 *   (because the externally-allowed tuple is type-pinned at length 3) or
 *   surfaces as a unit-test failure on the `9` count assertion. Either
 *   way the regression cannot ship unnoticed.
 *
 * Ordering:
 *   Preserves the canonical funnel order from `FUNNEL_KEBAB_SLUGS_ORDERED`.
 *   The blocking allowlist is set-like in spirit (membership matters, not
 *   ordering) but emitting it in funnel order keeps debug logs and test
 *   diffs readable.
 */
function computeInternalOnlyFunnelKebabSlugs(): readonly FunnelKebabSlug[] {
  const externalAllowed = new Set<FunnelKebabSlug>(EXTERNAL_ALLOWED_FUNNEL_KEBAB_SLUGS);
  return Object.freeze(
    FUNNEL_KEBAB_SLUGS_ORDERED.filter((slug) => !externalAllowed.has(slug)),
  );
}

/**
 * Frozen, ordered list of the 9 funnel kebab slugs that MUST be blocked
 * from external deep-link entry.
 *
 * The deep-link handler should redirect any inbound URL whose final
 * `(funnel)` segment matches one of these slugs to the `welcome-hook`
 * entry point. The set is exposed as the source-of-truth constant; the
 * `getInternalOnlyFunnelKebabSlugs()` pure function below returns the
 * same array for callers that want a function-call style (and for the
 * Sub-AC 2.2 contract verbatim: "9개 internal-only 경로 차단 규칙 배열을
 * 반환하는 순수 함수").
 */
export const INTERNAL_ONLY_FUNNEL_KEBAB_SLUGS: readonly FunnelKebabSlug[] =
  computeInternalOnlyFunnelKebabSlugs();

/**
 * Total count of internal-only funnel kebab slugs. Encoded as a literal
 * `9` rather than a computed length so the test suite can pin the count
 * at both the type level and at runtime.
 */
export const TOTAL_INTERNAL_ONLY_FUNNEL_KEBAB_SLUGS = 9 as const;

// ---------------------------------------------------------------------------
// Pure decision predicates
// ---------------------------------------------------------------------------

/**
 * Pure function returning the 9 internal-only funnel kebab slugs.
 *
 * This is the Sub-AC 2.2 contract verbatim:
 *   "9개 internal-only 경로 차단 규칙 배열을 반환하는 순수 함수"
 *
 * Identical to the `INTERNAL_ONLY_FUNNEL_KEBAB_SLUGS` constant — exposed
 * as a function so callers that prefer the function-call style (or that
 * want to keep their imports parameter-free for testing) have an
 * ergonomic option. Either form returns the same frozen reference so
 * identity comparison works across both.
 *
 * Purity:
 *   - No parameters.
 *   - No closure over mutable state.
 *   - Returns the same frozen reference on every call.
 */
export function getInternalOnlyFunnelKebabSlugs(): readonly FunnelKebabSlug[] {
  return INTERNAL_ONLY_FUNNEL_KEBAB_SLUGS;
}

/**
 * Pure predicate: returns `true` iff the given path segment is one of
 * the 9 internal-only funnel kebab slugs that the deep-link handler
 * MUST block.
 *
 * Input contract:
 *   - `pathSegment` is the kebab slug portion of a deep-link URL (e.g.
 *     `rating-gate`, `fake-loader`). It is NOT a full URL — the caller
 *     is expected to have parsed the URL down to the route name before
 *     calling this predicate. Anything else (full URL, kebab slug with
 *     leading slash, unknown segment) returns `false`, on the principle
 *     that "block only what we explicitly recognise as internal-only" is
 *     safer than "block anything that doesn't look external".
 *
 *   - Decoupling the slug-membership decision from the URL-parsing
 *     concern keeps the predicate trivial to unit-test.
 *
 * Why `false` for unknown input:
 *   The handler that calls this predicate is one layer in a stack. The
 *   URL allowlist (matched against the 6 declared deep-link schemes)
 *   already rejects unknown paths upstream. This predicate's job is the
 *   narrower "is THIS known funnel slug blocked?" question. Returning
 *   `false` for an unknown segment correctly says "this is not in the
 *   blocked-internal cohort"; upstream decides what to do with unknowns.
 */
export function isInternalOnlyFunnelKebabSlug(pathSegment: string): boolean {
  return INTERNAL_ONLY_FUNNEL_KEBAB_SLUGS.includes(pathSegment);
}

/**
 * Pure predicate: returns `true` iff the given path segment is one of
 * the 3 externally-allowed funnel kebab slugs.
 *
 * Useful for the deep-link handler that wants to fast-path a known-good
 * URL (e.g. "if external-allowed, route normally; otherwise classify
 * further"). Logically equivalent to:
 *
 *     EXTERNAL_ALLOWED_FUNNEL_KEBAB_SLUGS.includes(pathSegment)
 *
 * exposed as a named predicate for readability at the call site.
 *
 * NB: A funnel kebab slug returns either `true` from this predicate or
 * `true` from `isInternalOnlyFunnelKebabSlug` — never both. A non-funnel
 * input returns `false` from both. The disjointness invariant is asserted
 * by the sibling test.
 */
export function isExternalDeepLinkAllowedFunnelKebabSlug(pathSegment: string): boolean {
  return EXTERNAL_ALLOWED_FUNNEL_KEBAB_SLUGS.includes(pathSegment);
}
