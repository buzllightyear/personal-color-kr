/**
 * `PriceCard` — shared price display card for the step-12 `payment_model`
 * screen (Phase 2.4, KR variant, Sub-AC 7.1).
 *
 * Responsibility:
 *   Render the hardcoded one-time premium-unlock amount
 *   ({@link PAYMENT_AMOUNT_KRW}) as a prominent, locale-formatted Korean
 *   currency line ("₩9,900" — with the ₩ symbol and thousands-separator
 *   grouping driven by `Intl.NumberFormat('ko-KR')`).
 *
 *   The component reads the formatted price string from
 *   {@link formatPaymentAmountKrw} (re-exported by
 *   `apps/mobile/src/funnel/payment-model-ctas.ts`) so the price stays in
 *   exact sync with the constant — no duplicated string literals, no hand-
 *   stitched "₩" prefix, no drift between the price-card display and the
 *   primary unlock CTA label (which composes the same formatter via
 *   {@link formatUnlockCtaLabel}).
 *
 * Why a dedicated component (not inlined into PaymentModelScreen):
 *   - Seed extraction threshold: "shared component extraction threshold: 2+
 *     reuses with consistent visual semantics". The price line will be
 *     mounted by both the active payment_model screen AND any later analytics
 *     replay / dev-only preview surface; pulling the visual into a leaf keeps
 *     the screen-level test isolated from the price-formatting unit test.
 *   - Pins the visual contract in one location: ₩ symbol prefix, thousands
 *     grouping, large/bold typographic emphasis (subhead.bold), and a small
 *     "1회 결제 · 평생 이용" caption row clarifying the one-time-unlock
 *     framing (Seed constraint: "single one-time unlock only — no
 *     subscription model, price tiers, discount codes, or free trials").
 *   - Per the Seed evaluation principle "placeholder_discipline", the
 *     hardcoded ₩9,900 must never appear as a string literal inside any
 *     screen component — it must always flow through
 *     {@link PAYMENT_AMOUNT_KRW} + {@link formatPaymentAmountKrw}.
 *
 * What this component IS:
 *   - A pure presentational leaf that:
 *       (a) reads {@link formatPaymentAmountKrw} at render time and shows the
 *           result inside a `<Text>` host (₩ symbol + thousands-grouped
 *           digits — e.g. "₩9,900");
 *       (b) renders a small caption row underneath clarifying the one-time
 *           framing ("1회 결제 · 평생 이용");
 *       (c) exposes stable testIDs for the root card
 *           (`<prefix>-price-card`), the price text node
 *           (`<prefix>-price-amount`), and the caption text node
 *           (`<prefix>-price-caption`) so the screen-level test can pin the
 *           display without re-implementing testID threading.
 *
 * What this component is NOT:
 *   - A pressable. The card is display-only; the user interacts with the
 *     sibling radio group + primary CTA, not the price card itself.
 *   - A source of Korean copy beyond the one-time caption ("1회 결제 ·
 *     평생 이용"). The price string itself comes from the formatter — never
 *     embedded as a literal here.
 *   - A consumer of the {@link PAYMENT_AMOUNT_KRW} raw number. Reading the
 *     raw integer and stitching it onto "₩" by hand would bypass the
 *     `Intl.NumberFormat('ko-KR')` grouping contract; we always call the
 *     formatter so a future locale tweak (e.g. switching the grouping
 *     separator) lands in exactly one file.
 *
 * Token-driven styling:
 *   - Background: {@link COLORS.base.pink} — the soft pink surface tint
 *     matches the Korean beauty market visual identity (welcome_hook +
 *     value_props use the same family). Using a tinted surface (not white)
 *     gives the price line visual weight without competing with the coral
 *     primary CTA below.
 *   - Border: 1px {@link COLORS.base.blush} — a slightly deeper blush picks
 *     out the card edge against the soft-pink fill without introducing a
 *     neutral gray that would clash with the Korean beauty palette.
 *   - Border radius: 16 (matches the visual rhythm of the funnel's other
 *     pill / card surfaces; not a token because corner radii are stylistic
 *     constants, not layout rhythm dimensions).
 *   - Vertical padding: {@link SPACING.lg} (24); horizontal padding:
 *     {@link SPACING.lg}.
 *   - Internal rhythm between price + caption: {@link SPACING.xxs} (4) — the
 *     caption sits directly under the price as a closely-related secondary
 *     line.
 *   - Price typography: {@link TYPOGRAPHY.headline.bold} (28pt/700) — large
 *     enough that the price reads as the visual anchor of the screen, small
 *     enough that the long form ("₩9,900") fits on a 4-inch+ device without
 *     wrapping. Colour: {@link COLORS.grayscale.text} (near-black) for
 *     maximum AAA contrast on the soft pink fill.
 *   - Caption typography: {@link TYPOGRAPHY.caption.regular} (12pt/400).
 *     Colour: {@link COLORS.grayscale.text} (same near-black — the soft pink
 *     fill provides sufficient hierarchy contrast).
 *
 * Accessibility surface:
 *   - The price `<Text>` carries `accessibilityRole="text"` (default for
 *     `<Text>`, made explicit here for screen-reader clarity).
 *   - `accessibilityLabel` on the price node is the same formatted string,
 *     so VoiceOver/TalkBack announces "₩9,900" verbatim — no synthesised
 *     "nine thousand nine hundred won" gloss (the platforms localise the
 *     currency reading themselves).
 *   - The caption `<Text>` has no synthesised accessibility label — its
 *     visible Korean copy ("1회 결제 · 평생 이용") IS the announcement.
 *
 * Why no prop surface (other than `testIDPrefix`):
 *   - The Seed constraint pins the price as a hardcoded constant; allowing
 *     callers to inject a `price` prop would bypass that contract and let a
 *     future screen accidentally render the wrong amount.
 *   - Symmetric to {@link FunnelPrimaryButton}'s testID-only props
 *     surface: the component owns its visual contract; callers control only
 *     the testID prefix for query disambiguation across multi-mount surfaces.
 */
import * as React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  formatPaymentAmountKrw,
  PAYMENT_AMOUNT_KRW,
} from '../../funnel/payment-model-ctas';
import { COLORS, SPACING, TYPOGRAPHY } from '../../theme';

/**
 * Default testID prefix used when the caller does not supply one. Exported
 * as a constant so unit tests and call-sites that want a stable handle can
 * refer to it by symbol — any drift between the component and the test
 * would otherwise be silently incompatible.
 */
export const PRICE_CARD_DEFAULT_TEST_ID_PREFIX = 'payment-model';

/**
 * Korean caption clarifying the one-time-unlock framing of the displayed
 * price. Exposed as a constant so the unit test can pin the literal
 * without re-typing it. Per the Seed constraint
 * ("single one-time unlock only — no subscription model, price tiers,
 * discount codes, or free trials") this string makes the framing visually
 * unambiguous and prevents a future "starting from / per month" gloss
 * leaking onto the price line.
 */
export const PRICE_CARD_ONE_TIME_CAPTION = '1회 결제 · 평생 이용' as const;

/**
 * Props for {@link PriceCard}.
 *
 * Deliberately minimal: the component owns the price itself (via the
 * isolated `payment-model-ctas` selector), the caption, and the styling.
 * Callers control only the testID prefix so multi-mount surfaces (active
 * payment_model + a future dev-only preview, etc.) can be disambiguated by
 * stable query handles.
 *
 * All fields are `readonly` to match the immutable-data convention used
 * elsewhere in the funnel component surface.
 */
export interface PriceCardProps {
  /**
   * Optional kebab-case testID prefix. Defaults to
   * {@link PRICE_CARD_DEFAULT_TEST_ID_PREFIX} (`'payment-model'`). The
   * component appends `-price-card`, `-price-amount`, and `-price-caption`
   * to derive the per-element testIDs.
   *
   * Matches the Seed testID naming convention
   * `<screen-name>-<element-role>`.
   */
  readonly testIDPrefix?: string;
}

/**
 * Renders the hardcoded one-time premium-unlock price as a soft-pink card
 * with a large bold price line ("₩9,900") and a small one-time-unlock
 * caption ("1회 결제 · 평생 이용").
 *
 * The price string is read from {@link formatPaymentAmountKrw} so any
 * future change to {@link PAYMENT_AMOUNT_KRW} or the locale formatter
 * automatically propagates here — no duplicated literals.
 *
 * @see PriceCardProps for prop documentation.
 */
export function PriceCard(props: PriceCardProps): React.ReactElement {
  const { testIDPrefix = PRICE_CARD_DEFAULT_TEST_ID_PREFIX } = props;

  const cardTestID = `${testIDPrefix}-price-card`;
  const amountTestID = `${testIDPrefix}-price-amount`;
  const captionTestID = `${testIDPrefix}-price-caption`;

  // Read the formatted price at render time so the component never holds a
  // stale string from a previous render. The formatter is pure and cheap
  // (one `Intl.NumberFormat` call) so there is no need to memoise.
  const formattedAmount = formatPaymentAmountKrw();

  return (
    <View style={styles.card} testID={cardTestID}>
      <Text
        style={styles.amount}
        testID={amountTestID}
        accessibilityRole="text"
        accessibilityLabel={formattedAmount}
      >
        {formattedAmount}
      </Text>
      <Text style={styles.caption} testID={captionTestID}>
        {PRICE_CARD_ONE_TIME_CAPTION}
      </Text>
    </View>
  );
}

/**
 * Re-export the underlying price constant so screens that need to log a
 * placeholder analytics event ("price_displayed_krw") can read the raw
 * number from the same import-site as the visual component. Keeping the
 * re-export local (rather than forcing screens to deep-import
 * `funnel/payment-model-ctas`) reduces cross-module coupling at the
 * call-site without duplicating the integer literal.
 */
export { PAYMENT_AMOUNT_KRW };

/**
 * Token-driven styles. Every value is sourced from the theme barrel — no
 * literal hex codes, magic spacing, or font sizes inline. Any visual tweak
 * should land in the token module, not here.
 */
const styles = StyleSheet.create({
  card: {
    // Soft pink surface tint — Korean beauty market visual identity.
    backgroundColor: COLORS.base.pink,
    // Slightly deeper blush picks out the card edge against the soft-pink
    // fill without introducing a neutral gray that would clash with the
    // Korean beauty palette.
    borderColor: COLORS.base.blush,
    borderWidth: 1,
    // 16px rounded corners — stylistic constant, not a token (the spacing
    // scale measures layout gaps, not corner radii).
    borderRadius: 16,
    paddingVertical: SPACING.lg,
    paddingHorizontal: SPACING.lg,
    // Centre the price + caption horizontally within the card; the parent
    // layout controls the card's outer width / alignment.
    alignItems: 'center',
    justifyContent: 'center',
    // Tight internal rhythm between the price and the caption — the caption
    // reads as a secondary annotation directly beneath the price.
    gap: SPACING.xxs,
  },
  amount: {
    // Headline-bold typography token — the price is the visual anchor of
    // the payment_model screen.
    ...TYPOGRAPHY.headline.bold,
    color: COLORS.grayscale.text,
    textAlign: 'center',
  },
  caption: {
    ...TYPOGRAPHY.caption.regular,
    color: COLORS.grayscale.text,
    textAlign: 'center',
  },
});
