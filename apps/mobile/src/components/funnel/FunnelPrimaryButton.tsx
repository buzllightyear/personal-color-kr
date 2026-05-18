/**
 * `FunnelPrimaryButton` — shared primary CTA button for the personal-color-kr
 * funnel screens (Phase 2.3, steps 1–5 in MVP).
 *
 * Single visual surface for every "primary CTA" rendered by the funnel
 * screens — welcome_hook's hero "시작하기" button, value_props' "다음" button,
 * onboarding_priming's "다음" submit button, rating_gate's "별점 남기기"
 * button, and any later step that consumes a primary CTA. Centralising
 * the look-and-feel here means every funnel screen's primary action reads
 * with the same coral-fill, white-bold-label, rounded-corner rhythm; a
 * design update lands in exactly one file.
 *
 * What this component IS:
 *   - A presentational shell over `react-native`'s `Pressable` that:
 *       (a) renders a Korean-language `label` centered on a coral fill;
 *       (b) wires `onPress` straight through (no debounce / no async);
 *       (c) honours a `disabled` prop by swapping the fill to the grayscale
 *           disabled token and dropping the pressable's hit-target;
 *       (d) exposes a stable `testID` (default `funnel-primary-button`) so
 *           unit tests can pin the button without re-implementing testID
 *           threading at every call-site;
 *       (e) wires `accessibilityRole="button"` always, plus an
 *           `accessibilityLabel` (defaults to `label` when not supplied) and
 *           an `accessibilityState.disabled` flag mirroring `disabled`.
 *
 * What this component is NOT:
 *   - A navigation router. `onPress` is the only outbound hook; the parent
 *     screen wires it to `router.push('/(funnel)/<next-kebab>')` (or to a
 *     context setter on onboarding_priming, etc.). Direct calls only —
 *     no central funnel controller (Seed constraint).
 *   - A multi-variant button. The Seed scope is "primary CTA across all
 *     CTA screens" only. The funnel's `secondary`, `tertiary`, and
 *     `dismiss` CTA variants from `core-ts/funnel/screens.ts` live in
 *     separate components if/when a screen requires them (rating-gate's
 *     "나중에" dismiss button is the only Phase 2.3 case, and it's a system
 *     modal/native button — not a custom Pressable).
 *   - A form submitter. No internal state, no validation, no async loading
 *     spinner. The button is a pure pressable; if a screen needs to show a
 *     loading state, it gates the button with `disabled` and renders an
 *     `ActivityIndicator` elsewhere.
 *
 * Why a single shared component (not per-screen Pressable definitions):
 *   - DRY across the five Phase 2.3 funnel screens with a primary CTA.
 *   - Pins the consistent coral fill + white bold label + rounded pill +
 *     SPACING token rhythm in one tested location. The Seed evaluation
 *     principle `codebase_pattern_consistency` explicitly calls out
 *     "shared funnel components" as a goal.
 *   - The Seed extraction threshold ("2+ reuses with consistent visual
 *     semantics") is comfortably exceeded — every funnel screen has at
 *     least one primary CTA.
 *
 * Why Pressable (not TouchableOpacity / Button):
 *   - `Pressable` is the modern RN API; `TouchableOpacity` is in maintenance
 *     mode. `Button` is the wrong API — it renders the platform's native
 *     button which we cannot style consistently across iOS and Android.
 *   - `Pressable` accepts a function-form `style` prop so we can branch on
 *     `pressed` state for a subtle press feedback (opacity dip) without
 *     pulling in `react-native-reanimated` (Seed constraint forbids
 *     animation libraries).
 *
 * Styling contract (all values pulled from design tokens):
 *   - Background: `COLORS.base.coral` when enabled, `COLORS.grayscale.disabled`
 *     when disabled. Coral is the Korean beauty market visual identity per
 *     `colors.ts`'s docblock.
 *   - Label: `COLORS.grayscale.background` (pure white) so coral contrast
 *     stays AAA in both states, with `TYPOGRAPHY.button.bold` (16pt/700)
 *     which matches the Korean text density calibration in `typography.ts`.
 *   - Padding: `SPACING.md` (16) vertical, `SPACING.xl` (32) horizontal —
 *     the t-shirt scale's "default content gap" + "major section gap"
 *     yield a 16×32 pill that fits cleanly on a 4-inch+ phone width.
 *   - Border radius: 999 (fully rounded pill). Not a token because the
 *     spacing scale measures *layout gaps*, not *corner radii*; pill
 *     corners are a stylistic constant, not a design rhythm dimension.
 *   - Press feedback: opacity drops to 0.7 while pressed. No scale/Reanimated.
 *
 * Accessibility contract:
 *   - `accessibilityRole="button"` always (screen readers announce as
 *     "button" rather than the generic "view").
 *   - `accessibilityLabel` defaults to `label` when the caller does not
 *     supply one — Korean copy on the button surface reads identically as
 *     the spoken label, which is the desired default for VoiceOver/TalkBack.
 *   - `accessibilityState={{ disabled }}` mirrors the `disabled` prop so
 *     screen readers correctly announce a disabled CTA.
 *   - No icon-only buttons — every CTA is a Korean label that the screen
 *     reader can pronounce, so we do not need a separate `accessibilityHint`
 *     in MVP.
 *
 * testID contract:
 *   - The wrapper Pressable receives the caller-supplied `testID`, or
 *     defaults to `'funnel-primary-button'` if omitted. Per the Seed naming
 *     convention, callers SHOULD supply a screen-scoped testID like
 *     `welcome-hook-cta` so multiple primary buttons across a screen tree
 *     remain individually addressable.
 *
 * Out of scope (deferred):
 *   - Loading spinner inside the button (Phase 3 — payment-model needs a
 *     spinner while the IAP receipt validates).
 *   - Icon support (no icon packages allowed in MVP — see Seed constraint).
 *   - Multi-line labels (the Phase 2.3 CTAs are all single-line; if a future
 *     screen needs wrap, add `numberOfLines={2}` to the Text node).
 */
import * as React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  type GestureResponderEvent,
  type PressableStateCallbackType,
} from 'react-native';

import { COLORS, SPACING, TYPOGRAPHY } from '../../theme';

/**
 * Default testID used when the caller does not supply one. Exported as a
 * constant so unit tests and callers that want a stable handle can refer
 * to it by name rather than the raw string literal.
 */
export const FUNNEL_PRIMARY_BUTTON_DEFAULT_TEST_ID = 'funnel-primary-button';

/**
 * Props for {@link FunnelPrimaryButton}.
 *
 * All fields are `readonly` to align with the immutable-data convention
 * used elsewhere in the funnel surface (FunnelStateValue, FunnelPlaceholder
 * props, …). `disabled`, `testID`, and `accessibilityLabel` are optional;
 * the rest are required.
 */
export interface FunnelPrimaryButtonProps {
  /** Korean CTA label rendered on the button surface (e.g. `'시작하기'`). */
  readonly label: string;
  /**
   * Press handler. Parent screen wires this to `router.push(...)` or a
   * context setter; the button itself performs no navigation.
   */
  readonly onPress: () => void;
  /**
   * When `true`, the button paints the disabled fill, ignores presses, and
   * sets `accessibilityState.disabled`. Defaults to `false`.
   */
  readonly disabled?: boolean;
  /**
   * Optional stable testID. Defaults to
   * {@link FUNNEL_PRIMARY_BUTTON_DEFAULT_TEST_ID}. Callers SHOULD pass a
   * screen-scoped value like `'welcome-hook-cta'` for individual addressing.
   */
  readonly testID?: string;
  /**
   * Optional accessibility label. Defaults to `label` when omitted — the
   * spoken label reads identically to the visible Korean text, which is the
   * desired default for VoiceOver/TalkBack.
   */
  readonly accessibilityLabel?: string;
}

/**
 * Shared primary CTA button for the personal-color-kr funnel screens.
 *
 * Renders a Korean-language label centered on a coral pill. Honours
 * `disabled` (swaps fill, drops hit target, mirrors a11y state) and
 * `testID` (defaults to a stable sentinel). Press feedback is a subtle
 * opacity dip via the `Pressable` state-callback `style` form — no
 * animation libraries.
 *
 * @see FunnelPrimaryButtonProps
 */
export function FunnelPrimaryButton(
  props: FunnelPrimaryButtonProps,
): React.ReactElement {
  const {
    label,
    onPress,
    disabled = false,
    testID = FUNNEL_PRIMARY_BUTTON_DEFAULT_TEST_ID,
    accessibilityLabel,
  } = props;

  // Guard: even though `disabled` already removes the Pressable's hit
  // target via the `disabled` prop on Pressable, we additionally swallow
  // any `onPress` invocation here as defence-in-depth. React Native's
  // platform Pressable implementations have historically had edge cases
  // where a press fires during the disabled transition; this guarantees
  // the parent screen never sees a press while `disabled === true`.
  const handlePress = React.useCallback(
    (_event: GestureResponderEvent): void => {
      if (disabled) return;
      onPress();
    },
    [disabled, onPress],
  );

  // Function-form `style` so we can dip the opacity on press without
  // pulling in an animation library. The `pressed` flag comes from
  // `Pressable`'s state callback; we ignore it entirely when disabled
  // (the disabled fill is fixed, no press feedback wanted there).
  const buttonStyle = React.useCallback(
    (state: PressableStateCallbackType) => {
      if (disabled) return [styles.button, styles.buttonDisabled];
      if (state.pressed) return [styles.button, styles.buttonPressed];
      return styles.button;
    },
    [disabled],
  );

  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled}
      style={buttonStyle}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
    >
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    // Token-driven padding for a 16×32 pill that fits cleanly on a
    // 4-inch+ phone width with comfortable hit-target margins.
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.xl,
    // Fully rounded pill. Not a token — corner radii are a stylistic
    // constant, not a design rhythm dimension (the spacing scale measures
    // layout gaps).
    borderRadius: 999,
    // Korean beauty market visual identity (see colors.ts docblock).
    backgroundColor: COLORS.base.coral,
    // Center the label horizontally within the pill — the parent layout
    // controls the button's outer width / alignment.
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: {
    // Subtle press feedback without an animation library. 0.7 is the
    // canonical RN "pressed" opacity used by the deprecated
    // TouchableOpacity — we preserve that visual intuition.
    opacity: 0.7,
  },
  buttonDisabled: {
    // Disabled fill — mid-gray reads as "this button is not interactive"
    // without competing with the coral primary fill on the rest of the
    // screen. Opacity is left at 1.0; the gray fill alone communicates
    // the state.
    backgroundColor: COLORS.grayscale.disabled,
  },
  label: {
    // 16pt/700 button typography token — matches Korean text density
    // calibration in typography.ts. Spread the token first so any local
    // overrides (color) win.
    ...TYPOGRAPHY.button.bold,
    // Pure white on coral yields AAA contrast on both enabled and
    // disabled fills.
    color: COLORS.grayscale.background,
    // Center the label inside the row in case the button stretches
    // horizontally beyond the label's intrinsic width.
    textAlign: 'center',
  },
});
