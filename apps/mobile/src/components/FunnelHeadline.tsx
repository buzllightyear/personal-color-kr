/**
 * `FunnelHeadline` — shared headline + subhead typography group for the
 * Phase 2.3 funnel screens (welcome_hook, value_props, onboarding_priming,
 * rating_gate, fake_loader).
 *
 * Sub-AC 10 responsibility:
 *   Render the canonical "primary headline above secondary subhead" typography
 *   group used by every funnel step. The Korean copy comes from
 *   `core-ts/funnel/screens.ts` (FUNNEL_SCREENS[stepId].headline / .subhead)
 *   and is passed in via props — the component itself is copy-agnostic so it
 *   can be reused for any Korean (or English-tagline) variant a future
 *   experiment introduces.
 *
 *   Concretely, each funnel screen's presentational component will mount:
 *
 *     <FunnelHeadline
 *       headline={FUNNEL_SCREENS.welcome_hook.headline}
 *       subhead={FUNNEL_SCREENS.welcome_hook.subhead}
 *       testIDPrefix="welcome-hook"
 *     />
 *
 *   …producing two `<Text>` rows (headline.bold + subhead.regular) with the
 *   correct grayscale text colour, the canonical headline→subhead vertical
 *   gap, and stable `testID`s the unit tests can pin against.
 *
 * Extraction threshold (Seed constraint):
 *   "Shared component extraction threshold: 2+ reuses with consistent visual
 *    semantics." The headline+subhead pair appears on **every** funnel screen
 *   in the FUNNEL_SCREENS metadata (welcome_hook, value_props,
 *   onboarding_priming, rating_gate, fake_loader — and steps 6–12). The
 *   typography is identical at every site (bold headline, regular subhead,
 *   grayscale text colour, same vertical rhythm), so DRY-ing it into one
 *   component:
 *     - Pins the Korean glyph rhythm in one place — if a designer tweaks the
 *       headline→subhead gap from 8px to 12px later, exactly one file changes.
 *     - Prevents drift on the testID convention (every screen uses the same
 *       `<prefix>-headline` and `<prefix>-subhead` testIDs).
 *     - Lets future variants (e.g. a smaller fake_loader status headline)
 *       opt-in via a prop instead of reimplementing the whole stack.
 *
 * What this component is NOT:
 *   - A screen layout. Padding, safe-area insets, and the surrounding
 *     `<View>` belong to the sibling `FunnelScreenLayout` component (parallel
 *     AC). `FunnelHeadline` is a leaf — it lays out two `<Text>` rows with a
 *     small vertical gap and nothing else.
 *   - A CTA. Buttons live in `FunnelPrimaryButton` (parallel AC).
 *   - A copy source. Korean text flows in via props from
 *     `core-ts/funnel/screens.ts`; the component never embeds a literal.
 *
 * Why props for `headline` / `subhead` (not a `stepId` lookup):
 *   - The FUNNEL_SCREENS metadata import is per-screen. Receiving the strings
 *     directly keeps this component free of any core-ts dependency, which in
 *     turn means it can be unit-tested without mocking the core-ts module
 *     graph. The screen route (or its presentational component) owns the
 *     lookup.
 *   - Allows a future screen variant to substitute alternative copy (e.g. an
 *     A/B headline experiment) without forking the component.
 *
 * Why `<Text>` numbers / weights come from the design tokens:
 *   - Seed constraint: "Design tokens defined in apps/mobile/src/theme/ with
 *     TypeScript const + as const pattern". Hard-coding `fontSize: 28` here
 *     would duplicate the token and silently drift if the headline scale
 *     ever changes. Spreading `TYPOGRAPHY.headline.bold` keeps the component
 *     symbol-bound to the single source of truth.
 *   - The grayscale text colour (`COLORS.grayscale.text`) is the canonical
 *     near-black colour used by every text node in the funnel.
 *
 * Why a `gap`-style vertical spacing in the container (not `marginTop` on
 * the subhead):
 *   - `gap` (RN ≥ 0.71) renders identically to a `marginTop` here for two
 *     children, but reads more declaratively as "rhythm between rows" and
 *     trivially generalises if a future variant inserts a third row between
 *     the headline and subhead.
 *   - Pinned to `SPACING.xs` (8px) to match the typography rhythm
 *     documented in the FunnelScreen ontology — tight enough that the two
 *     rows read as a single typographic unit, loose enough that hangul
 *     ascenders/descenders do not visually overlap.
 *
 * Accessibility surface (Seed constraint "accessibility_minimum_met"):
 *   - Both rows are exposed to screen readers as `accessibilityRole="header"`
 *     (RN supports this on `<Text>`, mapping to UIAccessibilityTraitHeader on
 *     iOS and AccessibilityNodeInfo.HEADING on Android). The visual
 *     hierarchy between the two rows is conveyed through font size
 *     (`headline` = 28pt, `subhead` = 20pt) and the source-order in which
 *     the screen reader announces them — React Native's stable Text API
 *     does not expose an `accessibilityLevel`-style heading-level attribute
 *     on native, so the role alone carries the semantic intent.
 *   - The visible Korean text is itself the accessibility label — no separate
 *     `accessibilityLabel` is required because the rendered string IS the
 *     announcement on both platforms. Forcing a synthesised label would
 *     duplicate the visible copy and risk drift between sighted and
 *     non-sighted users' experience.
 *   - `fontSize` is set from the typography tokens (no inline `lineHeight`,
 *     no fixed `width`) so the platform Dynamic Type setting scales both
 *     rows proportionally. The Seed constraint "fontSize-only for dynamic
 *     type support" is satisfied because the tokens carry only `fontSize`
 *     and `fontWeight`.
 *
 * Why `testIDPrefix` (not separate `headlineTestID` / `subheadTestID` props):
 *   - The Seed kebab-case testID convention is `<screen-name>-<element-role>`.
 *     A single prefix prop reconstructs both testIDs deterministically
 *     (`${prefix}-headline`, `${prefix}-subhead`), so a screen mounting the
 *     component cannot accidentally desync the two testIDs.
 *   - Reduces prop surface area: one string vs two, with no risk of a screen
 *     setting only one of them and breaking a downstream test.
 *
 * Frozen invariants (asserted by the companion test):
 *   - `headline` text is the first child of the root view (top of the
 *     stack).
 *   - `subhead` text is the second child (immediately below the headline).
 *   - Both `<Text>` nodes carry the expected `testID` derived from the
 *     prefix.
 *   - The headline uses `TYPOGRAPHY.headline.bold`; the subhead uses
 *     `TYPOGRAPHY.subhead.regular`.
 *   - Both `<Text>` nodes carry `accessibilityRole="header"`.
 */
import * as React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { COLORS, SPACING, TYPOGRAPHY } from '../theme';

/**
 * Props for {@link FunnelHeadline}.
 *
 * All fields are `readonly` so a parent screen cannot mutate the props
 * object in place — which matches the Seed constraint "Context value types
 * must be immutable readonly" (extended here to component props for
 * consistency).
 */
export interface FunnelHeadlineProps {
  /**
   * Primary Korean headline text (h1 equivalent). Sourced from
   * `FUNNEL_SCREENS[stepId].headline` in `core-ts/funnel/screens.ts` —
   * never embedded as a literal in screen code.
   */
  readonly headline: string;
  /**
   * Secondary Korean subhead text (h2 equivalent). Sourced from
   * `FUNNEL_SCREENS[stepId].subhead` in `core-ts/funnel/screens.ts`.
   */
  readonly subhead: string;
  /**
   * Kebab-case testID prefix derived from the screen name (e.g.
   * `'welcome-hook'`, `'value-props'`). The component appends
   * `-headline` and `-subhead` to construct the per-row testIDs.
   *
   * Matches the Seed testID naming convention:
   * `<screen-name>-<element-role>`.
   */
  readonly testIDPrefix: string;
}

/**
 * Renders the canonical funnel-screen headline + subhead typography group.
 *
 * @see FunnelHeadlineProps for prop documentation.
 */
export function FunnelHeadline(props: FunnelHeadlineProps): React.ReactElement {
  const { headline, subhead, testIDPrefix } = props;
  const headlineTestID = `${testIDPrefix}-headline`;
  const subheadTestID = `${testIDPrefix}-subhead`;

  return (
    <View style={styles.container} testID={`${testIDPrefix}-headline-group`}>
      <Text
        style={styles.headline}
        testID={headlineTestID}
        accessibilityRole="header"
      >
        {headline}
      </Text>
      <Text
        style={styles.subhead}
        testID={subheadTestID}
        accessibilityRole="header"
      >
        {subhead}
      </Text>
    </View>
  );
}

/**
 * StyleSheet — derived entirely from design tokens. No hard-coded sizes,
 * colours, or spacing values. Any visual tweak should land in the token
 * module, not here.
 */
const styles = StyleSheet.create({
  container: {
    // Vertical rhythm between the two rows. `gap` reads more declaratively
    // than `marginTop` on the subhead and generalises trivially if a future
    // variant adds a third row.
    gap: SPACING.xs,
  },
  headline: {
    ...TYPOGRAPHY.headline.bold,
    color: COLORS.grayscale.text,
  },
  subhead: {
    ...TYPOGRAPHY.subhead.regular,
    color: COLORS.grayscale.text,
  },
});
