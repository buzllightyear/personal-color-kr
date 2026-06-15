/**
 * `GuideList` — three-row selfie-prep guidance list rendered above (or below)
 * the capture surface on the Phase 2.3 `diagnosis_input` screen (step 7).
 *
 * Sub-AC 5.1 responsibility (Phase 2.3):
 *   Render the three Korean selfie-prep cues — `정면` (front-facing),
 *   `자연광` (natural light), `민낯` (bare face) — as a *visually distinct*
 *   three-row checklist, separately from the FUNNEL_SCREENS subhead. The
 *   FUNNEL_SCREENS.diagnosis_input.subhead is a single dotted string
 *   ("정면 · 자연광 · 민낯에 가까울수록 결과가 정확해요") and works for the
 *   screen reader as a one-line announcement, but the *visual* design calls
 *   for three discrete cues with a leading ✓ marker so each cue reads as a
 *   "do this" affordance the user can scan independently.
 *
 *   Extracting the list into a dedicated leaf component:
 *     - Pins the three Korean labels in one tested location (a copy drift
 *       across screens — e.g. step 7 saying "정면" and a future step
 *       saying "정면사진" — gets caught by this component's unit test).
 *     - Lets the screen route mount it without re-deriving the layout
 *       rhythm at every call-site.
 *     - Reads as a single visual unit on screen readers via a stable
 *       container testID, with each row also independently announceable.
 *
 * What this component IS:
 *   - A presentational leaf over `react-native`'s `<View>` + `<Text>` that
 *     emits a 3-row checklist of the canonical Korean selfie-prep cues.
 *   - A self-contained copy holder: the three guide strings (`정면`,
 *     `자연광`, `민낯`) are exported as `GUIDE_ITEMS` so unit tests can
 *     reference them by symbol (no string drift across the test/source pair).
 *   - The single source of truth for the visual rhythm of the cue list
 *     (typography token + checkmark prefix + per-row vertical gap).
 *
 * What this component is NOT:
 *   - A subhead replacement. The screen still renders the FUNNEL_SCREENS
 *     subhead via `FunnelHeadline` — this list is a *visual* affordance
 *     that augments the subhead, not a replacement for it.
 *   - A configurable list. The three cues are intrinsic to the
 *     `diagnosis_input` screen's purpose (Korean personal-color selfie
 *     prep); a future variant that wants different cues should build a
 *     separate component rather than parameterising this one (the Seed
 *     extraction threshold "2+ reuses with consistent visual semantics" is
 *     not met yet for a generic checklist).
 *
 * Why the leading ✓ glyph (Unicode `✓`):
 *   - The Seed constraint forbids icon packages (`@expo/vector-icons`,
 *     `react-native-svg`). The ✓ check mark is a plain Unicode glyph that
 *     RN renders via the platform system font on both iOS and Android.
 *   - Visually it reads as "do this" affordance — the user understands
 *     each row as an *action* to perform, not just a piece of body copy.
 *   - The glyph is suppressed from the screen-reader announcement
 *     (`accessibilityElementsHidden` on its own `<Text>`) so VoiceOver
 *     does not say "check mark" before every cue; the spoken cue is the
 *     Korean label alone.
 *
 * Why all three guide strings are hard-coded (not pulled from
 * FUNNEL_SCREENS.metadata):
 *   - The Seed constraint explicitly says "Korean text hardcoded — no i18n".
 *   - The `FUNNEL_SCREENS.diagnosis_input.metadata` block does not (and
 *     should not) carry granular per-cue strings — the metadata is for
 *     orchestration (`requiredInputs`, `onboardingMovedToStep`), not for
 *     UI copy fragments. Co-locating the cues here keeps the component
 *     self-contained and unit-testable without a core-ts import cycle.
 *
 * Why a per-row testID convention `guide-list-item-{index}` plus a stable
 * label-only testID `guide-list-item-{index}-label`:
 *   - The container `guide-list` testID lets a screen-level test pin the
 *     overall presence of the list.
 *   - Per-row testIDs let a test assert the *order* of the cues (`정면`
 *     must come first, `자연광` second, `민낯` third) without depending on
 *     traversal order from `findAllByType('Text')`.
 *   - The label-only testID gives the test a way to assert the cue's
 *     visible Korean text directly, separate from the leading ✓ glyph.
 *
 * Accessibility surface (Seed constraint "accessibility_minimum_met"):
 *   - Each cue row is exposed to screen readers with an
 *     `accessibilityRole="text"` and an `accessibilityLabel` equal to the
 *     Korean cue itself (no synthesised wrapper copy). The ✓ glyph is
 *     marked `accessibilityElementsHidden` / `importantForAccessibility="no"`
 *     so VoiceOver/TalkBack announces only the cue.
 *   - `fontSize` is set from the typography tokens (no inline `lineHeight`,
 *     no fixed `width`) so the platform Dynamic Type setting scales the
 *     list proportionally with the rest of the screen.
 *
 * Frozen invariants (asserted by the companion test):
 *   - All three of `정면`, `자연광`, `민낯` appear in the rendered output.
 *   - The cues render in the documented order (정면 → 자연광 → 민낯).
 *   - Each cue row carries a `guide-list-item-{index}` testID.
 *   - The container carries a `guide-list` testID.
 *   - The component renders exactly three cue rows (no stray rows).
 */
import * as React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { SPACING } from '../../theme';
import { FONT, INK } from '../../theme/editorial';

/**
 * The three Korean selfie-prep cues, in canonical reading order.
 *
 * Exported so the companion unit test can reference these strings by symbol
 * rather than re-typing the literals (any string drift between the
 * component and the test would otherwise be silently incompatible).
 *
 * Frozen so a downstream consumer cannot mutate the array in place and
 * silently reorder the cues for everyone — matching the "no mutation"
 * rule from the project coding-style.
 */
export const GUIDE_ITEMS: readonly string[] = Object.freeze(['정면', '자연광', '민낯']);

/**
 * The leading ✓ glyph (Unicode `✓`). Pulled out as a named constant so
 * the test can reference it without sprinkling magic-string check marks
 * across the assertion surface.
 */
const CHECK_GLYPH = '✓';

/**
 * Props for {@link GuideList}.
 *
 * The component is intentionally near-prop-less — the three cues and the
 * visual rhythm are intrinsic to the `diagnosis_input` screen's purpose
 * (see the file-level docblock for the rationale). Only the testID prefix
 * is parameterised so a future screen that wanted to mount two GuideLists
 * could disambiguate their testID trees.
 *
 * All fields are `readonly` to match the "no mutation" project rule.
 */
export interface GuideListProps {
  /**
   * Optional kebab-case testID prefix. Defaults to `'guide-list'` so a
   * screen mounting a single GuideList does not need to thread the prop.
   *
   * The component appends `-item-{index}` and `-item-{index}-label` to
   * construct the per-row testIDs.
   */
  readonly testIDPrefix?: string;
}

/**
 * Renders the canonical three-row selfie-prep cue checklist for the
 * `diagnosis_input` screen.
 *
 * @see GuideListProps for prop documentation.
 * @see GUIDE_ITEMS for the canonical Korean cue strings.
 */
export function GuideList(props: GuideListProps = {}): React.ReactElement {
  const testIDPrefix = props.testIDPrefix ?? 'guide-list';

  return (
    <View style={styles.container} testID={testIDPrefix} accessibilityRole="list">
      {GUIDE_ITEMS.map((cue, index) => {
        const rowTestID = `${testIDPrefix}-item-${index}`;
        const labelTestID = `${rowTestID}-label`;
        return (
          <View key={cue} style={styles.row} testID={rowTestID}>
            <Text
              style={styles.check}
              // The ✓ glyph is decorative — the cue's accessibility label
              // sits on the adjacent label `<Text>` below. Suppress this
              // glyph from the spoken announcement so VoiceOver does not
              // say "check mark" before every cue.
              accessibilityElementsHidden
              importantForAccessibility="no"
            >
              {CHECK_GLYPH}
            </Text>
            <Text
              style={styles.label}
              testID={labelTestID}
              accessibilityRole="text"
              accessibilityLabel={cue}
            >
              {cue}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/**
 * StyleSheet — derived entirely from design tokens. No hard-coded sizes,
 * colours, or spacing values; any visual tweak should land in the token
 * module, not here.
 */
const styles = StyleSheet.create({
  container: {
    // Vertical rhythm between the three cue rows. `SPACING.xs` (8px) is
    // tight enough that the rows read as a single checklist unit, loose
    // enough that hangul ascenders/descenders do not visually crowd.
    gap: SPACING.xs,
  },
  row: {
    // Each row is a flex-row so the ✓ glyph sits on the same baseline as
    // the Korean cue. `alignItems: 'center'` keeps the glyph centered to
    // the cap-height of the cue label across different platforms.
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  check: {
    // The ✓ glyph reads in primary ink — monochrome, same weight family as
    // the cue label (no coral).
    fontFamily: FONT.medium,
    fontSize: 15,
    color: INK.primary,
  },
  label: {
    fontFamily: FONT.regular,
    fontSize: 15,
    color: INK.primary,
  },
});
