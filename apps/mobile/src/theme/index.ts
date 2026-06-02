/**
 * Design tokens — unified theme aggregator for the personal-color-kr funnel UI.
 *
 * Single entry point for every design-token consumer (every `StyleSheet.create`
 * block in `apps/mobile/src/`, every shared funnel component, every test that
 * needs to assert against the token surface). Re-exports the three token
 * sub-modules (`colors`, `typography`, `spacing`) both as named exports for
 * direct destructuring and as fields on a unified `THEME` object so screens
 * can pick the style that matches their use-case:
 *
 *   // Style A — named imports (most concise; preferred at call-site)
 *   import { COLORS, TYPOGRAPHY, SPACING } from '../theme';
 *
 *   // Style B — single THEME import (preferred when a component receives
 *   // the whole theme via props, or when iterating in tests)
 *   import { THEME } from '../theme';
 *   const fill = THEME.colors.base.coral;
 *
 * Why a barrel re-export rather than forcing every consumer to deep-import
 * `../theme/colors`, `../theme/typography`, `../theme/spacing`:
 *   - The three sub-modules conceptually form a single design surface ("the
 *     theme"). A barrel matches that mental model and keeps import statements
 *     short — a screen with all three modules in scope has one `import` line
 *     instead of three.
 *   - Sub-module file paths are an implementation detail; the barrel makes
 *     `apps/mobile/src/theme/` the public API surface so a later refactor
 *     (splitting `colors.ts` into `colors-base.ts` + `colors-season.ts`,
 *     adding a `radii.ts` module, etc.) does not require a sweep of every
 *     consumer.
 *   - The Seed exit condition `design_tokens_complete` lists "Theme file
 *     exports color palette … typography scale … and spacing scale" as a
 *     single unit, and the FunnelScreen ontology bundles the three under one
 *     theme concept. A single index module is the cleanest way to satisfy
 *     that contract.
 *
 * Why expose BOTH named exports AND a `THEME` aggregate:
 *   - Named exports (`COLORS`, `TYPOGRAPHY`, `SPACING`) are what 95% of the
 *     screen StyleSheet blocks need — a destructured import keeps call-sites
 *     terse (`color: COLORS.grayscale.text` reads cleaner than
 *     `color: THEME.colors.grayscale.text`).
 *   - The `THEME` aggregate is what unit tests, shared funnel components, and
 *     any future context-based theme switcher want — a single object handle
 *     simplifies iteration ("every theme sub-module") and prop-passing
 *     ("pass the theme down once, not three constants").
 *   - Both shapes refer to the same underlying frozen-by-as-const literals,
 *     so there is zero risk of the two surfaces drifting from each other.
 *
 * Why `as const` on the aggregate:
 *   - The sub-module constants are already `as const`-narrowed; lifting the
 *     same narrowing onto the aggregate preserves the literal types of every
 *     leaf value (`THEME.colors.season.spring` stays the literal `'#F7A6B3'`,
 *     not `string`). This pairs with `exactOptionalPropertyTypes: true` to
 *     give us total-static guarantees over the theme surface.
 *   - The aggregate is implicitly immutable at the type system level (all
 *     fields are `readonly`) which matches the broader "no mutation" rule
 *     from the project coding-style — and avoids the overhead of an
 *     `Object.freeze(...)` runtime call.
 *
 * Why re-export the type aliases too:
 *   - Downstream consumers that take "a season key" as a prop need the
 *     `SeasonKey` union. Re-exporting from the barrel keeps the import line
 *     count down (`import { SeasonKey } from '../theme'` instead of
 *     `import { SeasonKey } from '../theme/colors'`) and reinforces the
 *     "theme is one public API" framing.
 */

export { COLORS, type BaseColorKey, type GrayscaleKey, type SeasonKey } from './colors';
export {
  TYPOGRAPHY,
  type FontWeightNumeric,
  type TypographyLevel,
  type TypographyToken,
  type TypographyWeight,
} from './typography';
export { SPACING, SPACING_KEYS_ORDERED, type SpacingKey } from './spacing';

import { COLORS } from './colors';
import { TYPOGRAPHY } from './typography';
import { SPACING } from './spacing';

/**
 * Unified theme aggregate — one object handle that exposes every token
 * sub-module under a stable shape (`colors`, `typography`, `spacing`).
 *
 * Use this when a component wants the whole theme (e.g. a shared funnel
 * component that styles itself from props, or a unit test iterating every
 * sub-module). For ordinary StyleSheet definitions inside a screen, prefer
 * the named exports (`COLORS`, `TYPOGRAPHY`, `SPACING`) for terser call-sites.
 *
 * Marked `as const` so every leaf value retains its literal type (hex
 * strings stay literal `'#RRGGBB'`, fontWeight stays `'400' | '500' | '700'`,
 * spacing values stay `4 | 8 | 12 | …`).
 */
export const THEME = {
  colors: COLORS,
  typography: TYPOGRAPHY,
  spacing: SPACING,
} as const;

/**
 * Static type of the unified theme aggregate. Exposed so a shared component
 * can declare `theme: Theme` in its props shape without re-deriving the type
 * from `typeof THEME` at every call-site.
 */
export type Theme = typeof THEME;
