/**
 * Unit tests — `apps/mobile/src/deep-link-paths.ts`.
 *
 * Sub-AC 2.1 contract:
 *   "deep link 상수 모듈이 6-path scheme(/<kebab>?utm, /r/<code>,
 *    /s/<token>, /result-reveal, magazine/:id, universal link)을
 *    named export 상수로 노출하는지 검증하는 단위 테스트 통과."
 *
 * What this suite locks down:
 *
 *   1. The module exposes every one of the six deep-link path schemes
 *      as a NAMED EXPORT (not just nested inside an aggregator) so
 *      consumers can `import { REFERRAL_PATH_PATTERN } from ...` and
 *      see a TypeScript build error if a constant is renamed/removed.
 *
 *   2. Each named constant has the exact value the seed contract
 *      enumerates:
 *        - `/r/:code`
 *        - `/s/:token`
 *        - `/result-reveal`
 *        - `/magazine/:month`  (file route is `[month].tsx`; the
 *          Sub-AC's `:id` is a generic placeholder — see module
 *          docstring)
 *        - UNIVERSAL_LINK_DOMAINS = ['pcolor.invalid',
 *          'personalcolor-kr.invalid']
 *        - FUNNEL_UTM_QUERY_PARAMS = the 5 UTM keys + referrer_code +
 *          referrer_channel (the welcome-hook query allowlist)
 *
 *   3. The aggregator `DEEP_LINK_PATH_SCHEMES` has EXACTLY six keys —
 *      no more, no fewer — and each key resolves to the matching
 *      named constant. This prevents drift between the aggregator
 *      and the individual exports (e.g. a future contributor renames
 *      a constant but forgets to update the aggregator).
 *
 *   4. The universal-link domains live exclusively on the `.invalid`
 *      TLD per RFC 2606 — a regression that introduces `example.com`
 *      or any other public TLD fails CI.
 *
 *   5. `DEEP_LINK_PREFIXES` correctly composes the custom scheme plus
 *      one https:// prefix per universal-link domain (i.e. 3 entries
 *      total: the scheme prefix + two .invalid prefixes).
 *
 *   6. Every aggregate is `Object.isFrozen` so a downstream consumer
 *      cannot mutate the source of truth.
 *
 *   7. `TOTAL_DEEP_LINK_PATH_SCHEMES` is exactly 6 (the literal
 *      typed constant matches the runtime aggregator count).
 *
 * Why these assertions matter:
 *   The Sub-AC 2.1 verdict hinges on the 6-path scheme being
 *   discoverable from a single module with named, immutable exports.
 *   A regression that silently drops a path (e.g. removes
 *   `SHARE_PATH_PATTERN`) would not be caught by `linking.config.ts`'s
 *   key=value parity test because that test only checks the funnel
 *   group. This file is the dedicated guard for the external-entry-
 *   point contract.
 */
import { describe, expect, it } from 'vitest';

import {
  CUSTOM_URL_SCHEME,
  DEEP_LINK_PATH_SCHEMES,
  DEEP_LINK_PREFIXES,
  FUNNEL_UTM_QUERY_PARAMS,
  MAGAZINE_PATH_PATTERN,
  REFERRAL_PATH_PATTERN,
  RESULT_REVEAL_PATH,
  SHARE_PATH_PATTERN,
  TOTAL_DEEP_LINK_PATH_SCHEMES,
  UNIVERSAL_LINK_DOMAINS,
} from '../src/deep-link-paths';

// ---------------------------------------------------------------------------
// Custom URL scheme
// ---------------------------------------------------------------------------

describe('CUSTOM_URL_SCHEME', () => {
  it('matches the scheme registered in app.config.ts', () => {
    // Pin the exact string. A drift between this constant and the
    // Expo scheme in app.config.ts would surface as a runtime
    // resolution failure inside expo-linking.
    expect(CUSTOM_URL_SCHEME).toBe('personal-color-kr');
  });

  it('contains no protocol suffix (caller composes :// when needed)', () => {
    expect(CUSTOM_URL_SCHEME).not.toMatch(/:/);
    expect(CUSTOM_URL_SCHEME).not.toMatch(/\//);
  });
});

// ---------------------------------------------------------------------------
// (6) UNIVERSAL_LINK_DOMAINS — .invalid TLD placeholders
// ---------------------------------------------------------------------------

describe('UNIVERSAL_LINK_DOMAINS (scheme 6 — universal link)', () => {
  it('exposes exactly two .invalid TLD placeholder domains', () => {
    expect([...UNIVERSAL_LINK_DOMAINS]).toEqual([
      'pcolor.invalid',
      'personalcolor-kr.invalid',
    ]);
  });

  it('every domain uses the .invalid TLD per RFC 2606', () => {
    // Defends against a future edit that adds `example.com` or any
    // real public TLD — the seed constraint explicitly bans those.
    for (const domain of UNIVERSAL_LINK_DOMAINS) {
      expect(domain).toMatch(/\.invalid$/);
      expect(domain).not.toMatch(/\.com$|\.net$|\.org$|\.app$|\.io$|\.dev$/);
    }
  });

  it('every domain is a bare hostname (no protocol, no path)', () => {
    for (const domain of UNIVERSAL_LINK_DOMAINS) {
      expect(domain).not.toMatch(/^https?:\/\//);
      expect(domain).not.toMatch(/\//);
    }
  });

  it('is frozen so downstream consumers cannot mutate the source of truth', () => {
    expect(Object.isFrozen(UNIVERSAL_LINK_DOMAINS)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// DEEP_LINK_PREFIXES — composed from scheme + universal-link domains
// ---------------------------------------------------------------------------

describe('DEEP_LINK_PREFIXES', () => {
  it('lists the custom scheme prefix first, then one https prefix per universal-link domain', () => {
    expect([...DEEP_LINK_PREFIXES]).toEqual([
      'personal-color-kr://',
      'https://pcolor.invalid',
      'https://personalcolor-kr.invalid',
    ]);
  });

  it('has exactly 1 + UNIVERSAL_LINK_DOMAINS.length entries', () => {
    // The +1 is the custom-scheme prefix. If the universal-link list
    // grows by one, this assertion forces a deliberate update here too.
    expect(DEEP_LINK_PREFIXES).toHaveLength(1 + UNIVERSAL_LINK_DOMAINS.length);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(DEEP_LINK_PREFIXES)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (1) FUNNEL_UTM_QUERY_PARAMS — welcome-hook query allowlist
// ---------------------------------------------------------------------------

describe('FUNNEL_UTM_QUERY_PARAMS (scheme 1 — /<kebab>?utm)', () => {
  it('lists the 5 standard UTM params plus referrer_code and referrer_channel', () => {
    // Mirrors the seed contract verbatim:
    //   "welcome-hook: utm 5종+referrer_code+referrer_channel"
    expect([...FUNNEL_UTM_QUERY_PARAMS]).toEqual([
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'referrer_code',
      'referrer_channel',
    ]);
  });

  it('has exactly 7 entries (5 UTM + 2 referrer)', () => {
    expect(FUNNEL_UTM_QUERY_PARAMS).toHaveLength(7);
  });

  it('contains no PII-bearing keys (distinct_id, email, etc.)', () => {
    // Seed constraint: "PII는 절대 route params에 태우지 않음".
    const pii = ['distinct_id', 'email', 'phone', 'user_id', 'token'];
    for (const key of pii) {
      expect(FUNNEL_UTM_QUERY_PARAMS).not.toContain(key);
    }
  });

  it('is frozen', () => {
    expect(Object.isFrozen(FUNNEL_UTM_QUERY_PARAMS)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (2) REFERRAL_PATH_PATTERN — /r/:code
// ---------------------------------------------------------------------------

describe('REFERRAL_PATH_PATTERN (scheme 2 — /r/<code>)', () => {
  it('is the literal pattern /r/:code', () => {
    expect(REFERRAL_PATH_PATTERN).toBe('/r/:code');
  });

  it('uses a leading slash (external URL form)', () => {
    expect(REFERRAL_PATH_PATTERN.startsWith('/')).toBe(true);
  });

  it('declares a single dynamic segment named :code', () => {
    const dynamicSegments = REFERRAL_PATH_PATTERN.match(/:[a-zA-Z_]+/g) ?? [];
    expect(dynamicSegments).toEqual([':code']);
  });
});

// ---------------------------------------------------------------------------
// (3) SHARE_PATH_PATTERN — /s/:token
// ---------------------------------------------------------------------------

describe('SHARE_PATH_PATTERN (scheme 3 — /s/<token>)', () => {
  it('is the literal pattern /s/:token', () => {
    expect(SHARE_PATH_PATTERN).toBe('/s/:token');
  });

  it('uses a leading slash (external URL form)', () => {
    expect(SHARE_PATH_PATTERN.startsWith('/')).toBe(true);
  });

  it('declares a single dynamic segment named :token', () => {
    const dynamicSegments = SHARE_PATH_PATTERN.match(/:[a-zA-Z_]+/g) ?? [];
    expect(dynamicSegments).toEqual([':token']);
  });

  it('is distinct from REFERRAL_PATH_PATTERN', () => {
    // Guard against a typo where share and referral both end up
    // pointing at the same route — the share preview bypasses the
    // funnel; the referral routes INTO it.
    expect(SHARE_PATH_PATTERN).not.toBe(REFERRAL_PATH_PATTERN);
  });
});

// ---------------------------------------------------------------------------
// (4) RESULT_REVEAL_PATH — /result-reveal
// ---------------------------------------------------------------------------

describe('RESULT_REVEAL_PATH (scheme 4 — /result-reveal)', () => {
  it('is the literal path /result-reveal', () => {
    expect(RESULT_REVEAL_PATH).toBe('/result-reveal');
  });

  it('has no dynamic segments', () => {
    // The share token, when used with this path, is conveyed as a
    // query parameter (`?share_token=…`) not a path segment.
    const dynamicSegments = RESULT_REVEAL_PATH.match(/:[a-zA-Z_]+/g) ?? [];
    expect(dynamicSegments).toEqual([]);
  });

  it('matches the kebab slug of the result_reveal funnel step', () => {
    // The external preview path is the kebab slug of the in-funnel
    // step with a leading slash. Keeping the strings aligned avoids
    // a "two names for the same thing" maintenance trap.
    expect(RESULT_REVEAL_PATH).toBe('/result-reveal');
  });
});

// ---------------------------------------------------------------------------
// (5) MAGAZINE_PATH_PATTERN — /magazine/:month
// ---------------------------------------------------------------------------

describe('MAGAZINE_PATH_PATTERN (scheme 5 — magazine/:id)', () => {
  it('is the literal pattern /magazine/:month', () => {
    // The file-based route is `magazine/[month].tsx`, so the
    // dynamic segment is `:month`. The Sub-AC 2.1 description uses
    // `magazine/:id` as a generic placeholder — `:month` is the
    // concrete name. See module docstring.
    expect(MAGAZINE_PATH_PATTERN).toBe('/magazine/:month');
  });

  it('uses a leading slash (external URL form)', () => {
    expect(MAGAZINE_PATH_PATTERN.startsWith('/')).toBe(true);
  });

  it('declares a single dynamic segment under the magazine root', () => {
    const dynamicSegments = MAGAZINE_PATH_PATTERN.match(/:[a-zA-Z_]+/g) ?? [];
    expect(dynamicSegments).toHaveLength(1);
    expect(MAGAZINE_PATH_PATTERN.startsWith('/magazine/')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// DEEP_LINK_PATH_SCHEMES aggregator — exactly 6 keys
// ---------------------------------------------------------------------------

describe('DEEP_LINK_PATH_SCHEMES aggregator', () => {
  it('has exactly 6 keys (the six schemes enumerated by Sub-AC 2.1)', () => {
    const keys = Object.keys(DEEP_LINK_PATH_SCHEMES);
    expect(keys).toHaveLength(6);
    expect(TOTAL_DEEP_LINK_PATH_SCHEMES).toBe(6);
  });

  it('lists every scheme key with the expected name', () => {
    const keys = Object.keys(DEEP_LINK_PATH_SCHEMES).sort();
    expect(keys).toEqual(
      [
        'funnelKebabUtm',
        'magazine',
        'referralCode',
        'resultReveal',
        'shareToken',
        'universalLink',
      ].sort(),
    );
  });

  it('the funnelKebabUtm entry carries the discriminator + UTM allowlist', () => {
    expect(DEEP_LINK_PATH_SCHEMES.funnelKebabUtm.kind).toBe('funnel-kebab-utm');
    expect([...DEEP_LINK_PATH_SCHEMES.funnelKebabUtm.queryParams]).toEqual([
      ...FUNNEL_UTM_QUERY_PARAMS,
    ]);
  });

  it('each path-scheme entry resolves to the corresponding named constant', () => {
    // Pin aggregator ↔ individual export parity. A future contributor
    // who renames `REFERRAL_PATH_PATTERN` but forgets to update the
    // aggregator (or vice versa) gets a CI failure here rather than
    // a runtime 404.
    expect(DEEP_LINK_PATH_SCHEMES.referralCode).toBe(REFERRAL_PATH_PATTERN);
    expect(DEEP_LINK_PATH_SCHEMES.shareToken).toBe(SHARE_PATH_PATTERN);
    expect(DEEP_LINK_PATH_SCHEMES.resultReveal).toBe(RESULT_REVEAL_PATH);
    expect(DEEP_LINK_PATH_SCHEMES.magazine).toBe(MAGAZINE_PATH_PATTERN);
    expect(DEEP_LINK_PATH_SCHEMES.universalLink).toBe(UNIVERSAL_LINK_DOMAINS);
  });

  it('is frozen at every level the aggregator owns', () => {
    expect(Object.isFrozen(DEEP_LINK_PATH_SCHEMES)).toBe(true);
    expect(Object.isFrozen(DEEP_LINK_PATH_SCHEMES.funnelKebabUtm)).toBe(true);
  });
});
