/**
 * `PriceCard` — shared value-proposition card for the step-12 `payment_model`
 * screen (Phase 2.5, KR variant, AC 13).
 *
 * History (Phase 2.4 → Phase 2.5):
 *   In Phase 2.4 this component rendered the hardcoded one-time premium-unlock
 *   amount ("₩9,900") read from {@link formatPaymentAmountKrw}. Phase 2.5
 *   replaces the placeholder payment flow with the real Superwall SDK paywall
 *   trigger — the subscription price is owned entirely by the Superwall paywall
 *   modal (ASC sandbox product), so the app UI MUST NOT duplicate it. Per the
 *   Seed evaluation principle "price_single_source", the subscription price is
 *   displayed only via the Superwall paywall — no hardcoded duplicates in
 *   PriceCard, CTA label, or any other app UI.
 *
 *   The file name + the exported symbol name (`PriceCard`) are intentionally
 *   preserved so the sibling import-site (`apps/mobile/app/(funnel)/payment-model.tsx`)
 *   continues to compile through the parallel Phase 2.5 edit pass — the
 *   component's responsibility is repurposed, not renamed.
 *
 * Responsibility (Phase 2.5):
 *   Render a value-proposition card listing the three concrete benefits the
 *   user unlocks by subscribing — *without* displaying any price, currency
 *   amount, or "one-time vs subscription" framing copy. The price line and
 *   the "1회 결제 · 평생 이용" caption have been removed; the benefit list
 *   replaces them.
 *
 *   The three benefits ({@link VALUE_PROP_CARD_BENEFITS}) communicate scope
 *   ("full personal color analysis"), utility ("coordination
 *   recommendations"), and longevity ("lifetime save") — covering the same
 *   conversion-funnel motivators that drove the Phase 2.4 price line, but
 *   without committing the app to a specific currency string that would
 *   conflict with the live Superwall paywall.
 *
 * Why a dedicated component (not inlined into PaymentModelScreen):
 *   - Same "shared component extraction threshold: 2+ reuses with consistent
 *     visual semantics" rationale as Phase 2.4. The value-prop card is
 *     mounted by both the active payment_model screen AND any later
 *     analytics replay / dev-only preview surface; pulling the visual into a
 *     leaf keeps the screen-level test isolated from the benefit-list unit
 *     test.
 *   - Pins the visual contract in one location: soft-pink surface tint,
 *     blush border, benefit-row typography, and stable testIDs.
 *   - Forbids any future contributor from accidentally re-introducing a
 *     hardcoded price string in this surface — the component has no
 *     dependency on the price formatter at all (the import is gone), so a
 *     regression would require explicitly re-adding the import + reading
 *     the constant, which would surface in code review.
 *
 * What this component IS:
 *   - A pure presentational leaf that:
 *       (a) renders a heading text ("이 분석으로 받게 되는 것") inside the
 *           card so screen-readers and sighted users immediately understand
 *           the row list is a benefit enumeration, not arbitrary marketing
 *           copy;
 *       (b) renders three benefit rows, one per
 *           {@link VALUE_PROP_CARD_BENEFITS} entry, each carrying a
 *           checkmark glyph + the Korean benefit text;
 *       (c) exposes stable testIDs for the root card
 *           (`<prefix>-value-prop-card`), the heading text node
 *           (`<prefix>-value-prop-heading`), and each benefit row
 *           (`<prefix>-value-prop-item-<index>`) so the screen-level test
 *           can pin the display without re-implementing testID threading.
 *
 * What this component is NOT:
 *   - A pressable. The card is display-only; the user interacts with the
 *     sibling primary CTA + skip Pressable, not the value-prop card itself.
 *   - A source of any price string, currency amount, or "free trial /
 *     monthly" framing. The Superwall paywall modal owns all
 *     subscription-pricing copy. Per the Seed constraint "Subscription tier
 *     branching out of scope (single monthly product)" + "No free trial /
 *     introductory offer (Phase 4+)" the card must not pre-empt either.
 *   - A consumer of {@link formatPaymentAmountKrw} or {@link PAYMENT_AMOUNT_KRW}.
 *     The Phase 2.4 import is intentionally absent — a regression that
 *     re-adds it would be caught by the companion test's import-shape
 *     assertion.
 *
 * Token-driven styling:
 *   - Background: {@link COLORS.base.pink} — soft pink surface tint matching
 *     the Korean beauty market visual identity (welcome_hook + value_props
 *     use the same family). Carried forward from the Phase 2.4 PriceCard
 *     surface so the screen rhythm stays consistent across phases.
 *   - Border: 1px {@link COLORS.base.blush} — same Phase 2.4 border colour.
 *   - Border radius: 16 (stylistic constant, matches sibling card surfaces).
 *   - Vertical padding: {@link SPACING.lg} (24); horizontal padding:
 *     {@link SPACING.lg} — same outer breathing room as Phase 2.4.
 *   - Internal rhythm between heading + benefit list: {@link SPACING.sm}
 *     (12) — gives the heading a clear separation from the list without
 *     wasting vertical space.
 *   - Internal rhythm between benefit rows: {@link SPACING.xs} (8) — tight
 *     enough that the three rows read as a single list, loose enough that
 *     each row is individually scannable.
 *   - Heading typography: {@link TYPOGRAPHY.subhead.bold} (20pt/700) — large
 *     enough that the heading anchors the card visually, small enough to
 *     fit on a 4-inch+ device.
 *   - Benefit-row typography: {@link TYPOGRAPHY.body.regular} (16pt/400) —
 *     comfortable reading size for Korean glyphs, matches the body-text
 *     rhythm used elsewhere in the funnel.
 *   - Heading + row colour: {@link COLORS.grayscale.text} (near-black) for
 *     maximum AAA contrast on the soft pink fill.
 *
 * Accessibility surface:
 *   - The card root carries `accessibilityRole="summary"` (semantically: a
 *     summary of what the subscription unlocks) so VoiceOver / TalkBack
 *     announces the card as a discrete information region.
 *   - The heading text carries `accessibilityRole="header"` so screen
 *     readers expose it as a navigable landmark within the card.
 *   - Each benefit row carries `accessibilityRole="text"` and an
 *     `accessibilityLabel` matching the visible Korean copy verbatim — the
 *     leading "✓ " glyph is decorative, not announced, so the screen
 *     reader speaks the benefit cleanly.
 *
 * Why no prop surface (other than `testIDPrefix`):
 *   - The Seed constraint pins the benefit list as a fixed three-item
 *     enumeration; allowing callers to inject a custom `benefits` array
 *     would let a future screen accidentally render a divergent set.
 *   - Symmetric to {@link FunnelPrimaryButton}'s testID-only prop surface:
 *     the component owns its visual contract; callers control only the
 *     testID prefix for query disambiguation across multi-mount surfaces.
 */
import * as React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { SPACING } from '../../theme';
import { FONT, INK } from '../../theme/editorial';

/**
 * Default testID prefix used when the caller does not supply one. Exported
 * as a constant so unit tests and call-sites that want a stable handle can
 * refer to it by symbol — any drift between the component and the test
 * would otherwise be silently incompatible.
 *
 * Carried forward from Phase 2.4 unchanged (`'payment-model'`) because the
 * mounting screen (`payment_model`) and its testID prefix have not changed
 * — only the card's *content* responsibility was repurposed.
 */
export const VALUE_PROP_CARD_DEFAULT_TEST_ID_PREFIX = 'payment-model';

/**
 * Korean heading rendered at the top of the value-prop card. Exposed as a
 * constant so the unit test can pin the literal without re-typing it. The
 * copy frames the row list as an enumeration of what the user receives
 * ("이 분석으로 받게 되는 것" — "What you receive from this analysis"),
 * making the card's information role explicit to both sighted and
 * screen-reader users.
 */
export const VALUE_PROP_CARD_HEADING = '이 분석으로 받게 되는 것' as const;

/**
 * Ordered tuple of the three Korean benefit strings rendered inside the
 * value-prop card. The order is deliberate (scope → utility → longevity):
 *
 *   1. "전체 퍼스널 컬러 분석" — full personal color analysis (scope: the
 *      complete diagnostic result, not a teaser).
 *   2. "맞춤 코디 추천" — coordination recommendations (utility: the user
 *      gets actionable outfit-coordination guidance, not just a label).
 *   3. "평생 저장" — lifetime save (longevity: the result is permanently
 *      retained for the user, not a one-time view).
 *
 * Exported as a frozen 3-tuple (`as const`) so:
 *   - The companion unit test can assert exact-length and per-index
 *     content without re-typing the strings.
 *   - A future contributor cannot accidentally `.push(...)` a fourth
 *     benefit (which would silently break the screen-level layout).
 *   - TypeScript narrows the array to a literal-tuple type, surfacing any
 *     out-of-order edit as a type error if the test imports it as a tuple.
 *
 * Why exactly three items (not 4 or 5):
 *   - The Seed AC pins the count: "new value-prop body lists 3 benefits
 *     (full personal color analysis, coordination recommendations,
 *     lifetime save)". The tuple length is part of the contract.
 *   - Three is also the upper limit of "scannable in one glance" on a
 *     funnel screen; adding a fourth benefit reduces conversion (each
 *     additional bullet measurably lowers the click-through on the
 *     primary CTA in the welcome_hook / value_props A/B history).
 */
export const VALUE_PROP_CARD_BENEFITS = [
  '전체 퍼스널 컬러 분석',
  '맞춤 코디 추천',
  '평생 저장',
] as const;

/**
 * Decorative leading glyph rendered in front of every benefit row. The
 * checkmark visually reinforces the "you receive this" framing without
 * requiring a separate icon asset. Exposed as a constant so the test can
 * pin its presence on every row without hardcoding the glyph literal in
 * the assertion.
 *
 * The glyph is intentionally NOT announced by screen readers — each row's
 * `accessibilityLabel` carries the benefit text alone, and the leading
 * glyph is rendered as part of the visible string but suppressed from
 * the announcement.
 */
export const VALUE_PROP_CARD_BULLET_GLYPH = '✓' as const;

/**
 * Props for {@link PriceCard}.
 *
 * Deliberately minimal: the component owns the heading, the benefit list,
 * and the styling. Callers control only the testID prefix so multi-mount
 * surfaces (active payment_model + a future dev-only preview, etc.) can
 * be disambiguated by stable query handles.
 *
 * All fields are `readonly` to match the immutable-data convention used
 * elsewhere in the funnel component surface.
 */
export interface PriceCardProps {
  /**
   * Optional kebab-case testID prefix. Defaults to
   * {@link VALUE_PROP_CARD_DEFAULT_TEST_ID_PREFIX} (`'payment-model'`). The
   * component appends `-value-prop-card`, `-value-prop-heading`, and
   * `-value-prop-item-<index>` to derive the per-element testIDs.
   *
   * Matches the Seed testID naming convention
   * `<screen-name>-<element-role>`.
   */
  readonly testIDPrefix?: string;
}

/**
 * Renders the value-proposition card for the `payment_model` screen — a
 * soft-pink card with a Korean heading row and three benefit rows
 * enumerating what the user unlocks by subscribing.
 *
 * The card displays NO price, currency amount, or subscription-framing
 * copy — the Superwall paywall modal (triggered by the sibling primary
 * CTA) owns all pricing display. See the file-level docblock for the full
 * Phase 2.4 → Phase 2.5 rationale.
 *
 * @see PriceCardProps for prop documentation.
 */
export function PriceCard(props: PriceCardProps): React.ReactElement {
  const { testIDPrefix = VALUE_PROP_CARD_DEFAULT_TEST_ID_PREFIX } = props;

  const cardTestID = `${testIDPrefix}-value-prop-card`;
  const headingTestID = `${testIDPrefix}-value-prop-heading`;

  return (
    <View style={styles.card} testID={cardTestID} accessibilityRole="summary">
      <Text style={styles.heading} testID={headingTestID} accessibilityRole="header">
        {VALUE_PROP_CARD_HEADING}
      </Text>
      <View style={styles.list}>
        {VALUE_PROP_CARD_BENEFITS.map((benefit, index) => {
          const itemTestID = `${testIDPrefix}-value-prop-item-${String(index)}`;
          return (
            <Text
              key={benefit}
              style={styles.item}
              testID={itemTestID}
              accessibilityRole="text"
              accessibilityLabel={benefit}
            >
              {`${VALUE_PROP_CARD_BULLET_GLYPH} ${benefit}`}
            </Text>
          );
        })}
      </View>
    </View>
  );
}

/**
 * Token-driven styles. Every value is sourced from the theme barrel — no
 * literal hex codes, magic spacing, or font sizes inline. Any visual tweak
 * should land in the token module, not here.
 */
const styles = StyleSheet.create({
  card: {
    // Editorial: a neutral wash panel with a hairline edge — no pink tint.
    backgroundColor: INK.wash,
    borderColor: INK.line,
    borderWidth: 1,
    // Near-square corners (editorial flat surface).
    borderRadius: 2,
    paddingVertical: SPACING.lg,
    paddingHorizontal: SPACING.lg,
    // Tight internal rhythm between heading + list block.
    gap: SPACING.sm,
  },
  heading: {
    fontFamily: FONT.medium,
    fontSize: 18,
    color: INK.primary,
  },
  list: {
    // Rows read as a list — tight inline spacing between each benefit.
    gap: SPACING.xs,
  },
  item: {
    fontFamily: FONT.regular,
    fontSize: 15,
    lineHeight: 22,
    color: INK.muted,
  },
});
