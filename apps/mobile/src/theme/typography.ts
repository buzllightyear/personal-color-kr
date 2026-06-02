/**
 * Design tokens — typography scale for the personal-color-kr funnel UI.
 *
 * Single source of truth for every text style rendered by the Phase 2.3
 * funnel screens (welcome_hook → fake_loader). Consumed by
 * `StyleSheet.create(...)` blocks inside each route's presentational
 * component under `apps/mobile/src/` via object spread:
 *
 *   const styles = StyleSheet.create({
 *     headline: { ...TYPOGRAPHY.headline.bold, color: COLORS.grayscale.text },
 *     body:     { ...TYPOGRAPHY.body.regular,  color: COLORS.grayscale.text },
 *   });
 *
 * The scale is a two-dimensional matrix:
 *
 *   - **5 levels** keyed by semantic intent (`headline`, `subhead`, `body`,
 *     `caption`, `button`). These mirror the FunnelScreen ontology and the
 *     existing screens.ts copy hierarchy (`headline`, `subhead`, `ctaLabel`).
 *
 *   - **3 weights** keyed by visual emphasis (`bold`, `medium`, `regular`).
 *     Bold is reserved for primary headlines and CTAs; medium gives subheads
 *     and emphasised body text just enough weight to stand out from regular
 *     paragraphs without competing with the headline.
 *
 * Why no custom font family:
 *   The Seed constraint explicitly forbids Pretendard (or any custom Korean
 *   font) and expo-font. Each platform's system font (SF Pro KR on iOS, the
 *   Noto-derived Roboto KR on Android) renders 한글 with native glyph
 *   metrics — no FOUT, no licensing, no bundle weight, no asset load. The
 *   font family is therefore *omitted* from these tokens; React Native
 *   defaults to the platform system font when `fontFamily` is undefined.
 *
 * Why numeric string fontWeight values (e.g. '700') rather than 'bold':
 *   React Native maps both `'bold'` and `'700'` to the same glyph on iOS
 *   and Android, but the *numeric* form is the only one that round-trips
 *   correctly through every Expo Router screen transition (the platform
 *   text layout cache keys on the literal string). Pinning the numeric form
 *   here means a contributor cannot accidentally mix `'bold'` and `'700'`
 *   across screens and produce inconsistent line-heights between routes.
 *
 *   Mapping (RN-supported subset):
 *     - regular →  '400' (system default body weight)
 *     - medium  →  '500' (one notch above regular; visible emphasis)
 *     - bold    →  '700' (system bold; matches iOS Semibold-Bold midpoint)
 *
 * Why no lineHeight/letterSpacing in the tokens:
 *   Korean text rendering uses platform-default line metrics, and forcing a
 *   lineHeight on hangul glyphs frequently crops the top of high-stroke
 *   characters (e.g. ㅎ, ㅊ). We let the platform pick the line height by
 *   leaving the field unset and only setting fontSize/fontWeight in the
 *   tokens. Screens that need a tighter line for a specific layout can add
 *   `lineHeight` locally in their StyleSheet — but the *token* contract
 *   stays minimal.
 *
 * Why `as const` instead of `TextStyle` cast:
 *   `as const` narrows `fontWeight: '400'` from the wide `string` type to
 *   the literal `'400'` — which is assignable to React Native's
 *   `TextStyle.fontWeight` union without any runtime cost. Importing
 *   `TextStyle` here would pull in `react-native`'s type surface, which
 *   bloats this token module's type graph for no functional gain (these
 *   tokens are pure data; the consumer applies them inside `StyleSheet`).
 *
 * Why a static font-size scale (not a multiplier function):
 *   The five fontSize levels (28 / 20 / 16 / 12 / 16) are calibrated for
 *   Korean glyph density at 1× scale on a 4-inch+ phone. They are
 *   intentionally NOT derived from a base × ratio computation — that
 *   pattern produces fractional sizes (`14.4`) which Android subpixel
 *   rounding renders inconsistently across devices. Static integers keep
 *   rendering deterministic.
 *
 * All fontSize values are positive integers; all fontWeight values are
 * three-character numeric strings. A single companion unit test sweeps
 * the 5 × 3 matrix and asserts both contracts.
 */

/**
 * Five semantic typography levels. Names match the FunnelScreen ontology
 * and the existing screens.ts content hierarchy.
 */
export type TypographyLevel = 'headline' | 'subhead' | 'body' | 'caption' | 'button';

/**
 * Three visual-emphasis weights. The names are *visual* (how heavy does it
 * look?), not numeric, so a designer can say "use medium" without
 * remembering whether that's 500 or 600.
 */
export type TypographyWeight = 'bold' | 'medium' | 'regular';

/**
 * Numeric string fontWeight values supported by React Native's TextStyle.
 * Exported as a literal-string union for downstream type narrowing.
 */
export type FontWeightNumeric = '400' | '500' | '700';

/**
 * Shape of a single typography token — the minimal `TextStyle` slice the
 * tokens commit to. Screens may spread this into a larger `TextStyle` to
 * add `color`, `lineHeight`, etc.
 */
export interface TypographyToken {
  readonly fontSize: number;
  readonly fontWeight: FontWeightNumeric;
}

export const TYPOGRAPHY = {
  /** Primary headline — welcome_hook hero, value_props page title, fake_loader status. */
  headline: {
    bold: { fontSize: 28, fontWeight: '700' },
    medium: { fontSize: 28, fontWeight: '500' },
    regular: { fontSize: 28, fontWeight: '400' },
  },

  /** Secondary subhead — sits below the headline; value_props card title. */
  subhead: {
    bold: { fontSize: 20, fontWeight: '700' },
    medium: { fontSize: 20, fontWeight: '500' },
    regular: { fontSize: 20, fontWeight: '400' },
  },

  /** Default body text — onboarding_priming questions, value_props descriptions. */
  body: {
    bold: { fontSize: 16, fontWeight: '700' },
    medium: { fontSize: 16, fontWeight: '500' },
    regular: { fontSize: 16, fontWeight: '400' },
  },

  /** Small caption text — disclaimers, fake_loader analysis points, footnotes. */
  caption: {
    bold: { fontSize: 12, fontWeight: '700' },
    medium: { fontSize: 12, fontWeight: '500' },
    regular: { fontSize: 12, fontWeight: '400' },
  },

  /** CTA button label — primary CTA on every funnel screen, segmented control. */
  button: {
    bold: { fontSize: 16, fontWeight: '700' },
    medium: { fontSize: 16, fontWeight: '500' },
    regular: { fontSize: 16, fontWeight: '400' },
  },
} as const satisfies Readonly<
  Record<TypographyLevel, Readonly<Record<TypographyWeight, TypographyToken>>>
>;
