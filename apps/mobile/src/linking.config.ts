/**
 * Expo Router linking config — semantic-kebab path mapping for the
 * 12-step Glam Up funnel (한국 변형, v0.2).
 *
 * Why this module exists (Sub-AC 3.1 contract):
 *   The funnel route group at `apps/mobile/app/(funnel)/` exposes 12 screens
 *   whose filenames are semantic-kebab forms of `FUNNEL_STEPS_ORDERED`
 *   (`welcome-hook.tsx`, `onboarding-priming.tsx`, ...). Expo Router's
 *   default linking config maps filename → URL path 1:1, which is exactly
 *   what we want for the funnel paths, but the project needs the mapping
 *   exported as a typed, testable constant so:
 *
 *     1. Deep-link entry points (utm-tagged campaign links, /r/<code>
 *        referral links, /s/<token> share links, the /result-reveal preview)
 *        can be wired against a single source of truth in later sub-ACs.
 *     2. Drift between `FUNNEL_STEPS_ORDERED` (v0.2, snake_case in core-ts)
 *        and the mobile route filenames (kebab-case `.tsx` files) is caught
 *        in CI by the sibling unit test rather than at runtime by a 404.
 *     3. The 9 internal-only screens (security invariant — see Sub-AC 4)
 *        and the 6 external-allowlisted screens are described from one
 *        place, so a future contributor cannot accidentally expose an
 *        internal route via a deep link.
 *
 * What is intentionally NOT in this file:
 *   - Zod schemas for route params (`welcome-hook` UTM bundle, `result-reveal`
 *     `share_token`) — those live in `packages/core-ts/funnel` so the
 *     server-side referral / share endpoints can reuse the same validators.
 *   - The `prefixes` array for universal-link domains (.invalid TLD
 *     placeholders) — owned by a sibling sub-AC.
 *   - The 9 internal-only deep-link blocker — owned by a sibling sub-AC.
 *
 * This module exports ONLY the path mapping + the `(funnel)` screens block.
 * Sibling sub-ACs compose it into a complete `LinkingOptions` object.
 *
 * Invariants enforced by the sibling test
 * (`apps/mobile/tests/linking-config.test.ts`):
 *
 *   - `FUNNEL_KEBAB_SLUGS` has exactly one entry per `FunnelStepId` in
 *     `FUNNEL_STEPS_ORDERED`, in the same canonical order.
 *   - Every kebab slug is the deterministic kebab-case form of its
 *     snake_case `FunnelStepId` (no manual renames; computed via
 *     `toKebabSlug`).
 *   - The `LINKING_CONFIG.screens['(funnel)'].screens` map has exactly
 *     12 entries.
 *   - For every entry, the screen key and the path string are identical
 *     (parity invariant: file route name === URL path).
 *   - The magazine route (`magazine/:id`) is registered exactly once
 *     outside the funnel group and is NOT confused with a funnel slug.
 */
import {
  FUNNEL_STEPS_ORDERED,
  TOTAL_FUNNEL_STEPS,
  type FunnelStepId,
} from 'core-ts/funnel/types';
import {
  DEEP_LINK_PREFIXES,
  UNIVERSAL_LINK_DOMAINS,
} from './deep-link-paths';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Semantic-kebab slug for a funnel step. Always the deterministic
 * `snake_case → kebab-case` transform of a `FunnelStepId`.
 *
 * Typed as a plain `string` (rather than a template-literal-derived union)
 * because Expo Router's linking config keys are plain strings; the
 * runtime equality assertion in `linking-config.test.ts` is what enforces
 * the structural contract.
 */
export type FunnelKebabSlug = string;

/**
 * Subset of `LinkingOptions['config']` we own here: the `(funnel)` group
 * plus the `magazine/[month]` dynamic route.
 *
 * We avoid importing `LinkingOptions` from `@react-navigation/native`
 * directly because it pulls a large RN type graph through the test
 * runtime; the shape we produce is structurally compatible with what
 * `expo-router` / `@react-navigation/native` consume at runtime.
 */
export interface FunnelLinkingConfig {
  readonly screens: {
    readonly '(funnel)': {
      readonly screens: Readonly<Record<FunnelKebabSlug, FunnelKebabSlug>>;
    };
    readonly 'magazine/[month]': string;
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Deterministic `snake_case → kebab-case` transform.
 *
 * Pure function (no closure over module state) so it can be unit-tested
 * directly and reused in any sub-AC that needs the same conversion
 * (e.g. analytics tag building).
 *
 * Contract:
 *   - Input MUST be a non-empty `snake_case` ASCII string.
 *   - All underscores are replaced with hyphens.
 *   - Case is preserved (no toLowerCase) so a future capitalised
 *     identifier would surface as a test failure rather than be silently
 *     normalised.
 */
export function toKebabSlug(snakeId: string): FunnelKebabSlug {
  if (snakeId.length === 0) {
    throw new Error('toKebabSlug: snakeId must be non-empty');
  }
  return snakeId.replace(/_/g, '-');
}

/**
 * Build the ordered `FunnelStepId → FunnelKebabSlug` map from
 * `FUNNEL_STEPS_ORDERED`. Factored out so the test suite can call it
 * deterministically and assert ordering / completeness without
 * re-implementing the kebab transform.
 */
function buildFunnelKebabSlugs(): Readonly<Record<FunnelStepId, FunnelKebabSlug>> {
  const entries = FUNNEL_STEPS_ORDERED.map(
    (id) => [id, toKebabSlug(id)] as const,
  );
  const map = Object.fromEntries(entries) as Record<FunnelStepId, FunnelKebabSlug>;
  return Object.freeze(map);
}

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/**
 * Canonical, frozen `FunnelStepId → semantic-kebab slug` mapping.
 *
 * The map is exhaustive on `FunnelStepId` (compile-time enforced by the
 * `Record<FunnelStepId, ...>` return type of `buildFunnelKebabSlugs`).
 * The sibling unit test additionally asserts that the runtime entries
 * match `FUNNEL_STEPS_ORDERED` 1:1 in the same order.
 */
export const FUNNEL_KEBAB_SLUGS: Readonly<Record<FunnelStepId, FunnelKebabSlug>> =
  buildFunnelKebabSlugs();

/**
 * Ordered list of just the kebab slugs, in canonical funnel order.
 *
 * Convenience for callers that need to iterate (e.g. emit a Stack.Screen
 * for each one in `_layout.tsx`) without re-deriving the order.
 */
export const FUNNEL_KEBAB_SLUGS_ORDERED: readonly FunnelKebabSlug[] = Object.freeze(
  FUNNEL_STEPS_ORDERED.map((id) => FUNNEL_KEBAB_SLUGS[id]),
);

/**
 * The `(funnel)` group's screens block, built from `FUNNEL_KEBAB_SLUGS`.
 *
 * Each entry follows Expo Router's filename-as-path convention: the
 * key is the file route name (e.g. `welcome-hook`, matching
 * `app/(funnel)/welcome-hook.tsx`) and the value is the URL path
 * (`welcome-hook`). The keys and values are deliberately identical —
 * the sibling unit test pins this `key === value` parity so any drift
 * (e.g. an accidentally edited path string) is caught in CI.
 *
 * Why entries instead of `FUNNEL_KEBAB_SLUGS` directly: the type of
 * `FUNNEL_KEBAB_SLUGS` is `Record<FunnelStepId, ...>` (snake_case keys
 * to satisfy the exhaustive-record check), but Expo Router needs
 * kebab-case route-name keys. We rebuild here so both maps coexist
 * with the correct key shape for their consumer.
 */
function buildFunnelScreensBlock(): Readonly<
  Record<FunnelKebabSlug, FunnelKebabSlug>
> {
  const entries = FUNNEL_KEBAB_SLUGS_ORDERED.map((slug) => [slug, slug] as const);
  return Object.freeze(Object.fromEntries(entries));
}

/**
 * Linking config slice owned by this module.
 *
 * Composition order (frozen at every level):
 *   - `screens['(funnel)'].screens`  → 12 kebab paths, key === value.
 *   - `screens['magazine/[month]']`  → `magazine/:month` dynamic route.
 *
 * Sibling sub-ACs will compose this with:
 *   - `prefixes`: `[ 'personal-color-kr://', 'https://pcolor.invalid',
 *      'https://personalcolor-kr.invalid' ]`
 *   - referral / share top-level paths (`/r/:code`, `/s/:token`).
 *   - internal-only blocking layer (9 screens).
 */
export const LINKING_CONFIG: FunnelLinkingConfig = Object.freeze({
  screens: Object.freeze({
    '(funnel)': Object.freeze({
      screens: buildFunnelScreensBlock(),
    }),
    'magazine/[month]': 'magazine/:month',
  }),
});

/**
 * Total number of funnel routes mapped — must always equal
 * `TOTAL_FUNNEL_STEPS` (12). Exported so the sibling test can assert
 * the count without re-implementing it.
 */
export const TOTAL_FUNNEL_KEBAB_ROUTES: number = TOTAL_FUNNEL_STEPS;
