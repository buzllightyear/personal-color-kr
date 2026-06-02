/**
 * Unit tests — `apps/mobile/src/deep-link-parser.ts`.
 *
 * Sub-AC 3.3 contract:
 *   "parseDeepLink(url) 함수가 6-path scheme 입력을 받아 {screen, params}
 *    매핑 결과 또는 차단 사유를 반환하며, 정합 케이스/비정합 케이스 각각
 *    단위 테스트 통과."
 *
 * Test surface — both cohorts the AC names:
 *
 *   정합 (ok) cases:
 *     - /<kebab>?utm…    welcome-hook (and the 2 other external-allowed
 *                         slugs) with the UTM bundle filtered through
 *                         FUNNEL_UTM_QUERY_PARAMS.
 *     - /r/:code          referral-gate via code.
 *     - /s/:token         result-reveal preview via share token.
 *     - /result-reveal    direct preview path (with and without share_token).
 *     - /magazine/:month  post-payment magazine route.
 *     - Universal-link (.invalid) hosts work identically to the custom scheme.
 *
 *   비정합 (blocked) cases — every member of the closed DeepLinkBlockReason
 *   union has a dedicated test:
 *     - 'malformed_url'        empty string, whitespace, non-string input.
 *     - 'unknown_scheme'       http(s) host outside UNIVERSAL_LINK_DOMAINS,
 *                              foreign custom scheme, .com TLD substitution.
 *     - 'unknown_path'         bare prefix, unknown single segment, deep
 *                              multi-segment path that matches no scheme,
 *                              empty dynamic segment (/r/, /s/, /magazine/).
 *     - 'internal_only_funnel' every one of the 9 internal-only kebab slugs
 *                              (security invariant — pin all 9 individually so
 *                              a future slip cannot silently break the cohort).
 *
 * Why these assertions matter:
 *   The Sub-AC 3.3 verdict hinges on the parser correctly distinguishing
 *   the 3 externally-allowed funnel slugs from the 9 internal-only slugs
 *   while accepting all 5 path schemes (1-funnel + r + s + result-reveal +
 *   magazine) plus the 2 universal-link domains. A regression that exposed
 *   `rating-gate` to external entry would bypass the funnel state machine —
 *   the per-slug parametrised test on the 9-cohort is the line of defence.
 */
import { describe, expect, it } from 'vitest';

import {
  CUSTOM_URL_SCHEME,
  FUNNEL_UTM_QUERY_PARAMS,
  UNIVERSAL_LINK_DOMAINS,
} from '../src/deep-link-paths';
import {
  EXTERNAL_ALLOWED_FUNNEL_KEBAB_SLUGS,
  INTERNAL_ONLY_FUNNEL_KEBAB_SLUGS,
} from '../src/internal-only-routes';
import { FUNNEL_KEBAB_SLUGS, FUNNEL_KEBAB_SLUGS_ORDERED } from '../src/linking.config';
import {
  MAGAZINE_SCREEN_ID,
  parseDeepLink,
  type DeepLinkParseOk,
  type DeepLinkParseResult,
} from '../src/deep-link-parser';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Narrowing helper — asserts the result is `ok` and returns the narrowed
 * type. Avoids repeating the discriminator check in every "정합" test
 * and keeps the failure message readable.
 */
function expectOk(result: DeepLinkParseResult): DeepLinkParseOk {
  if (result.status !== 'ok') {
    throw new Error(
      `expected ok, got blocked(${result.reason}) — ${JSON.stringify(result)}`,
    );
  }
  return result;
}

const SCHEME_PREFIX = `${CUSTOM_URL_SCHEME}://`;
const HTTPS_PRIMARY = `https://${UNIVERSAL_LINK_DOMAINS[0] ?? ''}`;
const HTTPS_SECONDARY = `https://${UNIVERSAL_LINK_DOMAINS[1] ?? ''}`;

// ---------------------------------------------------------------------------
// 정합 — Scheme 1: /<kebab>?utm…
// ---------------------------------------------------------------------------

describe('parseDeepLink — scheme 1: /<kebab>?utm…', () => {
  it('resolves welcome-hook with the full UTM + referrer query bundle', () => {
    const url =
      `${SCHEME_PREFIX}welcome-hook` +
      '?utm_source=google&utm_medium=cpc&utm_campaign=spring' +
      '&utm_term=color&utm_content=banner' +
      '&referrer_code=ABC123&referrer_channel=kakao';
    const result = expectOk(parseDeepLink(url));

    expect(result.screen).toBe(FUNNEL_KEBAB_SLUGS.welcome_hook);
    expect(result.params).toEqual({
      utm_source: 'google',
      utm_medium: 'cpc',
      utm_campaign: 'spring',
      utm_term: 'color',
      utm_content: 'banner',
      referrer_code: 'ABC123',
      referrer_channel: 'kakao',
    });
  });

  it('resolves welcome-hook with no query params (campaign-less landing)', () => {
    const result = expectOk(parseDeepLink(`${SCHEME_PREFIX}welcome-hook`));
    expect(result.screen).toBe(FUNNEL_KEBAB_SLUGS.welcome_hook);
    expect(result.params).toEqual({});
  });

  it('strips unknown query keys (PII allowlist enforcement)', () => {
    // Seed constraint: PII like distinct_id must never reach route params.
    const url = `${SCHEME_PREFIX}welcome-hook?utm_source=ig&distinct_id=secret&email=x@y`;
    const result = expectOk(parseDeepLink(url));
    expect(result.params).toEqual({ utm_source: 'ig' });
    expect(result.params).not.toHaveProperty('distinct_id');
    expect(result.params).not.toHaveProperty('email');
  });

  it('keeps the FIRST value on duplicate query keys (URLSearchParams.get semantics)', () => {
    // WHATWG URL spec: `URLSearchParams.get(name)` returns the FIRST
    // matching value, not the last. Pinning the behaviour explicitly so
    // a future swap to a different URL parser cannot silently change
    // attribution semantics.
    const url = `${SCHEME_PREFIX}welcome-hook?utm_source=a&utm_source=b`;
    const result = expectOk(parseDeepLink(url));
    expect(result.params['utm_source']).toBe('a');
  });

  it('resolves referral-gate as a kebab slug (alternate to /r/:code)', () => {
    // The external-allowed cohort includes referral-gate; reaching it via
    // /<kebab> with UTM params is a valid alternate entry (e.g. an email
    // campaign that already has the code resolved server-side).
    const url = `${SCHEME_PREFIX}referral-gate?utm_source=email`;
    const result = expectOk(parseDeepLink(url));
    expect(result.screen).toBe(FUNNEL_KEBAB_SLUGS.referral_gate);
    expect(result.params).toEqual({ utm_source: 'email' });
  });

  it('result-reveal as a kebab slug accepts BOTH share_token AND UTM keys', () => {
    // Campaign-attributed share link: `?utm_source=email&share_token=tok`.
    // Both pieces of attribution must survive the parser for the
    // downstream Zod validator to consume.
    const url = `${SCHEME_PREFIX}result-reveal?utm_source=email&share_token=tok-xyz`;
    const result = expectOk(parseDeepLink(url));
    expect(result.screen).toBe(FUNNEL_KEBAB_SLUGS.result_reveal);
    expect(result.params).toEqual({
      utm_source: 'email',
      share_token: 'tok-xyz',
    });
  });
});

// ---------------------------------------------------------------------------
// 정합 — Scheme 2: /r/:code
// ---------------------------------------------------------------------------

describe('parseDeepLink — scheme 2: /r/:code', () => {
  it('resolves /r/ABC123 to referral-gate with code param', () => {
    const result = expectOk(parseDeepLink(`${SCHEME_PREFIX}r/ABC123`));
    expect(result.screen).toBe(FUNNEL_KEBAB_SLUGS.referral_gate);
    expect(result.params).toEqual({ code: 'ABC123' });
  });

  it('preserves the code value verbatim (no normalization)', () => {
    // Codes are server-issued opaque tokens; the parser must not
    // lower-case or otherwise mangle them.
    const result = expectOk(parseDeepLink(`${SCHEME_PREFIX}r/MiXedCase_42`));
    expect(result.params).toEqual({ code: 'MiXedCase_42' });
  });
});

// ---------------------------------------------------------------------------
// 정합 — Scheme 3: /s/:token
// ---------------------------------------------------------------------------

describe('parseDeepLink — scheme 3: /s/:token', () => {
  it('resolves /s/tok-xyz to result-reveal with token param', () => {
    const result = expectOk(parseDeepLink(`${SCHEME_PREFIX}s/tok-xyz`));
    expect(result.screen).toBe(FUNNEL_KEBAB_SLUGS.result_reveal);
    expect(result.params).toEqual({ token: 'tok-xyz' });
  });

  it('does not collide with /r/:code routing', () => {
    // Guard against a future refactor that accidentally collapses the
    // /r and /s prefixes (e.g. via a too-loose regex). Both must remain
    // distinct route discriminators.
    const referral = expectOk(parseDeepLink(`${SCHEME_PREFIX}r/X`));
    const share = expectOk(parseDeepLink(`${SCHEME_PREFIX}s/X`));
    expect(referral.screen).not.toBe(share.screen);
  });
});

// ---------------------------------------------------------------------------
// 정합 — Scheme 4: /result-reveal
// ---------------------------------------------------------------------------

describe('parseDeepLink — scheme 4: /result-reveal', () => {
  it('resolves /result-reveal with no query', () => {
    const result = expectOk(parseDeepLink(`${SCHEME_PREFIX}result-reveal`));
    expect(result.screen).toBe(FUNNEL_KEBAB_SLUGS.result_reveal);
    expect(result.params).toEqual({});
  });

  it('resolves /result-reveal?share_token=… (preview alternate)', () => {
    const url = `${SCHEME_PREFIX}result-reveal?share_token=preview-abc`;
    const result = expectOk(parseDeepLink(url));
    expect(result.screen).toBe(FUNNEL_KEBAB_SLUGS.result_reveal);
    expect(result.params).toEqual({ share_token: 'preview-abc' });
  });
});

// ---------------------------------------------------------------------------
// 정합 — Scheme 5: /magazine/:month
// ---------------------------------------------------------------------------

describe('parseDeepLink — scheme 5: /magazine/:month', () => {
  it('resolves /magazine/2025-05 to the magazine screen with month param', () => {
    const result = expectOk(parseDeepLink(`${SCHEME_PREFIX}magazine/2025-05`));
    expect(result.screen).toBe(MAGAZINE_SCREEN_ID);
    expect(result.params).toEqual({ month: '2025-05' });
  });

  it('the magazine sentinel is not a funnel kebab slug', () => {
    // Pins the disambiguation invariant: a future contributor cannot
    // introduce a funnel step literally named 'magazine' without
    // immediately surfacing the collision here.
    expect(FUNNEL_KEBAB_SLUGS_ORDERED).not.toContain(MAGAZINE_SCREEN_ID);
  });
});

// ---------------------------------------------------------------------------
// 정합 — Scheme 6: universal-link prefixes
// ---------------------------------------------------------------------------

describe('parseDeepLink — scheme 6: universal-link (.invalid) prefixes', () => {
  it('accepts the primary .invalid host (pcolor.invalid)', () => {
    const result = expectOk(
      parseDeepLink(`${HTTPS_PRIMARY}/welcome-hook?utm_source=fb`),
    );
    expect(result.screen).toBe(FUNNEL_KEBAB_SLUGS.welcome_hook);
    expect(result.params).toEqual({ utm_source: 'fb' });
  });

  it('accepts the secondary .invalid host (personalcolor-kr.invalid)', () => {
    const result = expectOk(parseDeepLink(`${HTTPS_SECONDARY}/r/CODE42`));
    expect(result.screen).toBe(FUNNEL_KEBAB_SLUGS.referral_gate);
    expect(result.params).toEqual({ code: 'CODE42' });
  });

  it('treats the custom scheme and universal-link forms as equivalent', () => {
    const schemeResult = expectOk(parseDeepLink(`${SCHEME_PREFIX}s/tok`));
    const httpsResult = expectOk(parseDeepLink(`${HTTPS_PRIMARY}/s/tok`));
    expect(schemeResult.screen).toBe(httpsResult.screen);
    expect(schemeResult.params).toEqual(httpsResult.params);
  });

  it('routes the share path under either universal-link host', () => {
    const a = expectOk(parseDeepLink(`${HTTPS_PRIMARY}/s/tok`));
    const b = expectOk(parseDeepLink(`${HTTPS_SECONDARY}/s/tok`));
    expect(a.params).toEqual(b.params);
  });
});

// ---------------------------------------------------------------------------
// 비정합 — 'malformed_url'
// ---------------------------------------------------------------------------

describe('parseDeepLink — blocked: malformed_url', () => {
  it('rejects an empty string', () => {
    const result = parseDeepLink('');
    expect(result).toEqual({ status: 'blocked', reason: 'malformed_url' });
  });

  it('rejects a string with internal whitespace', () => {
    const result = parseDeepLink('personal-color-kr:// welcome-hook');
    expect(result).toEqual({ status: 'blocked', reason: 'malformed_url' });
  });

  it('rejects non-string input (defensive against runtime type drift)', () => {
    // The parser signature accepts `unknown` because Expo Router's
    // useURL() can in principle hand back null/undefined; we want a
    // typed `blocked` result rather than a thrown TypeError.
    expect(parseDeepLink(null)).toEqual({
      status: 'blocked',
      reason: 'malformed_url',
    });
    expect(parseDeepLink(undefined)).toEqual({
      status: 'blocked',
      reason: 'malformed_url',
    });
    expect(parseDeepLink(42)).toEqual({
      status: 'blocked',
      reason: 'malformed_url',
    });
  });
});

// ---------------------------------------------------------------------------
// 비정합 — 'unknown_scheme'
// ---------------------------------------------------------------------------

describe('parseDeepLink — blocked: unknown_scheme', () => {
  it('rejects a public .com TLD (the seed forbids real domains here)', () => {
    expect(parseDeepLink('https://example.com/welcome-hook')).toEqual({
      status: 'blocked',
      reason: 'unknown_scheme',
    });
  });

  it('rejects a foreign custom scheme', () => {
    expect(parseDeepLink('myapp://welcome-hook')).toEqual({
      status: 'blocked',
      reason: 'unknown_scheme',
    });
  });

  it('rejects http:// (universal links must be https)', () => {
    expect(parseDeepLink(`http://${UNIVERSAL_LINK_DOMAINS[0]}/welcome-hook`)).toEqual({
      status: 'blocked',
      reason: 'unknown_scheme',
    });
  });

  it('rejects a .invalid host that is not in the allowlist', () => {
    expect(parseDeepLink('https://other.invalid/welcome-hook')).toEqual({
      status: 'blocked',
      reason: 'unknown_scheme',
    });
  });
});

// ---------------------------------------------------------------------------
// 비정합 — 'unknown_path'
// ---------------------------------------------------------------------------

describe('parseDeepLink — blocked: unknown_path', () => {
  it('rejects a bare custom-scheme prefix (no path)', () => {
    expect(parseDeepLink(SCHEME_PREFIX)).toEqual({
      status: 'blocked',
      reason: 'unknown_path',
    });
  });

  it('rejects a bare universal-link host (no path)', () => {
    expect(parseDeepLink(HTTPS_PRIMARY)).toEqual({
      status: 'blocked',
      reason: 'unknown_path',
    });
    expect(parseDeepLink(`${HTTPS_PRIMARY}/`)).toEqual({
      status: 'blocked',
      reason: 'unknown_path',
    });
  });

  it('rejects an unknown single-segment path', () => {
    expect(parseDeepLink(`${SCHEME_PREFIX}totally-fake`)).toEqual({
      status: 'blocked',
      reason: 'unknown_path',
    });
  });

  it('rejects a deep multi-segment path that matches no scheme', () => {
    expect(parseDeepLink(`${SCHEME_PREFIX}a/b/c/d`)).toEqual({
      status: 'blocked',
      reason: 'unknown_path',
    });
  });

  it('rejects /r/ with an empty code segment', () => {
    expect(parseDeepLink(`${SCHEME_PREFIX}r/`)).toEqual({
      status: 'blocked',
      reason: 'unknown_path',
    });
  });

  it('rejects /s/ with an empty token segment', () => {
    expect(parseDeepLink(`${SCHEME_PREFIX}s/`)).toEqual({
      status: 'blocked',
      reason: 'unknown_path',
    });
  });

  it('rejects /magazine/ with an empty month segment', () => {
    expect(parseDeepLink(`${SCHEME_PREFIX}magazine/`)).toEqual({
      status: 'blocked',
      reason: 'unknown_path',
    });
  });

  it('rejects an unknown two-segment path under a non-recognised prefix-letter', () => {
    // Defends against a future regex relaxation that might accept any
    // 2-segment path as a referral.
    expect(parseDeepLink(`${SCHEME_PREFIX}z/value`)).toEqual({
      status: 'blocked',
      reason: 'unknown_path',
    });
  });
});

// ---------------------------------------------------------------------------
// 비정합 — 'internal_only_funnel' (security invariant)
// ---------------------------------------------------------------------------

describe('parseDeepLink — blocked: internal_only_funnel (all 9 slugs)', () => {
  // Parametrise across every internal-only slug so a future change to
  // the cohort (e.g. accidentally promoting `rating-gate` to external)
  // surfaces here with a readable failure message. The 9-slug list is
  // imported directly from the source-of-truth module to avoid drift.
  for (const slug of INTERNAL_ONLY_FUNNEL_KEBAB_SLUGS) {
    it(`blocks /${slug} as internal_only_funnel`, () => {
      expect(parseDeepLink(`${SCHEME_PREFIX}${slug}`)).toEqual({
        status: 'blocked',
        reason: 'internal_only_funnel',
      });
    });

    it(`blocks /${slug} even when a UTM bundle is appended (attribution does not unlock internal screens)`, () => {
      const url = `${SCHEME_PREFIX}${slug}?utm_source=ig`;
      expect(parseDeepLink(url)).toEqual({
        status: 'blocked',
        reason: 'internal_only_funnel',
      });
    });

    it(`blocks /${slug} under the universal-link prefix too`, () => {
      expect(parseDeepLink(`${HTTPS_PRIMARY}/${slug}`)).toEqual({
        status: 'blocked',
        reason: 'internal_only_funnel',
      });
    });
  }

  it('the 3 external-allowed slugs DO resolve (negative control)', () => {
    // Inverse assertion: confirm we haven't accidentally made every
    // single-segment path internal-only. All three allowed slugs must
    // produce an ok result.
    for (const slug of EXTERNAL_ALLOWED_FUNNEL_KEBAB_SLUGS) {
      const result = parseDeepLink(`${SCHEME_PREFIX}${slug}`);
      expect(result.status).toBe('ok');
    }
  });
});

// ---------------------------------------------------------------------------
// Frozen + purity invariants
// ---------------------------------------------------------------------------

describe('parseDeepLink — purity + frozen invariants', () => {
  it('returns a frozen result and frozen params for ok branches', () => {
    const result = parseDeepLink(`${SCHEME_PREFIX}welcome-hook?utm_source=g`);
    expect(Object.isFrozen(result)).toBe(true);
    if (result.status === 'ok') {
      expect(Object.isFrozen(result.params)).toBe(true);
    }
  });

  it('returns a frozen result for blocked branches', () => {
    const result = parseDeepLink('https://example.com/anything');
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('is referentially deterministic — same input string → equal results', () => {
    // Pure-function smoke check: two invocations with the same input
    // must produce structurally-equal outputs (no hidden state
    // accumulation across calls).
    const a = parseDeepLink(`${SCHEME_PREFIX}r/ABC`);
    const b = parseDeepLink(`${SCHEME_PREFIX}r/ABC`);
    expect(a).toEqual(b);
  });

  it('the FUNNEL_UTM_QUERY_PARAMS allowlist is what the parser filters against', () => {
    // Belt-and-braces: the test imports the allowlist constant directly
    // and uses every key in a single URL, asserting the parser preserves
    // exactly those keys. A future drift between the parser's allowlist
    // reference and the source constant would surface here.
    const queryString = FUNNEL_UTM_QUERY_PARAMS.map((k, i) => `${k}=v${i}`).join('&');
    const url = `${SCHEME_PREFIX}welcome-hook?${queryString}`;
    const result = expectOk(parseDeepLink(url));
    for (let i = 0; i < FUNNEL_UTM_QUERY_PARAMS.length; i += 1) {
      const key = FUNNEL_UTM_QUERY_PARAMS[i] as string;
      expect(result.params[key]).toBe(`v${i}`);
    }
  });
});
