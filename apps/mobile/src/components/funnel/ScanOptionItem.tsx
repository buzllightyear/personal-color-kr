/**
 * `ScanOptionItem` — single scan-option card for the Phase 2.3 step 6
 * (`scan_option_select`) screen.
 *
 * Sub-AC 3.2 extraction:
 *   The three option cards previously rendered inline inside
 *   `ScanOptionSelectScreen.tsx`'s `.map()` body. Pulling one card into its
 *   own leaf component:
 *     - Pins the enabled-vs-disabled visual rule (coral pill vs grayscale
 *       outline + "곧 오픈" badge) in a single tested location, so a future
 *       refactor cannot silently desynchronise the two states across the
 *       three call-sites.
 *     - Lets the unit test pin the disabled-card contract — non-pressable +
 *       "곧 오픈" badge — without spinning up the whole screen tree or the
 *       core-ts `FUNNEL_SCREENS` registry.
 *     - Gives any future surface that wants to render a single option (a
 *       dev-only preview, an analytics replay, an E2E asserter) a stable
 *       import that does not pull in the screen's headline + layout chrome.
 *
 * What this component IS:
 *   - A presentational shell over `react-native`'s `Pressable` that:
 *       (a) renders a Korean-language option label centred on the card;
 *       (b) selects the coral-fill enabled style when `option.enabled === true`
 *           and the grayscale-outline disabled style otherwise;
 *       (c) renders the "곧 오픈" badge only when the option is disabled —
 *           the affordance is unique to the secondary slot 2 / slot 3 cards;
 *       (d) wires `onPress` straight through when enabled and supplies
 *           `undefined` (combined with `disabled` on the Pressable) when
 *           disabled, so the parent never observes a press from a disabled
 *           card;
 *       (e) exposes per-card testIDs derived from `option.testIdSuffix` and
 *           a configurable `testIDPrefix` so the screen-level test can pin
 *           each option by stable handle.
 *
 * What this component is NOT:
 *   - A navigation router. `onPress` is the only outbound hook; the parent
 *     screen wires the primary card's `onPress` to
 *     `router.push('/(funnel)/diagnosis-input')`. The disabled cards never
 *     fire `onPress` so the parent does not even need to pass a callback for
 *     them (this leaf still requires the prop for type uniformity, but it is
 *     never invoked).
 *   - A configurable variant button. The Seed scope is the three
 *     `scan_option_select` cards only — `enabled` vs `disabled` is the only
 *     visual axis. A future variant (e.g. a "coming soon — register interest"
 *     enabled-disabled card) should build its own component rather than
 *     parameterising this one.
 *   - A source of Korean copy. The "곧 오픈" badge text is the one Korean
 *     literal that is owned by this component (the option label itself comes
 *     in via `option.label`, sourced from `FUNNEL_SCREENS.scan_option_select`
 *     by the `getScanOptions()` selector).
 *
 * Why a single shared component (not three per-option Pressables):
 *   - DRY across the three cards on step 6. The visual rhythm — pill, border,
 *     label typography, "곧 오픈" badge — is identical between primary and
 *     secondary cards; only the colour palette and the badge visibility flip.
 *   - The Seed extraction threshold ("2+ reuses with consistent visual
 *     semantics") is comfortably exceeded: three cards on a single screen.
 *
 * Why Pressable (not TouchableOpacity / Button):
 *   - `Pressable` is the modern RN API; `TouchableOpacity` is in maintenance
 *     mode. The platform `Button` cannot be styled consistently across iOS
 *     and Android.
 *
 * Disabled-card invariants (asserted by the companion unit test):
 *   - The Pressable receives `disabled={true}` (RN drops the press hit-target).
 *   - The Pressable receives `onPress={undefined}` (defence-in-depth — even if
 *     RN ever forwarded a press through the disabled Pressable in an edge
 *     case, the parent's callback is never wired up so it cannot fire).
 *   - The "곧 오픈" badge renders (per `option.enabled === false`).
 *   - `accessibilityState.disabled === true` so VoiceOver/TalkBack announces
 *     the card correctly.
 *
 * Enabled-card invariants (asserted by the companion unit test):
 *   - The Pressable receives `disabled={false}`.
 *   - The Pressable's `onPress` callback is the supplied `onPress` prop.
 *   - The "곧 오픈" badge does NOT render.
 *   - `accessibilityState.disabled === false`.
 *
 * Accessibility surface:
 *   - `accessibilityRole="button"` always.
 *   - `accessibilityLabel` is the option's Korean `label` so VoiceOver speaks
 *     the visible card text directly.
 *   - `accessibilityState={{ disabled }}` mirrors the option's enabled flag.
 *   - The "곧 오픈" badge is announced as part of the card's flow (no
 *     suppression) so screen-reader users learn the secondary cards are
 *     unavailable; this matches the visual affordance.
 *
 * Token-driven styling:
 *   - All colours, spacing, and typography come from `apps/mobile/src/theme`.
 *     No literal hex codes, magic spacing numbers, or font sizes — any
 *     visual tweak should land in the token module, not here.
 */
import * as React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ScanOption } from '../../funnel/scan-options';
import { COLORS, SPACING, TYPOGRAPHY } from '../../theme';

/**
 * Default testID prefix used when the caller does not supply one. Exported
 * as a constant so unit tests can refer to it by symbol rather than by
 * literal — any string drift between the component and the test would
 * otherwise be silently incompatible.
 */
export const SCAN_OPTION_ITEM_DEFAULT_TEST_ID_PREFIX = 'scan-option-select';

/**
 * The Korean "coming soon" badge text. Exposed as a constant so the unit
 * test can pin the affordance without re-typing the literal.
 */
export const SCAN_OPTION_ITEM_COMING_SOON_LABEL = '곧 오픈';

/**
 * Props for {@link ScanOptionItem}.
 *
 * `option` is the resolved {@link ScanOption} from the
 * `getScanOptions()` selector — it carries the Korean label, the enabled
 * flag, and the stable testID suffix. `onPress` is the press handler the
 * parent wants invoked when the user taps an *enabled* card; the leaf
 * intentionally never invokes the callback for a disabled card.
 *
 * All fields are `readonly` to match the immutable-data convention used by
 * the rest of the funnel surface.
 */
export interface ScanOptionItemProps {
  /** Resolved scan option (label, enabled flag, testID suffix). */
  readonly option: ScanOption;
  /**
   * Press handler. Invoked only when `option.enabled === true`. The leaf
   * still requires the prop for uniform typing across enabled and disabled
   * call-sites; disabled cards simply never invoke it.
   */
  readonly onPress: () => void;
  /**
   * Optional testID prefix. Defaults to
   * {@link SCAN_OPTION_ITEM_DEFAULT_TEST_ID_PREFIX} (`'scan-option-select'`)
   * so the screen mounting this leaf does not need to thread the prop — the
   * combined testID is `'<prefix>-option-<option.testIdSuffix>'`, matching
   * the test convention established by the screen-level test.
   */
  readonly testIDPrefix?: string;
}

/**
 * Renders one scan-option card for the `scan_option_select` screen.
 *
 * Enabled cards paint the coral pill, wire `onPress`, and omit the badge.
 * Disabled cards paint a grayscale outline, drop the press hit-target, and
 * render the "곧 오픈" badge.
 *
 * @see ScanOptionItemProps
 */
export function ScanOptionItem(
  props: ScanOptionItemProps,
): React.ReactElement {
  const {
    option,
    onPress,
    testIDPrefix = SCAN_OPTION_ITEM_DEFAULT_TEST_ID_PREFIX,
  } = props;

  const isEnabled = option.enabled;
  const cardTestID = `${testIDPrefix}-option-${option.testIdSuffix}`;
  const badgeTestID = `${testIDPrefix}-coming-soon-${option.testIdSuffix}`;

  return (
    <Pressable
      // Defence-in-depth: even though `disabled` on the Pressable already
      // removes the press hit-target, we additionally pass `undefined` for
      // `onPress` on a disabled card. React Native has had historical edge
      // cases where a press fires during the disabled transition; passing
      // no callback at all guarantees the parent never observes a press
      // from a disabled card.
      onPress={isEnabled ? onPress : undefined}
      disabled={!isEnabled}
      style={[
        styles.card,
        isEnabled ? styles.cardEnabled : styles.cardDisabled,
      ]}
      testID={cardTestID}
      accessibilityRole="button"
      accessibilityLabel={option.label}
      accessibilityState={{ disabled: !isEnabled }}
    >
      <Text
        style={[
          styles.label,
          isEnabled ? styles.labelEnabled : styles.labelDisabled,
        ]}
      >
        {option.label}
      </Text>
      {!isEnabled && (
        <View style={styles.comingSoonBadge} testID={badgeTestID}>
          <Text style={styles.comingSoonLabel}>
            {SCAN_OPTION_ITEM_COMING_SOON_LABEL}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

/**
 * Token-driven styles. Every value is sourced from the theme barrel — no
 * literal hex codes, magic spacing, or font sizes inline.
 */
const styles = StyleSheet.create({
  card: {
    // Generous vertical padding so the card reads as a tap target (44pt+
    // hit area on iOS) without the layout needing to manage per-screen
    // hit-slop deltas.
    paddingVertical: SPACING.lg,
    paddingHorizontal: SPACING.lg,
    borderRadius: SPACING.md,
    borderWidth: 1,
    // Flex row keeps the label and the optional "곧 오픈" badge on the
    // same baseline — the badge slots to the right of the label.
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
  },
  cardEnabled: {
    // Korean beauty market visual identity (coral fill) — matches the
    // primary CTA treatment used elsewhere in the funnel.
    backgroundColor: COLORS.base.coral,
    borderColor: COLORS.base.coral,
  },
  cardDisabled: {
    // Grayscale outline reads as "this card is not interactive" without
    // competing with the coral primary fill on the rest of the screen.
    backgroundColor: COLORS.grayscale.background,
    borderColor: COLORS.grayscale.border,
  },
  label: {
    ...TYPOGRAPHY.button.bold,
    // `flexShrink: 1` lets a long Korean label wrap rather than push the
    // badge off-screen.
    flexShrink: 1,
  },
  labelEnabled: {
    // White-on-coral yields AAA contrast for the primary card.
    color: COLORS.grayscale.background,
  },
  labelDisabled: {
    // Mid-gray text reinforces the "unavailable" affordance on disabled
    // cards.
    color: COLORS.grayscale.disabled,
  },
  comingSoonBadge: {
    paddingVertical: SPACING.xxs,
    paddingHorizontal: SPACING.sm,
    // Fully rounded pill — a stylistic constant rather than a token
    // (the spacing scale measures layout gaps, not corner radii).
    borderRadius: 999,
    backgroundColor: COLORS.grayscale.border,
  },
  comingSoonLabel: {
    ...TYPOGRAPHY.caption.regular,
    color: COLORS.grayscale.text,
  },
});
