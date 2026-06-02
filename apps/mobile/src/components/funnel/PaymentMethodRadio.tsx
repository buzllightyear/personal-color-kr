/**
 * `PaymentMethodRadio` — mutually-exclusive radio group for the two
 * placeholder payment methods (KakaoPay / Toss) rendered on the step-12
 * `payment_model` screen (Phase 2.4, KR variant, Sub-AC 7.2).
 *
 * Responsibility:
 *   Render exactly two radio options — `kakao` ("카카오페이") and `toss`
 *   ("토스") — and surface a single mutually-exclusive selection via a
 *   *controlled* `value` / `onChange` prop pair. The component owns no
 *   internal selection state; the parent screen reads
 *   `payment.selectedMethod` from `FunnelStateContext`, passes it in as
 *   `value`, and routes `onChange` calls to
 *   {@link import('../../contracts/funnel-state').SetSelectedPaymentMethod}
 *   on the provider.
 *
 *   The Korean labels are sourced from {@link PAYMENT_MODEL_METHOD_LABELS}
 *   in `apps/mobile/src/funnel/payment-model-ctas.ts` so the label surface
 *   stays in one isolated module — never duplicated as literal substrings
 *   inside the component or the screen.
 *
 * Why a dedicated component (not inlined into PaymentModelScreen):
 *   - Seed extraction threshold: "shared component extraction threshold:
 *     2+ reuses with consistent visual semantics". The radio pair will be
 *     mounted by both the active `payment_model` screen AND any future
 *     dev-only preview / analytics replay surface; pulling the visual into
 *     a leaf keeps the screen-level test isolated from the radio-toggling
 *     unit test.
 *   - Pins the mutually-exclusive contract in one tested location: a future
 *     refactor cannot silently let two options become co-selected.
 *   - Per the Seed evaluation principle `placeholder_discipline`, the two
 *     payment-method placeholders are isolated from real SDK wiring — this
 *     component renders the *UI shell* only; the parent's `onChange`
 *     handler stays a pure state-write and the actual KakaoPay / Toss SDK
 *     calls (deferred to Phase 2.5) are wired separately at the screen
 *     level.
 *
 * What this component IS:
 *   - A *controlled* radio group leaf that:
 *       (a) renders two Pressable options (one per `PaymentMethod` literal —
 *           `'kakao'` and `'toss'`), each carrying the Korean label sourced
 *           from {@link PAYMENT_MODEL_METHOD_LABELS};
 *       (b) paints the currently-selected option with the coral-fill +
 *           white-bold-label treatment (matching the Korean beauty market
 *           visual identity used by other funnel primary surfaces);
 *       (c) paints the unselected options with a grayscale outline + dark
 *           label (matching the {@link ScanOptionItem} disabled-card
 *           treatment so the visual rhythm stays consistent);
 *       (d) renders a small circular "radio dot" affordance on each option
 *           — filled when selected, hollow outline when not — so the
 *           mutually-exclusive selection is visually unambiguous even
 *           without the colour fill (defence-in-depth against partial
 *           colour-blindness);
 *       (e) on press of an option, invokes `onChange(option)` with the
 *           tapped `PaymentMethod` literal — never `null`. The radio group
 *           does NOT support deselect-via-tap; clearing the selection back
 *           to `null` is a parent-level concern routed through the
 *           dedicated {@link SetSelectedPaymentMethod} action;
 *       (f) when `value === null`, no option paints the selected style and
 *           no radio dot is filled — the parent's "no selection yet" state
 *           is faithfully represented;
 *       (g) when `disabled === true`, both options drop their press
 *           hit-target and paint a muted grayscale fill — used by the
 *           parent during the `isProcessing` in-flight placeholder so a
 *           user cannot change their selection mid-payment;
 *       (h) exposes stable testIDs for the group root and the two options
 *           (`<prefix>-method-radio-group`, `<prefix>-method-option-kakao`,
 *           `<prefix>-method-option-toss`) so the screen-level test can pin
 *           selection state and onChange wiring without re-implementing
 *           testID threading.
 *
 * What this component is NOT:
 *   - An uncontrolled radio group. The Seed constraint "isPremium is
 *     managed solely in FunnelStateProvider payment slice" applies
 *     symmetrically to `selectedMethod` — the source of truth lives in
 *     `payment.selectedMethod`, not inside this component. Holding
 *     selection state here would create a sync-divergence between the
 *     component's local state and the provider slice on every render.
 *   - A submitter. Tapping a radio option fires `onChange` only — no
 *     navigation, no payment SDK invocation. The parent screen's primary
 *     "결제하기" CTA is the submitter; this leaf is selection-only.
 *   - A source of Korean copy. The two labels come exclusively from
 *     {@link PAYMENT_MODEL_METHOD_LABELS}; no literal "카카오페이" or
 *     "토스" string appears in this file.
 *   - A consumer of `null` from a tap. The radio group only ever fires
 *     `onChange(method)` with a non-null `PaymentMethod`. The `value`
 *     prop accepts `null` for the "no selection yet" initial state, but
 *     the component never invokes `onChange(null)` itself — clearing is a
 *     parent-level concern.
 *
 * Token-driven styling:
 *   - Background of selected option: {@link COLORS.base.coral} (Korean
 *     beauty market visual identity — matches FunnelPrimaryButton).
 *   - Background of unselected option: {@link COLORS.grayscale.background}
 *     (pure white).
 *   - Border of unselected option: 1px {@link COLORS.grayscale.border}.
 *   - Border of selected option: 1px {@link COLORS.base.coral}.
 *   - Disabled fill (both options): {@link COLORS.grayscale.disabled} —
 *     mid-gray reads as "this control is not interactive" without
 *     competing with the coral primary fill on the rest of the screen.
 *   - Label colour selected: {@link COLORS.grayscale.background} (white).
 *   - Label colour unselected: {@link COLORS.grayscale.text} (near-black).
 *   - Border radius: 16 (matches the visual rhythm of the funnel's other
 *     pill / card surfaces; not a token because corner radii are
 *     stylistic constants, not layout rhythm dimensions).
 *   - Vertical padding: {@link SPACING.md} (16).
 *   - Horizontal padding: {@link SPACING.lg} (24).
 *   - Internal gap (between radio dot + label): {@link SPACING.sm} (12).
 *   - External gap (between the two options): {@link SPACING.sm} (12).
 *   - Radio-dot size: 20 (stylistic constant — a fixed visual affordance
 *     diameter, not a layout rhythm dimension).
 *   - Label typography: {@link TYPOGRAPHY.button.bold} (16pt/700) —
 *     matches FunnelPrimaryButton so the radio labels carry the same
 *     visual weight as the primary CTA below them.
 *
 * Accessibility surface:
 *   - Group root: `accessibilityRole="radiogroup"` so VoiceOver / TalkBack
 *     announces the surface as a radio group rather than a generic view.
 *   - Each option: `accessibilityRole="radio"` (the platform-correct role
 *     for a radio option, with `accessibilityState.selected` carrying the
 *     selection flag and `accessibilityState.disabled` carrying the
 *     disabled flag).
 *   - `accessibilityLabel` on each option is the Korean label so the
 *     spoken label reads identically to the visible Korean text.
 *
 * Why no prop surface for the option set (other than `value` / `onChange`
 * / `disabled` / `testIDPrefix`):
 *   The Seed constraint pins the supported payment methods as exactly two
 *   placeholders (`kakao`, `toss`) — see the {@link PaymentMethod} union
 *   in `src/contracts/funnel-state.ts`. Letting a caller inject a custom
 *   option list would bypass that closed union and let a future screen
 *   accidentally render an unsupported method. The component iterates the
 *   {@link PAYMENT_MODEL_METHOD_LABELS} map directly so any future
 *   widening of the union becomes a TypeScript error here until the
 *   matching Korean label is added — the same compile-time-coupling
 *   pattern used by `PAYMENT_MODEL_METHOD_LABELS` itself.
 */
import * as React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { PaymentMethod } from '../../contracts/funnel-state';
import { PAYMENT_MODEL_METHOD_LABELS } from '../../funnel/payment-model-ctas';
import { COLORS, SPACING, TYPOGRAPHY } from '../../theme';

/**
 * Default testID prefix used when the caller does not supply one. Exported
 * as a constant so unit tests and call-sites that want a stable handle
 * can refer to it by symbol — any drift between the component and the
 * test would otherwise be silently incompatible.
 */
export const PAYMENT_METHOD_RADIO_DEFAULT_TEST_ID_PREFIX = 'payment-model';

/**
 * Closed ordered list of the two `PaymentMethod` literals the radio group
 * renders. Pinned as a `readonly` tuple of literals so a future widening
 * of {@link PaymentMethod} becomes a TypeScript error here until the new
 * literal is added in a deliberate edit. Matching the
 * {@link PAYMENT_MODEL_METHOD_LABELS} key set keeps the visual surface
 * structurally coupled to the label map.
 *
 * The order — `kakao` first, then `toss` — matches the Korean market
 * convention (KakaoPay has higher mind-share than Toss in the
 * micro-payment segment) and is consistent across the screen-level
 * tests + analytics placeholders.
 */
export const PAYMENT_METHOD_RADIO_OPTIONS: readonly PaymentMethod[] = [
  'kakao',
  'toss',
] as const;

/**
 * Props for {@link PaymentMethodRadio}.
 *
 * The component is fully *controlled* — the parent owns the selection
 * state via `value`, and `onChange` notifies the parent of a tap. The
 * radio group never holds local state.
 *
 * All fields are `readonly` to match the immutable-data convention used
 * elsewhere in the funnel component surface.
 */
export interface PaymentMethodRadioProps {
  /**
   * Currently-selected payment method, or `null` when no method has been
   * selected yet. Sourced from `payment.selectedMethod` on
   * `FunnelStateContext`.
   *
   * When `null`, no option paints the selected style and no radio dot is
   * filled.
   */
  readonly value: PaymentMethod | null;
  /**
   * Notifies the parent of a tap on one of the two radio options. The
   * radio group never invokes `onChange(null)` itself — clearing the
   * selection back to `null` is a parent-level concern routed through
   * {@link import('../../contracts/funnel-state').SetSelectedPaymentMethod}.
   *
   * Tapping the *currently-selected* option is a no-op visually (no
   * deselect-via-tap on a radio group) but the callback is still
   * invoked with the same `PaymentMethod` so the parent can re-affirm
   * its state if needed.
   */
  readonly onChange: (method: PaymentMethod) => void;
  /**
   * When `true`, both options drop their press hit-target and paint a
   * muted grayscale fill. Used by the parent during the `isProcessing`
   * in-flight placeholder so a user cannot change their selection
   * mid-payment.
   *
   * Defaults to `false`.
   */
  readonly disabled?: boolean;
  /**
   * Optional kebab-case testID prefix. Defaults to
   * {@link PAYMENT_METHOD_RADIO_DEFAULT_TEST_ID_PREFIX} (`'payment-model'`).
   * The component appends `-method-radio-group` to derive the group root
   * testID and `-method-option-<method>` to derive each option's testID
   * (e.g. `'payment-model-method-option-kakao'`).
   *
   * Matches the Seed testID naming convention
   * `<screen-name>-<element-role>-<discriminator>`.
   */
  readonly testIDPrefix?: string;
}

/**
 * Renders the mutually-exclusive KakaoPay / Toss radio group for the
 * payment_model screen. Fully controlled via `value` / `onChange`.
 *
 * Mutually-exclusive contract:
 *   At most one option paints the selected style at any time. When
 *   `value === null`, zero options are selected. When `value === 'kakao'`
 *   or `value === 'toss'`, exactly one option is selected. Tapping an
 *   unselected option fires `onChange(method)` with the tapped method;
 *   tapping the selected option fires `onChange(method)` with the same
 *   method (no-op visually, parent decides whether to re-affirm state).
 *
 * @see PaymentMethodRadioProps for prop documentation.
 */
export function PaymentMethodRadio(props: PaymentMethodRadioProps): React.ReactElement {
  const {
    value,
    onChange,
    disabled = false,
    testIDPrefix = PAYMENT_METHOD_RADIO_DEFAULT_TEST_ID_PREFIX,
  } = props;

  const groupTestID = `${testIDPrefix}-method-radio-group`;

  return (
    <View style={styles.group} testID={groupTestID} accessibilityRole="radiogroup">
      {PAYMENT_METHOD_RADIO_OPTIONS.map((method) => {
        const selected = value === method;
        const optionTestID = `${testIDPrefix}-method-option-${method}`;
        const dotTestID = `${testIDPrefix}-method-dot-${method}`;
        const label = PAYMENT_MODEL_METHOD_LABELS[method];

        // Defence-in-depth: even though `disabled` on the Pressable
        // already removes the press hit-target, we additionally pass
        // `undefined` for `onPress` on a disabled option. React Native
        // has historical edge cases where a press fires during the
        // disabled transition; passing no callback at all guarantees
        // the parent never observes a press from a disabled option.
        const handlePress = disabled ? undefined : (): void => onChange(method);

        const optionStyle = [
          styles.option,
          selected ? styles.optionSelected : styles.optionUnselected,
          disabled && styles.optionDisabled,
        ];
        const labelStyle = [
          styles.label,
          selected ? styles.labelSelected : styles.labelUnselected,
          disabled && styles.labelDisabled,
        ];
        const dotStyle = [
          styles.dot,
          selected ? styles.dotSelected : styles.dotUnselected,
          disabled && styles.dotDisabled,
        ];

        return (
          <Pressable
            key={method}
            onPress={handlePress}
            disabled={disabled}
            style={optionStyle}
            testID={optionTestID}
            accessibilityRole="radio"
            accessibilityLabel={label}
            accessibilityState={{ selected, disabled }}
          >
            <View style={dotStyle} testID={dotTestID}>
              {selected && <View style={styles.dotInner} />}
            </View>
            <Text style={labelStyle}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Token-driven styles. Every value is sourced from the theme barrel — no
 * literal hex codes, magic spacing, or font sizes inline. Any visual
 * tweak should land in the token module, not here.
 */
const styles = StyleSheet.create({
  group: {
    // Vertical stack of the two options with a tight rhythm between them.
    // `flexDirection: 'column'` is the default; we still set it explicitly
    // so the layout intent is documented at the call-site.
    flexDirection: 'column',
    gap: SPACING.sm,
  },
  option: {
    // Flex row keeps the radio dot and the label on the same baseline —
    // the dot slots to the left of the label with a tight gap between
    // them.
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderRadius: 16,
    borderWidth: 1,
  },
  optionSelected: {
    backgroundColor: COLORS.base.coral,
    borderColor: COLORS.base.coral,
  },
  optionUnselected: {
    backgroundColor: COLORS.grayscale.background,
    borderColor: COLORS.grayscale.border,
  },
  optionDisabled: {
    // Disabled fill — mid-gray reads as "this control is not interactive"
    // without competing with the coral primary fill on the rest of the
    // screen. Painted last in the style stack so it overrides both the
    // selected and unselected fills.
    backgroundColor: COLORS.grayscale.disabled,
    borderColor: COLORS.grayscale.disabled,
  },
  label: {
    // 16pt/700 button typography token — matches FunnelPrimaryButton so
    // the radio labels carry the same visual weight as the primary CTA
    // below them.
    ...TYPOGRAPHY.button.bold,
    // `flexShrink: 1` lets a long Korean label wrap rather than push the
    // radio dot off-screen.
    flexShrink: 1,
  },
  labelSelected: {
    // White-on-coral yields AAA contrast for the selected option.
    color: COLORS.grayscale.background,
  },
  labelUnselected: {
    // Near-black on white for unselected options — high contrast on the
    // pure-white card fill.
    color: COLORS.grayscale.text,
  },
  labelDisabled: {
    // Pure white on mid-gray reads as "this label is muted" while
    // remaining legible.
    color: COLORS.grayscale.background,
  },
  dot: {
    // Fixed 20pt diameter circle — a stylistic constant, not a token
    // (the spacing scale measures layout gaps, not affordance
    // diameters).
    width: 20,
    height: 20,
    borderRadius: 999,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotSelected: {
    // White hollow ring on the coral fill — provides a colour-blind
    // safe affordance independent of the fill colour.
    borderColor: COLORS.grayscale.background,
    backgroundColor: COLORS.base.coral,
  },
  dotUnselected: {
    // Gray hollow ring on white — matches the unselected option border.
    borderColor: COLORS.grayscale.border,
    backgroundColor: COLORS.grayscale.background,
  },
  dotDisabled: {
    // White hollow ring on the muted gray fill.
    borderColor: COLORS.grayscale.background,
    backgroundColor: COLORS.grayscale.disabled,
  },
  dotInner: {
    // 10pt filled inner circle — half the dot diameter, centred inside
    // the dot ring. White on coral matches the selected option's text.
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: COLORS.grayscale.background,
  },
});
