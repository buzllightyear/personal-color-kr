/**
 * Editorial design tokens — the monochrome, type-led "VSCO" layer.
 *
 * The original `colors.ts` / `typography.ts` tokens encode the earlier
 * soft-pink/coral identity (and their unit tests pin those shapes exactly:
 * `COLORS.grayscale` is locked to four keys, `TYPOGRAPHY` to a 5×3 matrix).
 * Rather than mutate those frozen contracts, the editorial direction adds its
 * own additive tokens here:
 *
 *   - `FONT` — the Pretendard family names registered by
 *     `src/hooks/use-app-fonts` (and embedded via the expo-font config
 *     plugin). Reference these in `fontFamily` to get the light, regular,
 *     medium, and semibold cuts.
 *   - `INK` — a monochrome ramp (near-black → hairline → paper) plus a couple
 *     of neutral fills. Editorial screens compose almost entirely from these;
 *     the soft-pink `COLORS.base` palette and the four `COLORS.season` accents
 *     stay reserved for genuinely color-bearing moments (e.g. the diagnosed
 *     season swatch), not chrome.
 *
 * Keeping this in a separate module (consumed directly, not via the
 * `theme/index` barrel) means the editorial pivot does not touch the legacy
 * token tests; components import `from '../theme/editorial'` explicitly.
 */

/**
 * Pretendard family names. Each maps to a static OTF weight under
 * `assets/fonts/` and is registered at runtime by `useAppFonts`.
 */
export const FONT = {
  light: 'Pretendard-Light',
  regular: 'Pretendard-Regular',
  medium: 'Pretendard-Medium',
  semibold: 'Pretendard-SemiBold',
} as const;

export type FontKey = keyof typeof FONT;

/**
 * Monochrome ink ramp for the editorial direction.
 *
 *   - `primary` — near-black for headlines and the flat CTA fill (kept equal
 *     to the legacy `COLORS.grayscale.text` so the two systems agree on ink).
 *   - `muted`   — secondary text (subheads, captions).
 *   - `faint`   — tertiary text / disabled fills / placeholders.
 *   - `line`    — hairline dividers and outlines.
 *   - `wash`    — subtle neutral fill for inputs / cards.
 *   - `paper`   — the white surface (labels on the dark CTA, backgrounds).
 */
export const INK = {
  primary: '#1A1A1A',
  muted: '#8A8A8A',
  faint: '#B8B8B8',
  line: '#E8E8E8',
  wash: '#F4F4F4',
  paper: '#FFFFFF',
} as const;

export type InkKey = keyof typeof INK;
