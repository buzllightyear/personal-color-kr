/**
 * Design tokens — spacing scale for the personal-color-kr funnel UI.
 *
 * Single source of truth for every margin, padding, gap, and inset rendered
 * by the Phase 2.3 funnel screens (welcome_hook → fake_loader). Consumed by
 * `StyleSheet.create(...)` blocks inside each route's presentational
 * component under `apps/mobile/src/`.
 *
 *   const styles = StyleSheet.create({
 *     screen:    { paddingHorizontal: SPACING.lg, paddingVertical: SPACING.xl },
 *     cardStack: { gap: SPACING.md },
 *     ctaInset:  { marginTop: SPACING.xl, marginBottom: SPACING.xxl },
 *   });
 *
 * Why a 7-level t-shirt scale (xxs / xs / sm / md / lg / xl / xxl):
 *   - The Seed constraint pins spacing to "multiples of 4 (4, 8, 12, 16, 24,
 *     32, 48)" — exactly seven values. T-shirt sizing maps each numeric step
 *     to a semantic name so a screen can ask for `SPACING.lg` instead of
 *     remembering whether 24 is the right pixel count for a section gap.
 *   - Seven values is *deliberately small*. A larger scale invites
 *     bike-shedding ("is this 18 or 20?") and produces inconsistent rhythm
 *     across screens; seven steps cover every layout decision in the Phase
 *     2.3 funnel (4 = hairline gap, 48 = hero vertical breathing room).
 *
 * Why multiples of 4 (not 8 or arbitrary integers):
 *   - 4 is the smallest unit that still aligns cleanly to the platform
 *     rasterisation grids on both iOS (1pt = 2px @2x, 3px @3x — both divide
 *     4 evenly at our scale steps) and Android (mdpi/hdpi/xhdpi/xxhdpi all
 *     produce integer pixel counts at every step). Using a 4-multiple
 *     scale therefore guarantees no subpixel rounding artefacts on any
 *     supported device.
 *   - Multiples of 4 also map cleanly onto the typography fontSize scale
 *     (12 / 16 / 20 / 28), so a `paddingVertical: SPACING.sm` (=12) above a
 *     12pt caption produces a 1:1 vertical rhythm that's pleasing for
 *     Korean text density.
 *
 * Why integer literals (not a base × multiplier function):
 *   - Same Android subpixel-rounding rationale as TYPOGRAPHY (see
 *     `typography.ts`). A computed scale like `4 * Math.pow(1.5, n)`
 *     produces fractional values (6, 9, 13.5) which React Native passes
 *     straight to the platform layout engine; Android then rounds those
 *     inconsistently between devices, breaking pixel-perfect designs.
 *   - Static integers are also faster (no runtime arithmetic) and trivially
 *     auditable in a single screen of code.
 *
 * Why `as const` instead of a number array:
 *   - `as const` narrows each value from the wide `number` type to its
 *     literal (e.g. `4`, `8`, `12`), so a typo like `SPACING.smm` is a
 *     compile error (not a runtime `undefined` that silently produces a
 *     zero-pixel gap). This pairs with `exactOptionalPropertyTypes: true`
 *     to give us total-static guarantees over the spacing surface.
 *   - The object is implicitly immutable at the type system level (all
 *     fields are `readonly`) which matches the broader "no mutation" rule
 *     from the project coding-style — and avoids the overhead of an
 *     `Object.freeze(...)` runtime call.
 *
 * Why ascending order is part of the contract:
 *   - The companion unit test sweeps `Object.values(SPACING)` and asserts
 *     each value is strictly greater than its predecessor. That contract
 *     prevents a contributor from accidentally re-ordering the scale (e.g.
 *     swapping `md` and `lg`) and silently shifting every layout that
 *     consumes the tokens. The ascending invariant is *the* reason the
 *     t-shirt names map predictably to relative size.
 *
 * Token → pixel mapping:
 *   - xxs:  4  — hairline gap (border-adjacent inset, icon-to-text gap)
 *   - xs:   8  — tight inline spacing (badge padding, segmented control gap)
 *   - sm:  12  — small section gap (caption-to-body, card internal padding)
 *   - md:  16  — default content gap (button label padding, paragraph gap)
 *   - lg:  24  — section separator (between cards, between question groups)
 *   - xl:  32  — major section gap (above CTA, between screen regions)
 *   - xxl: 48  — hero breathing room (welcome_hook headline → subhead inset)
 */

/**
 * Semantic spacing scale names (t-shirt sizing). Names are *relative* (sm <
 * md < lg) so a designer can say "use lg padding" without remembering whether
 * that's 20px or 24px.
 */
export type SpacingKey = 'xxs' | 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'xxl';

export const SPACING = {
  /** 4px — hairline gap (border-adjacent inset, icon-to-text gap). */
  xxs: 4,
  /** 8px — tight inline spacing (badge padding, segmented control gap). */
  xs: 8,
  /** 12px — small section gap (caption-to-body, card internal padding). */
  sm: 12,
  /** 16px — default content gap (button label padding, paragraph gap). */
  md: 16,
  /** 24px — section separator (between cards, between question groups). */
  lg: 24,
  /** 32px — major section gap (above CTA, between screen regions). */
  xl: 32,
  /** 48px — hero breathing room (welcome_hook headline → subhead inset). */
  xxl: 48,
} as const satisfies Readonly<Record<SpacingKey, number>>;

/**
 * Ordered list of every spacing key, ascending by pixel value. Exposed so
 * the companion unit test (and any downstream consumer) can iterate the
 * scale in scale-order without re-deriving the sort from `Object.keys` —
 * `Object.keys` does not guarantee insertion order across every JS engine
 * for integer-keyed objects, and t-shirt-name string keys happen to sort
 * alphabetically in the *wrong* order (lg < md < sm < xl < xs < xxl < xxs).
 */
export const SPACING_KEYS_ORDERED: readonly SpacingKey[] = [
  'xxs',
  'xs',
  'sm',
  'md',
  'lg',
  'xl',
  'xxl',
] as const;
