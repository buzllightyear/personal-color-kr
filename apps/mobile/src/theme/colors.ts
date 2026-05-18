/**
 * Design tokens — color palette for the personal-color-kr funnel UI.
 *
 * Single source of truth for every colour rendered by the Phase 2.3 funnel
 * screens (welcome_hook → fake_loader). Consumed by `StyleSheet.create(...)`
 * blocks inside each route's presentational component under `apps/mobile/src/`.
 *
 * Why a typed `as const` literal instead of a theme object instance:
 *   - `as const` narrows every nested string to its hex literal, so a typo
 *     like `COLORS.season.spirng` is a compile error (not a runtime
 *     `undefined`). This pairs with `exactOptionalPropertyTypes: true` to
 *     give us total-static guarantees over the design surface.
 *   - The object is implicitly immutable at the type system level (all
 *     fields are `readonly`) which matches the broader "no mutation" rule
 *     from the project coding-style — and avoids the overhead of an
 *     `Object.freeze(...)` runtime call.
 *
 * Three palette groups (matches the FunnelScreen ontology):
 *
 *   1. base (soft pink/coral) — Korean beauty market visual identity.
 *      Used for headlines, primary CTA backgrounds, and the soft surface
 *      gradients sprinkled across welcome_hook and value_props.
 *
 *   2. season — accent colours keyed to the four Korean personal-color
 *      categories (spring / summer / autumn / winter). The value_props
 *      cards each pick one season key as their accent stripe, and the
 *      fake_loader analysis line cycles through them. Hex values are
 *      illustrative of the canonical 4-season palette taught in Korean
 *      퍼스널 컬러 진단 (warm-bright, cool-soft, warm-deep, cool-deep);
 *      they are NOT diagnostic outputs — diagnosis comes from FAL.ai in
 *      Phase 3.
 *
 *   3. grayscale — the 4-level neutral scale used for backgrounds, body
 *      text, borders, and disabled states. Names match the ontology
 *      (`background`, `text`, `border`, `disabled`) so screens read as
 *      semantic intent rather than "gray-100 vs gray-300".
 *
 * All hex values are normalised to 6-digit uppercase `#RRGGBB` so a
 * single regex (`/^#[0-9A-F]{6}$/`) validates the entire palette in the
 * companion unit test.
 */

export const COLORS = {
  /** Soft pink / coral base palette — Korean beauty market visual identity. */
  base: {
    /** Soft pink — primary surface tint for welcome_hook and value_props headers. */
    pink: '#FFE4EC',
    /** Coral — primary CTA fill and emphasis accents. */
    coral: '#FF8FA3',
    /** Blush — secondary surface tint for cards and segmented controls. */
    blush: '#FFCAD4',
  },

  /** 4-season accent colours mapped to Korean personal-color categories. */
  season: {
    /** Warm-bright — 봄 웜톤 (coral-peach). */
    spring: '#F7A6B3',
    /** Cool-soft — 여름 쿨톤 (rose-blue). */
    summer: '#A6CDE3',
    /** Warm-deep — 가을 웜톤 (terracotta). */
    autumn: '#C9925E',
    /** Cool-deep — 겨울 쿨톤 (plum). */
    winter: '#5C5470',
  },

  /** 4-level grayscale for backgrounds, text, borders, and disabled states. */
  grayscale: {
    /** Page / surface background — pure white. */
    background: '#FFFFFF',
    /** Primary body text colour — near-black. */
    text: '#1A1A1A',
    /** Card / divider border — light gray. */
    border: '#D0D0D0',
    /** Disabled control fill / text — mid gray. */
    disabled: '#9E9E9E',
  },
} as const;

/**
 * Discriminated keys for each palette group. Exposed so screens can type
 * a "accent season for this card" prop as `SeasonKey` (e.g. `'spring' |
 * 'summer' | 'autumn' | 'winter'`) without re-typing the union.
 */
export type BaseColorKey = keyof typeof COLORS.base;
export type SeasonKey = keyof typeof COLORS.season;
export type GrayscaleKey = keyof typeof COLORS.grayscale;
