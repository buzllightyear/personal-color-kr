/**
 * `parseDeepLink(url)` — classify an inbound deep-link URL against the
 * 6-path scheme contract owned by `deep-link-paths.ts` (Sub-AC 3.3).
 *
 * Why this module exists:
 *   `deep-link-paths.ts` exports the source-of-truth path constants;
 *   `linking.config.ts` exports the kebab-slug → URL parity map;
 *   `internal-only-routes.ts` exports the 9-vs-3 security split. None of
 *   them, however, takes a *concrete* inbound URL and tells the caller
 *   either (a) which Expo Router screen to push and which params to hand
 *   it, or (b) why the URL was rejected.
 *
 *   `parseDeepLink` is that synthesis layer. It is the single pure
 *   function the (eventual) deep-link handler in `_layout.tsx` calls to
 *   convert an opaque `linking.useURL()` string into one of:
 *
 *     - `{ status: 'ok',      screen, params }`   → push this screen
 *     - `{ status: 'blocked', reason }`           → redirect / log / drop
 *
 *   Decoupling classification from navigation keeps the parser trivially
 *   unit-testable (no Expo Router, no React, no AsyncStorage) and lets
 *   the consumer compose its own redirect policy (the seed's
 *   `isExternalEntry → welcome-hook` invariant is layout-level, not
 *   parser-level).
 *
 * The 6-path scheme contract (mirrors `deep-link-paths.ts`):
 *
 *   1. `personal-color-kr://<kebab>?utm…`
 *      Funnel kebab path with optional UTM bundle. Only the 3
 *      externally-allowed kebab slugs (welcome-hook, result-reveal,
 *      referral-gate) resolve to `ok`; the 9 internal-only slugs are
 *      `blocked: 'internal_only_funnel'` per the security invariant.
 *      Query params are filtered against `FUNNEL_UTM_QUERY_PARAMS` —
 *      unknown keys (including potential PII like `distinct_id`) are
 *      stripped before being handed back.
 *
 *   2. `…/r/:code`        → `ok: { screen: 'referral-gate', params: { code } }`
 *   3. `…/s/:token`       → `ok: { screen: 'result-reveal',  params: { token } }`
 *   4. `…/result-reveal`  → `ok: { screen: 'result-reveal',  params: { share_token? } }`
 *   5. `…/magazine/:month`→ `ok: { screen: 'magazine',       params: { month } }`
 *   6. Universal-link prefixes (`https://pcolor.invalid`,
 *      `https://personalcolor-kr.invalid`) are accepted as alternates
 *      to the custom scheme — the path classification above runs on
 *      the post-prefix tail identically.
 *
 * Block reasons (closed set):
 *   - `malformed_url`         the input string cannot be parsed.
 *   - `unknown_scheme`        the URL prefix is neither the registered
 *                              custom scheme nor a known .invalid
 *                              universal-link domain.
 *   - `unknown_path`          the post-prefix path matches none of the
 *                              six scheme patterns above.
 *   - `internal_only_funnel`  the path targets one of the 9 internal-
 *                              only kebab slugs (security invariant).
 *
 * What this module deliberately does NOT do:
 *   - It does not enforce Zod schemas on the param payload. Zod
 *     validation lives in `packages/core-ts/funnel` so the server-side
 *     referral / share endpoints can reuse it; this parser only filters
 *     query keys against the allowlist and returns string values
 *     verbatim. The downstream consumer is expected to feed the params
 *     through the appropriate Zod schema before trusting them.
 *   - It does not perform navigation, redirects, or analytics. It is a
 *     pure classifier — same input → same output, no side effects.
 *   - It does not consult the `isExternalEntry` flag or the
 *     `resume_step` AsyncStorage key. Those are layout-level concerns
 *     owned by sibling sub-ACs.
 *
 * Frozen invariants (asserted by the sibling test):
 *   - The function is pure and free of closure over module-level
 *     mutable state.
 *   - Every `ok` result has a frozen `params` object.
 *   - Every `blocked` reason is a member of the closed
 *     `DeepLinkBlockReason` union.
 */
import {
  CUSTOM_URL_SCHEME,
  FUNNEL_UTM_QUERY_PARAMS,
  UNIVERSAL_LINK_DOMAINS,
} from './deep-link-paths.js';
import {
  FUNNEL_KEBAB_SLUGS,
  FUNNEL_KEBAB_SLUGS_ORDERED,
  type FunnelKebabSlug,
} from './linking.config.js';
import { isInternalOnlyFunnelKebabSlug } from './internal-only-routes.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Closed set of reasons the parser may refuse to resolve a URL.
 *
 * Encoded as a string-literal union so:
 *   - Exhaustive `switch` statements in the consumer get a compile error
 *     if a future contributor adds a reason without handling it.
 *   - Test assertions can pin the exact reason (no free-form messages).
 */
export type DeepLinkBlockReason =
  | 'malformed_url'
  | 'unknown_scheme'
  | 'unknown_path'
  | 'internal_only_funnel';

/**
 * Sentinel for the magazine screen — distinct from any funnel kebab slug.
 *
 * The funnel kebab slugs (`welcome-hook`, `result-reveal`, …) overlap by
 * design with the Expo Router file route names, so they double as the
 * `screen` identifier for funnel matches. The magazine route lives outside
 * the `(funnel)` group and the file is `magazine/[month].tsx`; rather
 * than expose the bracket form to consumers we surface the bare token
 * `'magazine'`. The runtime test asserts this token is not a member of
 * `FUNNEL_KEBAB_SLUGS_ORDERED` so the disambiguation cannot regress.
 */
export const MAGAZINE_SCREEN_ID = 'magazine' as const;
export type MagazineScreenId = typeof MAGAZINE_SCREEN_ID;

/**
 * Screen identifier returned in a successful parse.
 *
 * Either:
 *   - one of the 3 externally-allowed funnel kebab slugs
 *     (`welcome-hook`, `result-reveal`, `referral-gate`), or
 *   - the magazine sentinel `'magazine'`.
 *
 * Internal-only kebab slugs never appear here — the parser rejects them
 * with `blocked: 'internal_only_funnel'` upstream.
 */
export type DeepLinkScreen = FunnelKebabSlug | MagazineScreenId;

/**
 * Successful parse result.  `params` is frozen so the consumer cannot
 * accidentally mutate a captured reference.
 */
export interface DeepLinkParseOk {
  readonly status: 'ok';
  readonly screen: DeepLinkScreen;
  readonly params: Readonly<Record<string, string>>;
}

/** Blocked parse result. */
export interface DeepLinkParseBlocked {
  readonly status: 'blocked';
  readonly reason: DeepLinkBlockReason;
}

/** Discriminated union of all possible parse outcomes. */
export type DeepLinkParseResult = DeepLinkParseOk | DeepLinkParseBlocked;

// ---------------------------------------------------------------------------
// Internal helpers — prefix stripping and path/query split
// ---------------------------------------------------------------------------

/**
 * Strip the deep-link prefix (custom scheme or universal-link https
 * domain) from the URL string and return the post-prefix tail.
 *
 * Why a manual string strip rather than `new URL(url)`:
 *   - Node's `URL` parser treats `personal-color-kr://welcome-hook` as
 *     `hostname='welcome-hook'`, `pathname='/'` — which makes
 *     classifying single-segment paths awkward. The custom scheme
 *     allows arbitrary "host" values that we want to surface as the
 *     first path segment, so a uniform prefix strip is simpler and
 *     more predictable.
 *   - Allowing both `https://pcolor.invalid` (no trailing slash) and
 *     `https://pcolor.invalid/` requires a small bit of normalization
 *     that's clearer as explicit slice operations than as URL
 *     reconstruction.
 *
 * Returns the post-prefix tail (e.g. `welcome-hook?utm_source=x`,
 * `r/ABC123`, empty string for a bare-prefix URL) or `null` when no
 * known prefix matches.
 */
function stripDeepLinkPrefix(url: string): string | null {
  const customPrefix = `${CUSTOM_URL_SCHEME}://`;
  if (url.startsWith(customPrefix)) {
    return url.slice(customPrefix.length);
  }
  for (const domain of UNIVERSAL_LINK_DOMAINS) {
    const httpsBase = `https://${domain}`;
    if (url === httpsBase) {
      return '';
    }
    if (url.startsWith(`${httpsBase}/`)) {
      return url.slice(httpsBase.length + 1);
    }
  }
  return null;
}

/**
 * Split the post-prefix tail into a normalized path and a URLSearchParams
 * for the query string.
 *
 * Normalization:
 *   - Leading and trailing slashes are collapsed so `r/ABC`, `/r/ABC`,
 *     and `r/ABC/` all parse to the same segments.
 *   - The hash fragment (`#…`) is stripped — deep links never carry one
 *     and tolerating it avoids spurious `unknown_path` results.
 *
 * Throws nothing — every reachable input produces a structurally valid
 * pair; downstream classification decides whether the path is meaningful.
 */
function splitPathAndQuery(tail: string): {
  readonly path: string;
  readonly segments: readonly string[];
  readonly query: URLSearchParams;
} {
  const noHash = tail.split('#', 1)[0] ?? '';
  const [rawPath, rawQuery] = noHash.split('?', 2);
  const path = (rawPath ?? '').replace(/^\/+/, '').replace(/\/+$/, '');
  const segments = path === '' ? [] : path.split('/');
  // URLSearchParams accepts undefined; coerce to empty string for clarity
  // and to keep the test surface deterministic across Node versions.
  const query = new URLSearchParams(rawQuery ?? '');
  return { path, segments, query };
}

/**
 * Build a frozen `Record<string, string>` from a URLSearchParams,
 * keeping only the keys present in `allowlist`.
 *
 * Why an allowlist filter:
 *   The seed contract forbids PII in route params. By only forwarding
 *   keys the contract explicitly enumerates, an attacker that appends
 *   `?distinct_id=…` to a campaign link cannot smuggle that key into
 *   the navigation params — it is silently dropped at the parser
 *   boundary.
 *
 * Repeated keys (`?utm_source=a&utm_source=b`) use the FIRST value
 * (URLSearchParams.get semantics). The WHATWG URL spec is explicit on
 * this point — `get(name)` returns the first matching value, not the
 * last — and we follow it so the parser is interoperable with any
 * other URL handler the consumer might also use.
 */
function filterAllowedQueryParams(
  query: URLSearchParams,
  allowlist: readonly string[],
): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const key of allowlist) {
    const value = query.get(key);
    if (value !== null) {
      out[key] = value;
    }
  }
  return Object.freeze(out);
}

/**
 * Single allowlist entry used for the share-token query parameter on
 * the direct preview path (`/result-reveal?share_token=…`). Held as a
 * named constant rather than inlined so the parser test and the
 * downstream Zod schema can reference the same string.
 */
const SHARE_TOKEN_QUERY_PARAM = 'share_token' as const;

// ---------------------------------------------------------------------------
// Internal helpers — `ok` / `blocked` factories
// ---------------------------------------------------------------------------

/**
 * Construct a frozen `ok` result. Centralized so every successful
 * branch returns a structurally identical object (and so the test that
 * pins `Object.isFrozen` on the result + params only has one allocation
 * site to trust).
 */
function ok(
  screen: DeepLinkScreen,
  params: Readonly<Record<string, string>>,
): DeepLinkParseOk {
  return Object.freeze({
    status: 'ok' as const,
    screen,
    params,
  });
}

/**
 * Construct a frozen `blocked` result. Same rationale as `ok` — single
 * allocation site keeps the test surface minimal.
 */
function blocked(reason: DeepLinkBlockReason): DeepLinkParseBlocked {
  return Object.freeze({
    status: 'blocked' as const,
    reason,
  });
}

// ---------------------------------------------------------------------------
// Public API — parseDeepLink
// ---------------------------------------------------------------------------

/**
 * Classify an inbound deep-link URL against the 6-path scheme contract.
 *
 * Pure function: same input → same output, no side effects, no closure
 * over mutable state.
 *
 * Algorithm:
 *   1. Validate that `url` is a non-empty string with no internal
 *      whitespace (a smoke check against pathological inputs that would
 *      otherwise sail through `startsWith` matching).
 *   2. Strip the deep-link prefix (custom scheme or universal-link
 *      https domain). Unknown prefix → `blocked: 'unknown_scheme'`.
 *   3. Split the tail into path + query. An empty path is treated as
 *      `unknown_path` (the layout-level redirect-to-welcome-hook
 *      handler is a separate concern).
 *   4. Match the path against the 5 path schemes in priority order
 *      (multi-segment patterns before single-segment to avoid an
 *      `r/:code` URL accidentally matching as a kebab slug literally
 *      named `'r'`).
 *   5. For single-segment paths, look the segment up in
 *      `FUNNEL_KEBAB_SLUGS_ORDERED`. If it's an internal-only slug,
 *      return `blocked: 'internal_only_funnel'`; if external-allowed,
 *      filter UTM params and return `ok`.
 *   6. Any path that doesn't match → `blocked: 'unknown_path'`.
 */
export function parseDeepLink(url: unknown): DeepLinkParseResult {
  // (1) Smoke check on the raw input.
  if (typeof url !== 'string' || url.length === 0 || /\s/.test(url)) {
    return blocked('malformed_url');
  }

  // (2) Strip prefix.
  const tail = stripDeepLinkPrefix(url);
  if (tail === null) {
    return blocked('unknown_scheme');
  }

  // (3) Split path / query.
  const { path, segments, query } = splitPathAndQuery(tail);
  if (segments.length === 0) {
    return blocked('unknown_path');
  }

  // (4) Multi-segment patterns first.
  if (segments.length === 2) {
    const [head, value] = segments as readonly [string, string];

    // /r/:code → referral-gate
    if (head === 'r') {
      if (value === '') return blocked('unknown_path');
      return ok(FUNNEL_KEBAB_SLUGS.referral_gate, Object.freeze({ code: value }));
    }

    // /s/:token → result-reveal (preview entry via path segment)
    if (head === 's') {
      if (value === '') return blocked('unknown_path');
      return ok(FUNNEL_KEBAB_SLUGS.result_reveal, Object.freeze({ token: value }));
    }

    // /magazine/:month → magazine
    if (head === 'magazine') {
      if (value === '') return blocked('unknown_path');
      return ok(MAGAZINE_SCREEN_ID, Object.freeze({ month: value }));
    }
  }

  // (5) Single-segment paths — funnel kebab slug or direct preview path.
  if (segments.length === 1) {
    const slug = segments[0] as string;

    // The funnel-kebab branch covers /welcome-hook, /result-reveal,
    // /referral-gate, /value-props, /rating-gate, …. The result-reveal
    // and referral-gate slugs are externally-allowed (and also reachable
    // via /s/:token and /r/:code respectively); welcome-hook is the
    // canonical campaign-landing entry; everything else is internal-only.
    if (FUNNEL_KEBAB_SLUGS_ORDERED.includes(slug)) {
      if (isInternalOnlyFunnelKebabSlug(slug)) {
        return blocked('internal_only_funnel');
      }
      // /result-reveal as a funnel slug accepts the share_token query;
      // every other externally-allowed slug accepts the UTM bundle.
      // We surface BOTH allowlists for the result-reveal slug so a
      // single URL like `/result-reveal?utm_source=email&share_token=tok`
      // (campaign-attributed share link) round-trips both pieces of
      // attribution to the downstream Zod validator.
      const allowlist =
        slug === FUNNEL_KEBAB_SLUGS.result_reveal
          ? [...FUNNEL_UTM_QUERY_PARAMS, SHARE_TOKEN_QUERY_PARAM]
          : FUNNEL_UTM_QUERY_PARAMS;
      return ok(slug, filterAllowedQueryParams(query, allowlist));
    }

    // (no funnel-slug match) — fall through to unknown_path below.
  }

  // (6) Catch-all.
  // `path` is referenced indirectly via `segments`; we keep the local
  // binding alive (it's the canonical reconstructed form) so any future
  // debug logger has it in scope without re-deriving from `segments`.
  void path;
  return blocked('unknown_path');
}
