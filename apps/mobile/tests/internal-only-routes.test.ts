/**
 * Unit tests — `apps/mobile/src/internal-only-routes.ts`.
 *
 * Sub-AC 2.2 contract:
 *   "9개 internal-only 경로 차단 규칙 배열을 반환하는 순수 함수가 정의되고
 *    해당 경로 목록 및 차단 여부 판정 로직에 대한 단위 테스트 통과."
 *
 * What this suite locks down:
 *
 *   1. `getInternalOnlyFunnelKebabSlugs()` is a pure, parameter-free
 *      function that returns the same frozen reference on every call.
 *
 *   2. The returned array has EXACTLY 9 entries — pinned both at the
 *      type level (`TOTAL_INTERNAL_ONLY_FUNNEL_KEBAB_SLUGS = 9`) and at
 *      runtime.
 *
 *   3. Every one of those 9 entries is a kebab slug derived from the
 *      v0.2 `FUNNEL_STEPS_ORDERED` (no synthetic strings, no typos).
 *
 *   4. The 9 entries match the EXACT enumeration the seed contract
 *      requires (the complement of `welcome-hook`, `result-reveal`,
 *      `referral-gate`).
 *
 *   5. `isInternalOnlyFunnelKebabSlug(slug)` returns `true` for every
 *      one of those 9 slugs and `false` for the 3 externally-allowed
 *      slugs, for non-funnel strings, and for malformed input.
 *
 *   6. `isExternalDeepLinkAllowedFunnelKebabSlug(slug)` is the disjoint
 *      complement: `true` for the 3 external slugs, `false` for the 9
 *      internal slugs.
 *
 *   7. The two predicates are DISJOINT (no slug returns `true` from
 *      both) and EXHAUSTIVE over `FUNNEL_KEBAB_SLUGS_ORDERED` (every
 *      funnel slug returns `true` from exactly one predicate). This is
 *      the security invariant: a future refactor cannot accidentally
 *      classify a screen into both cohorts (which would break blocking)
 *      or neither (which would leave it un-routed).
 *
 *   8. The internal-only set + external-allowed set together equal the
 *      full `FUNNEL_KEBAB_SLUGS_ORDERED` (12-slug coverage invariant).
 *
 *   9. All exported aggregates are `Object.isFrozen` so a downstream
 *      consumer cannot mutate the source of truth.
 *
 * Why these assertions matter:
 *   The 9-vs-3 split IS the security invariant the seed calls out:
 *   "9 internal-only 화면은 external deep link 접근 불가 (security
 *   invariant)". A regression that drops a slug from the internal set
 *   would silently expose that screen to external deep-link entry
 *   (bypassing the funnel state machine and the welcome-hook
 *   redirect). This test is the line of defence that catches such a
 *   regression in CI before it ships.
 */
import { describe, expect, it } from 'vitest';

import { FUNNEL_KEBAB_SLUGS_ORDERED } from '../src/linking.config';
import {
  EXTERNAL_ALLOWED_FUNNEL_KEBAB_SLUGS,
  INTERNAL_ONLY_FUNNEL_KEBAB_SLUGS,
  TOTAL_EXTERNAL_ALLOWED_FUNNEL_KEBAB_SLUGS,
  TOTAL_INTERNAL_ONLY_FUNNEL_KEBAB_SLUGS,
  getInternalOnlyFunnelKebabSlugs,
  isExternalDeepLinkAllowedFunnelKebabSlug,
  isInternalOnlyFunnelKebabSlug,
} from '../src/internal-only-routes';

// ---------------------------------------------------------------------------
// getInternalOnlyFunnelKebabSlugs — pure function returning the 9-slug list
// ---------------------------------------------------------------------------

describe('getInternalOnlyFunnelKebabSlugs (pure function — Sub-AC 2.2)', () => {
  it('returns an array of exactly 9 entries', () => {
    const result = getInternalOnlyFunnelKebabSlugs();
    expect(result).toHaveLength(9);
    expect(TOTAL_INTERNAL_ONLY_FUNNEL_KEBAB_SLUGS).toBe(9);
  });

  it('is parameter-free and returns the same frozen reference on every call (purity)', () => {
    // Two consecutive calls with no arguments must yield reference
    // equality. This pins the "no closure over mutable state, no
    // memoised builder" purity guarantee.
    const first = getInternalOnlyFunnelKebabSlugs();
    const second = getInternalOnlyFunnelKebabSlugs();
    expect(first).toBe(second);
    expect(first).toBe(INTERNAL_ONLY_FUNNEL_KEBAB_SLUGS);
  });

  it('returns the same array referenced by INTERNAL_ONLY_FUNNEL_KEBAB_SLUGS', () => {
    expect(getInternalOnlyFunnelKebabSlugs()).toBe(INTERNAL_ONLY_FUNNEL_KEBAB_SLUGS);
  });

  it('enumerates the EXACT 9 internal-only kebab slugs the seed contract requires', () => {
    // The seed contract says: 9 internal-only = full 12 \ {welcome-hook,
    // result-reveal, referral-gate}. Pin the explicit list so any
    // accidental promotion of an internal screen to external surfaces
    // here with a readable diff.
    expect([...getInternalOnlyFunnelKebabSlugs()]).toEqual([
      'value-props',
      'onboarding-priming',
      'rating-gate',
      'fake-loader',
      'scan-option-select',
      'diagnosis-input',
      'fake-scan-animation',
      'social-evolution',
      'payment-model',
    ]);
  });

  it('preserves canonical funnel order (matches FUNNEL_KEBAB_SLUGS_ORDERED filtering)', () => {
    // The internal-only list must be a positional subsequence of the
    // canonical funnel order — proves it was derived by set-difference,
    // not by hand, so it cannot drift out of order.
    const internalSet = new Set(getInternalOnlyFunnelKebabSlugs());
    const orderedSubset = FUNNEL_KEBAB_SLUGS_ORDERED.filter((slug) =>
      internalSet.has(slug),
    );
    expect([...getInternalOnlyFunnelKebabSlugs()]).toEqual(orderedSubset);
  });
});

// ---------------------------------------------------------------------------
// INTERNAL_ONLY_FUNNEL_KEBAB_SLUGS — frozen source-of-truth constant
// ---------------------------------------------------------------------------

describe('INTERNAL_ONLY_FUNNEL_KEBAB_SLUGS constant', () => {
  it('is frozen so downstream consumers cannot mutate the source of truth', () => {
    expect(Object.isFrozen(INTERNAL_ONLY_FUNNEL_KEBAB_SLUGS)).toBe(true);
  });

  it('contains only kebab slugs drawn from FUNNEL_KEBAB_SLUGS_ORDERED', () => {
    // Defends against synthetic strings (e.g. a typo like
    // 'rating-gates') sneaking into the list. Every entry must be a
    // real funnel kebab slug.
    const validSlugs = new Set(FUNNEL_KEBAB_SLUGS_ORDERED);
    for (const slug of INTERNAL_ONLY_FUNNEL_KEBAB_SLUGS) {
      expect(validSlugs.has(slug)).toBe(true);
    }
  });

  it('contains no duplicates', () => {
    expect(new Set(INTERNAL_ONLY_FUNNEL_KEBAB_SLUGS).size).toBe(
      INTERNAL_ONLY_FUNNEL_KEBAB_SLUGS.length,
    );
  });
});

// ---------------------------------------------------------------------------
// EXTERNAL_ALLOWED_FUNNEL_KEBAB_SLUGS — the 3-slug complement
// ---------------------------------------------------------------------------

describe('EXTERNAL_ALLOWED_FUNNEL_KEBAB_SLUGS constant', () => {
  it('has exactly 3 entries (welcome-hook, result-reveal, referral-gate)', () => {
    expect(EXTERNAL_ALLOWED_FUNNEL_KEBAB_SLUGS).toHaveLength(3);
    expect(TOTAL_EXTERNAL_ALLOWED_FUNNEL_KEBAB_SLUGS).toBe(3);
    expect([...EXTERNAL_ALLOWED_FUNNEL_KEBAB_SLUGS]).toEqual([
      'welcome-hook',
      'result-reveal',
      'referral-gate',
    ]);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(EXTERNAL_ALLOWED_FUNNEL_KEBAB_SLUGS)).toBe(true);
  });

  it('contains no duplicates', () => {
    expect(new Set(EXTERNAL_ALLOWED_FUNNEL_KEBAB_SLUGS).size).toBe(
      EXTERNAL_ALLOWED_FUNNEL_KEBAB_SLUGS.length,
    );
  });
});

// ---------------------------------------------------------------------------
// isInternalOnlyFunnelKebabSlug — blocking decision predicate
// ---------------------------------------------------------------------------

describe('isInternalOnlyFunnelKebabSlug (blocking decision)', () => {
  it('returns true for every one of the 9 internal-only kebab slugs', () => {
    for (const slug of INTERNAL_ONLY_FUNNEL_KEBAB_SLUGS) {
      expect(isInternalOnlyFunnelKebabSlug(slug)).toBe(true);
    }
  });

  it('returns false for each of the 3 externally-allowed kebab slugs', () => {
    for (const slug of EXTERNAL_ALLOWED_FUNNEL_KEBAB_SLUGS) {
      expect(isInternalOnlyFunnelKebabSlug(slug)).toBe(false);
    }
  });

  it('returns false for non-funnel strings (unknown paths)', () => {
    // Unknown paths are NOT in the internal-blocked cohort; upstream
    // URL allowlisting decides what to do with them.
    expect(isInternalOnlyFunnelKebabSlug('magazine')).toBe(false);
    expect(isInternalOnlyFunnelKebabSlug('post-payment')).toBe(false);
    expect(isInternalOnlyFunnelKebabSlug('totally-fake')).toBe(false);
  });

  it('returns false for malformed input (empty / whitespace / leading slash)', () => {
    // The predicate operates on the bare kebab slug, not on a URL path.
    // Defensive assertions: anything that doesn't EXACTLY match a known
    // internal slug returns false.
    expect(isInternalOnlyFunnelKebabSlug('')).toBe(false);
    expect(isInternalOnlyFunnelKebabSlug(' ')).toBe(false);
    expect(isInternalOnlyFunnelKebabSlug('/rating-gate')).toBe(false);
    expect(isInternalOnlyFunnelKebabSlug('rating-gate/')).toBe(false);
  });

  it('is case-sensitive (rejects Rating-Gate, RATING-GATE)', () => {
    // Routes are lower-case kebab by convention; an upper-case spelling
    // must NOT match — otherwise a deep-link with mis-cased URL would
    // be silently allowed through.
    expect(isInternalOnlyFunnelKebabSlug('Rating-Gate')).toBe(false);
    expect(isInternalOnlyFunnelKebabSlug('RATING-GATE')).toBe(false);
  });

  it('returns true for the canonical examples cited in the security invariant', () => {
    // Spot-check the slugs that are MOST likely to be touched by a
    // future contributor — payment-model is a particularly sensitive
    // screen (revenue), rating-gate is the only iOS native dialog
    // screen, fake-loader is the timing-dependent step.
    expect(isInternalOnlyFunnelKebabSlug('rating-gate')).toBe(true);
    expect(isInternalOnlyFunnelKebabSlug('payment-model')).toBe(true);
    expect(isInternalOnlyFunnelKebabSlug('fake-loader')).toBe(true);
    expect(isInternalOnlyFunnelKebabSlug('fake-scan-animation')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isExternalDeepLinkAllowedFunnelKebabSlug — disjoint complement predicate
// ---------------------------------------------------------------------------

describe('isExternalDeepLinkAllowedFunnelKebabSlug (allowlist decision)', () => {
  it('returns true for each of the 3 externally-allowed kebab slugs', () => {
    for (const slug of EXTERNAL_ALLOWED_FUNNEL_KEBAB_SLUGS) {
      expect(isExternalDeepLinkAllowedFunnelKebabSlug(slug)).toBe(true);
    }
  });

  it('returns false for every one of the 9 internal-only kebab slugs', () => {
    for (const slug of INTERNAL_ONLY_FUNNEL_KEBAB_SLUGS) {
      expect(isExternalDeepLinkAllowedFunnelKebabSlug(slug)).toBe(false);
    }
  });

  it('returns false for non-funnel and malformed input', () => {
    expect(isExternalDeepLinkAllowedFunnelKebabSlug('magazine')).toBe(false);
    expect(isExternalDeepLinkAllowedFunnelKebabSlug('')).toBe(false);
    expect(isExternalDeepLinkAllowedFunnelKebabSlug('/welcome-hook')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting invariants — disjointness + exhaustive coverage
// ---------------------------------------------------------------------------

describe('internal vs external — disjoint + exhaustive coverage', () => {
  it('no funnel slug is BOTH internal and external (disjointness invariant)', () => {
    for (const slug of FUNNEL_KEBAB_SLUGS_ORDERED) {
      const internal = isInternalOnlyFunnelKebabSlug(slug);
      const external = isExternalDeepLinkAllowedFunnelKebabSlug(slug);
      // Exactly one of the two predicates must return true for any
      // funnel slug. XOR via inequality is the cleanest expression of
      // "true on exactly one side".
      expect(internal).not.toBe(external);
    }
  });

  it('every funnel slug is classified by exactly one predicate (exhaustive coverage)', () => {
    for (const slug of FUNNEL_KEBAB_SLUGS_ORDERED) {
      const internal = isInternalOnlyFunnelKebabSlug(slug);
      const external = isExternalDeepLinkAllowedFunnelKebabSlug(slug);
      // Exactly one must be true → their disjunction is true.
      expect(internal || external).toBe(true);
    }
  });

  it('internal-only ∪ external-allowed equals the full FUNNEL_KEBAB_SLUGS_ORDERED set', () => {
    const union = new Set<string>([
      ...INTERNAL_ONLY_FUNNEL_KEBAB_SLUGS,
      ...EXTERNAL_ALLOWED_FUNNEL_KEBAB_SLUGS,
    ]);
    const expected = new Set<string>(FUNNEL_KEBAB_SLUGS_ORDERED);
    expect(union).toEqual(expected);
    expect(union.size).toBe(FUNNEL_KEBAB_SLUGS_ORDERED.length);
  });

  it('internal-only ∩ external-allowed is empty', () => {
    const externalSet = new Set<string>(EXTERNAL_ALLOWED_FUNNEL_KEBAB_SLUGS);
    for (const slug of INTERNAL_ONLY_FUNNEL_KEBAB_SLUGS) {
      expect(externalSet.has(slug)).toBe(false);
    }
  });

  it('9 + 3 == 12 (full funnel coverage)', () => {
    expect(
      INTERNAL_ONLY_FUNNEL_KEBAB_SLUGS.length +
        EXTERNAL_ALLOWED_FUNNEL_KEBAB_SLUGS.length,
    ).toBe(FUNNEL_KEBAB_SLUGS_ORDERED.length);
    expect(FUNNEL_KEBAB_SLUGS_ORDERED).toHaveLength(12);
  });
});
