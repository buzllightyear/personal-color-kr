/**
 * Deep-link path scheme constants — single source of truth for the
 * six external entry points into the personal-color-kr mobile app
 * (Sub-AC 2.1).
 *
 * Why this module exists:
 *   The funnel route group at `apps/mobile/app/(funnel)/` is reachable
 *   from a small, deliberately enumerated set of external URLs. Each
 *   one has a different parameter contract (UTM bundle, referral code,
 *   share token, etc.) and a different security posture (some screens
 *   are external-only, most are internal-only). A future contributor
 *   wiring a marketing campaign or a server-side referral endpoint
 *   needs to be able to read the canonical URL pattern from exactly
 *   one place — re-deriving it inline guarantees drift between the
 *   server, the deep-link handler, and the analytics tag builders.
 *
 *   This file is that one place.
 *
 * The six deep-link path schemes (Sub-AC 2.1 contract):
 *
 *   1. `/<kebab>?utm…`       Funnel kebab path with UTM query params.
 *                            `welcome-hook` consumes the full bundle
 *                            (`utm_source/medium/campaign/term/content`
 *                            + `referrer_code` + `referrer_channel`).
 *                            The path is just the kebab slug
 *                            (mapped by `FUNNEL_KEBAB_SLUGS` in
 *                            `linking.config.ts`); the contract this
 *                            module owns is the allowed query-param
 *                            allowlist.
 *
 *   2. `/r/:code`            Referral entry point. Maps to the
 *                            referral-gate flow after server-side
 *                            attribution.
 *
 *   3. `/s/:token`           Share entry point. Activates the
 *                            preview-mode `result-reveal` view for a
 *                            recipient who landed via a shared link.
 *
 *   4. `/result-reveal`      Direct preview-mode path (alternative
 *                            entry to `/s/:token` when the token is
 *                            attached as a query parameter rather
 *                            than a path segment). Distinct from the
 *                            in-funnel `result-reveal` step because
 *                            external entry forces `isPreviewMode`.
 *
 *   5. `/magazine/:month`    Post-payment magazine deep link. The
 *                            existing file-based route at
 *                            `apps/mobile/app/magazine/[month].tsx`
 *                            resolves the dynamic segment as `:month`
 *                            (Expo Router uses the bracket filename
 *                            verbatim). The Sub-AC 2.1 description
 *                            calls this `magazine/:id` as a generic
 *                            placeholder — `:month` is the concrete
 *                            dynamic-segment name. See
 *                            `apps/mobile/src/linking.config.ts` for
 *                            the matching `LINKING_CONFIG` entry.
 *
 *   6. Universal-link domains   The .invalid TLD placeholders
 *                            (`pcolor.invalid`, `personalcolor-kr.invalid`)
 *                            used as Apple Universal Link / Android
 *                            App Link domains. Placeholders only;
 *                            the production domain will be swapped
 *                            in by a sibling sub-AC. RFC 2606 reserves
 *                            `.invalid` so neither URL can ever resolve
 *                            to a real host — the placeholder cannot
 *                            be exfiltrated to a third-party server
 *                            by mistake.
 *
 * What this module is NOT:
 *   - It does not build the runtime `LinkingOptions` object — that's
 *     `linking.config.ts`'s job. This module exports the primitive
 *     path strings and prefix arrays that `linking.config.ts` (and
 *     other consumers) compose into a full config.
 *   - It does not validate route params — Zod schemas for that live
 *     in `packages/core-ts/funnel/` so the server-side referral / share
 *     endpoints can reuse them.
 *   - It does not enforce the 9-internal-only allowlist. That's a
 *     separate sibling sub-AC owning the security invariant.
 *
 * Frozen invariants:
 *   - Every aggregate (`DEEP_LINK_PREFIXES`, `UNIVERSAL_LINK_DOMAINS`,
 *     `FUNNEL_UTM_QUERY_PARAMS`, `DEEP_LINK_PATH_SCHEMES`) is `Object.freeze`d
 *     at module-load time. Downstream consumers cannot mutate the
 *     source of truth.
 *   - All universal-link domains MUST use the `.invalid` TLD (RFC 2606).
 *     A regression that introduces a real domain (e.g. `example.com`)
 *     would be caught by `tests/deep-link-paths.test.ts`.
 */

// ---------------------------------------------------------------------------
// URL scheme & universal-link prefixes
// ---------------------------------------------------------------------------

/**
 * Custom URL scheme registered with Expo (see `app.config.ts`).
 *
 * Held here as a typed constant rather than re-typed inline so that
 * the deep-link prefix builder, the unit test, and any future consumer
 * agree on the exact scheme string. A drift between this constant and
 * `app.config.ts` would surface as an `expo-linking` resolution failure
 * at runtime — `tests/deep-link-paths.test.ts` pins the value.
 */
export const CUSTOM_URL_SCHEME = 'personal-color-kr' as const;

/**
 * Universal-link domains (.invalid TLD placeholders).
 *
 * Two domains because the brand uses two complementary surfaces:
 *   - `pcolor.invalid`            — short marketing host.
 *   - `personalcolor-kr.invalid`  — long, brand-explicit host used
 *     by SEO landing pages.
 *
 * Both MUST stay on the `.invalid` TLD per RFC 2606 until a real
 * domain is provisioned by a sibling sub-AC. The test suite enforces
 * this — a regression that adds `example.com` or any non-`.invalid`
 * host fails CI.
 *
 * Single-point-of-truth invariant: any module that needs to declare
 * a universal-link prefix MUST import this constant rather than
 * inlining the strings.
 */
export const UNIVERSAL_LINK_DOMAINS: readonly string[] = Object.freeze([
  'pcolor.invalid',
  'personalcolor-kr.invalid',
]);

/**
 * Full deep-link prefix array consumed by `expo-linking` /
 * `@react-navigation/native` as `LinkingOptions['prefixes']`.
 *
 * Composition order matters for `expo-linking`'s URL resolution:
 *   1. The custom scheme (`personal-color-kr://`) handles app-to-app
 *      and Branch.io-style redirects.
 *   2. The `.invalid` universal-link prefixes match Apple Universal
 *      Links / Android App Links.
 */
export const DEEP_LINK_PREFIXES: readonly string[] = Object.freeze([
  `${CUSTOM_URL_SCHEME}://`,
  ...UNIVERSAL_LINK_DOMAINS.map((domain) => `https://${domain}`),
]);

// ---------------------------------------------------------------------------
// (1) Funnel kebab path + UTM query params
// ---------------------------------------------------------------------------

/**
 * UTM + referrer query-param allowlist for the funnel-kebab deep-link
 * scheme.
 *
 * Why this is the right shape for the contract:
 *   - The path itself is just `<kebab>` (e.g. `welcome-hook`,
 *     `value-props`), already exported as `FUNNEL_KEBAB_SLUGS` from
 *     `linking.config.ts`. There is nothing new to encode in the
 *     path string.
 *   - The acquisition-attribution layer is what's new: `welcome-hook`
 *     consumes the standard five UTM params plus two referrer params
 *     (per the seed contract:
 *     "welcome-hook: utm 5종+referrer_code+referrer_channel").
 *   - Listing the param names here (rather than relying on the Zod
 *     schema in `core-ts`) gives the deep-link handler an O(1)
 *     allowlist for stripping unknown query keys before validation.
 *
 * The seven names are alphabetical-by-prefix to make diff noise
 * obvious if a future contributor adds an eighth.
 */
export const FUNNEL_UTM_QUERY_PARAMS: readonly string[] = Object.freeze([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'referrer_code',
  'referrer_channel',
]);

// ---------------------------------------------------------------------------
// (2) Referral entry point — /r/:code
// ---------------------------------------------------------------------------

/**
 * Referral deep-link path pattern.
 *
 * The dynamic segment is named `:code` to match the eventual Zod
 * schema field. The handler at this path performs server-side
 * attribution before routing the user into the funnel at the
 * `referral_gate` step (Step 10).
 */
export const REFERRAL_PATH_PATTERN = '/r/:code' as const;

// ---------------------------------------------------------------------------
// (3) Share entry point — /s/:token
// ---------------------------------------------------------------------------

/**
 * Share deep-link path pattern.
 *
 * The dynamic segment is named `:token` (opaque, server-issued
 * share token — distinct from a referral code). Landing on `/s/:token`
 * activates `isPreviewMode = true` and routes the recipient to a
 * read-only `result-reveal` view bypassing the funnel.
 */
export const SHARE_PATH_PATTERN = '/s/:token' as const;

// ---------------------------------------------------------------------------
// (4) Direct preview path — /result-reveal
// ---------------------------------------------------------------------------

/**
 * Direct preview-mode entry path.
 *
 * Alternative to `/s/:token` when the share token is conveyed as a
 * query parameter (`/result-reveal?share_token=…`) rather than a
 * path segment. Both forms activate `isPreviewMode`. Distinct from
 * the in-funnel `result-reveal` step because external entry forces
 * the preview branch.
 *
 * No leading double-slash, no trailing slash — matches the canonical
 * link form a campaign would compose.
 */
export const RESULT_REVEAL_PATH = '/result-reveal' as const;

// ---------------------------------------------------------------------------
// (5) Magazine entry point — /magazine/:month
// ---------------------------------------------------------------------------

/**
 * Magazine deep-link path pattern.
 *
 * The existing file-based route at
 * `apps/mobile/app/magazine/[month].tsx` exposes `:month` as the
 * dynamic segment. The Sub-AC 2.1 description uses `magazine/:id`
 * as a generic placeholder; `:month` is the concrete name we keep
 * to remain consistent with the file-system route. A future
 * rename to `:id` would require renaming the file, which the
 * seed explicitly defers ("Magazine 경로 재배치는 이번 unit 범위 밖").
 */
export const MAGAZINE_PATH_PATTERN = '/magazine/:month' as const;

// ---------------------------------------------------------------------------
// Aggregated 6-path scheme registry
// ---------------------------------------------------------------------------

/**
 * Discriminator tag for the funnel-kebab+UTM scheme entry.
 *
 * Because the funnel-kebab scheme is not a single path string (the
 * path varies by step), we expose the entry as an object with a
 * `kind` discriminator and the UTM allowlist. The other five entries
 * are plain string or string-array constants. Consumers that need
 * uniform iteration can branch on `typeof` or the `kind` discriminator.
 */
export interface FunnelKebabUtmScheme {
  readonly kind: 'funnel-kebab-utm';
  readonly queryParams: readonly string[];
}

/**
 * The canonical 6-path scheme map.
 *
 * Exposes every deep-link entry point exactly once, keyed by a
 * stable semantic identifier. The Sub-AC 2.1 acceptance test asserts
 * that this object has exactly six keys (the six schemes the seed
 * enumerates) and that each key resolves to the matching named
 * constant — preventing drift between the aggregator and the
 * individual exports.
 *
 * Key naming (camelCase, semantic):
 *   - `funnelKebabUtm` → scheme 1
 *   - `referralCode`   → scheme 2
 *   - `shareToken`     → scheme 3
 *   - `resultReveal`   → scheme 4
 *   - `magazine`       → scheme 5
 *   - `universalLink`  → scheme 6
 */
export interface DeepLinkPathSchemes {
  readonly funnelKebabUtm: FunnelKebabUtmScheme;
  readonly referralCode: typeof REFERRAL_PATH_PATTERN;
  readonly shareToken: typeof SHARE_PATH_PATTERN;
  readonly resultReveal: typeof RESULT_REVEAL_PATH;
  readonly magazine: typeof MAGAZINE_PATH_PATTERN;
  readonly universalLink: readonly string[];
}

export const DEEP_LINK_PATH_SCHEMES: DeepLinkPathSchemes = Object.freeze({
  funnelKebabUtm: Object.freeze({
    kind: 'funnel-kebab-utm' as const,
    queryParams: FUNNEL_UTM_QUERY_PARAMS,
  }),
  referralCode: REFERRAL_PATH_PATTERN,
  shareToken: SHARE_PATH_PATTERN,
  resultReveal: RESULT_REVEAL_PATH,
  magazine: MAGAZINE_PATH_PATTERN,
  universalLink: UNIVERSAL_LINK_DOMAINS,
});

/**
 * Total count of deep-link path schemes exposed by this module.
 *
 * Encoded as a typed literal `6` rather than computed from
 * `Object.keys(DEEP_LINK_PATH_SCHEMES).length` so the Sub-AC 2.1
 * test can pin the count both at the type level (will refuse to
 * compile if someone changes it to `7`) and at runtime.
 */
export const TOTAL_DEEP_LINK_PATH_SCHEMES = 6 as const;
