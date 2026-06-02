/**
 * `SelfieUploadPressable` — extracted, reusable capture-surface component for
 * Phase 2.3 funnel step 7 (`diagnosis_input`) — Sub-AC 5.2.
 *
 * What this component IS:
 *   A leaf `Pressable` that renders an oval "selfie capture" affordance and,
 *   on each tap, generates a fresh `stub://selfie/<timestamp>` URI and hands
 *   it to the parent through the `onCapture` callback. The component is
 *   purely presentational — it owns *no* state; the captured-vs-idle visual
 *   branch is driven by a `selfieUri` prop the parent passes back in after
 *   it writes the URI into context (the canonical "controlled component"
 *   shape, matching every other presentational element in the funnel).
 *
 * Why a dedicated component module (vs the inline `Pressable` in
 * DiagnosisInputScreen):
 *   - Sub-AC 5.2 explicitly requires a *component module* — a reusable unit
 *     with its own props surface, its own testID sentinel, and its own unit
 *     test that simulates a press event and asserts `onCapture` receives a
 *     stub URI string. The previously inline `Pressable` only tested at the
 *     screen level; this Sub-AC pins the capture contract at the component
 *     level so a future screen (e.g. a Phase-3 re-capture confirmation
 *     screen) can reuse the exact same surface without duplicating the
 *     stub-URI builder or the visual treatment.
 *   - DRY: the stub-URI builder, the oval styling, the accessibility wiring,
 *     and the captured-state visual swap are now declared once. If/when the
 *     Phase 3.1 `expo-image-picker` swap-in lands, the implementation
 *     change is local to this file — no screen needs to be touched.
 *   - Symmetry with the other shared funnel components living in
 *     `src/components/funnel/` (FunnelPrimaryButton, GuideList) — same
 *     folder, same docblock conventions, same testID sentinel pattern.
 *
 * Stub URI shape (`stub://selfie/<timestamp>`):
 *   Sourced from the Phase 2.3 contract docblock on
 *   `FunnelDiagnosisInput.selfieUri`. The timestamp suffix means every tap
 *   produces a NEW URI string — so a developer testing re-capture can
 *   observe the context value change even though the surface's visible
 *   "셀카 등록됨" label stays constant. Phase 3.1 swaps the builder body for
 *   a real `file://` URI from expo-image-picker; the prop contract does not
 *   change.
 *
 * Why Pressable (not TouchableOpacity / Button):
 *   The Seed pattern across every funnel screen — modern RN API,
 *   per-state opacity feedback via the function-form `style` prop, no
 *   animation library required. TouchableOpacity is in maintenance mode;
 *   native `<Button>` cannot be visually customised consistently across iOS
 *   and Android. See the FunnelPrimaryButton docblock for the broader
 *   rationale.
 *
 * Why a single onCapture callback (not separate onPress + URI getter):
 *   The component already knows how to mint the stub URI (it owns the
 *   stub-URI builder). Exposing only `onCapture(uri: string)` keeps the
 *   parent screen contract tight — the parent receives a string it can
 *   write straight into `setDiagnosisInput({ selfieUri: uri })` without
 *   needing to inspect or rebuild the URI. The Seed constraint forbids
 *   expo-image-picker, so this minimal "tap → URI" surface is the entire
 *   capture API in Phase 2.3.
 *
 * Korean text affordance:
 *   The visible label is hardcoded Korean per the Seed constraint
 *   ("Korean text hardcoded — no i18n"). Pre-capture: `'셀카 등록하기'`;
 *   post-capture: `'셀카 등록됨'`. The `📷` Unicode emoji is rendered in a
 *   plain `<Text>` (no icon packages allowed) and is hidden from screen
 *   readers so the spoken label (set on the Pressable wrapper) is announced
 *   exactly once.
 *
 * Visual contract:
 *   - 240×240 oval surface (borderRadius 120) — circular crop hint without
 *     `react-native-svg`.
 *   - Idle:    pink fill (`COLORS.base.pink`)  + neutral border.
 *   - Captured: blush fill (`COLORS.base.blush`) + coral accent border.
 *   - Press feedback: subtle 0.7 opacity dip via the function-form `style`.
 *
 * Accessibility contract:
 *   - `accessibilityRole="button"` always.
 *   - `accessibilityLabel` mirrors the current state ("셀카 등록하기" /
 *     "셀카 등록됨") so VoiceOver/TalkBack announces the post-tap state
 *     transition naturally.
 *   - `accessibilityState={{ selected: hasCapturedSelfie }}` so screen
 *     readers correctly announce the captured state.
 *   - The 📷 emoji glyph is accessibility-hidden (`accessibilityElementsHidden`
 *     and `importantForAccessibility="no"`) to avoid a double announcement.
 *
 * testID contract:
 *   - Wrapper Pressable: caller-supplied `testID`, defaulting to
 *     {@link SELFIE_UPLOAD_PRESSABLE_DEFAULT_TEST_ID}.
 *   - Idle / captured labels carry stable, distinct testIDs so a parent
 *     screen test can pin the visible state without re-implementing the
 *     state branch.
 *
 * Out of scope (deferred):
 *   - Real selfie capture via expo-image-picker (Phase 3.1).
 *   - Multi-shot retry UI / preview thumbnail (Phase 3).
 *   - FAL.ai diagnosis API integration (Phase 3.1).
 */
import * as React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type PressableStateCallbackType,
} from 'react-native';

import { COLORS, SPACING, TYPOGRAPHY } from '../../theme';

/**
 * Default testID used when the caller does not supply one. Exported as a
 * named constant so unit tests and parent screens that want a stable handle
 * can refer to it by symbol rather than the raw string literal.
 */
export const SELFIE_UPLOAD_PRESSABLE_DEFAULT_TEST_ID = 'selfie-upload-pressable';

/**
 * Korean label shown on the capture surface before any tap has occurred.
 * Exported so the parent screen test (and future copy audits) can assert
 * against the same source-of-truth string instead of re-typing the literal.
 */
export const SELFIE_UPLOAD_IDLE_LABEL = '셀카 등록하기';

/**
 * Korean label shown on the capture surface once a selfie URI has been
 * captured (any non-null `selfieUri` prop value). Exported alongside the
 * idle label for the same reason.
 */
export const SELFIE_UPLOAD_CAPTURED_LABEL = '셀카 등록됨';

/**
 * Build a fresh stub selfie URI in the documented
 * `stub://selfie/<timestamp>` shape. Exported so the parent screen test
 * (and any future audit) can assert against the exact regex without
 * importing `Date.now`. The timestamp suffix is generated fresh on every
 * invocation so re-captures produce a NEW string.
 */
export function buildStubSelfieUri(): string {
  return `stub://selfie/${Date.now()}`;
}

/**
 * Props for {@link SelfieUploadPressable}.
 *
 * All fields are `readonly` — matches the Seed immutability convention
 * applied throughout the funnel surface.
 */
export interface SelfieUploadPressableProps {
  /**
   * Current selfie URI captured by the user (Phase 2.3: a
   * `stub://selfie/<timestamp>` string; Phase 3.1+: a `file://` URI). When
   * `null`, the surface renders its idle state ("셀카 등록하기"); any
   * non-null value renders the captured state ("셀카 등록됨").
   *
   * Typed as `string | null` (not `string | undefined`) per the Seed
   * convention applied to `FunnelDiagnosisInput.selfieUri`.
   */
  readonly selfieUri: string | null;
  /**
   * Invoked on every tap of the capture surface with a freshly minted
   * stub URI string. The parent screen forwards the URI into
   * `FunnelStateContext.setDiagnosisInput({ selfieUri: uri })`. Fires on
   * subsequent taps as well (re-capture), each time supplying a new
   * timestamp-suffixed URI.
   */
  readonly onCapture: (uri: string) => void;
  /**
   * Optional stable testID for the wrapper Pressable. Defaults to
   * {@link SELFIE_UPLOAD_PRESSABLE_DEFAULT_TEST_ID}. Callers SHOULD pass a
   * screen-scoped value (e.g. `'diagnosis-input-capture-surface'`) when
   * embedding the component inside a larger screen, so multiple capture
   * surfaces — if a future flow ever has more than one — stay
   * individually addressable.
   */
  readonly testID?: string;
}

/**
 * Reusable oval "selfie capture" Pressable for Phase 2.3 step 7.
 *
 * Renders a 240×240 oval surface with an emoji glyph and a Korean label;
 * mints a fresh `stub://selfie/<timestamp>` URI on each tap and hands it to
 * `onCapture`. The captured-vs-idle visual branch is driven by the parent's
 * `selfieUri` prop (controlled-component pattern). No state, no animation,
 * no native module — pure RN built-ins.
 *
 * @see SelfieUploadPressableProps
 */
export function SelfieUploadPressable(
  props: SelfieUploadPressableProps,
): React.ReactElement {
  const {
    selfieUri,
    onCapture,
    testID = SELFIE_UPLOAD_PRESSABLE_DEFAULT_TEST_ID,
  } = props;
  const hasCapturedSelfie = selfieUri !== null;

  const handlePress = React.useCallback(
    (_event: GestureResponderEvent): void => {
      // Generate a fresh stub URI on every tap (even re-captures) so the
      // parent's `setDiagnosisInput(...)` write produces a new string and
      // any downstream consumer can observe the state churn during
      // development. Phase 3.1 swaps the builder body for a real
      // expo-image-picker call without changing this control flow.
      onCapture(buildStubSelfieUri());
    },
    [onCapture],
  );

  // Function-form `style` so we can dip the opacity on press without
  // pulling in an animation library — same pattern used by
  // FunnelPrimaryButton.
  const surfaceStyle = React.useCallback(
    (state: PressableStateCallbackType) => {
      const base = hasCapturedSelfie
        ? [styles.surface, styles.surfaceCaptured]
        : [styles.surface];
      if (state.pressed) {
        return [...base, styles.surfacePressed];
      }
      return base;
    },
    [hasCapturedSelfie],
  );

  const accessibilityLabel = hasCapturedSelfie
    ? SELFIE_UPLOAD_CAPTURED_LABEL
    : SELFIE_UPLOAD_IDLE_LABEL;

  const labelTestID = hasCapturedSelfie
    ? 'selfie-upload-label-captured'
    : 'selfie-upload-label-idle';

  return (
    <View style={styles.wrapper}>
      <Pressable
        onPress={handlePress}
        style={surfaceStyle}
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ selected: hasCapturedSelfie }}
      >
        <Text
          style={styles.icon}
          testID="selfie-upload-icon"
          // The camera emoji is the only icon affordance allowed under the
          // Seed constraint (no icon packages). Suppress its own
          // announcement so VoiceOver does not say "camera" twice (the
          // spoken label sits on the Pressable above).
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          📷
        </Text>
        <Text style={styles.label} testID={labelTestID}>
          {hasCapturedSelfie ? SELFIE_UPLOAD_CAPTURED_LABEL : SELFIE_UPLOAD_IDLE_LABEL}
        </Text>
      </Pressable>
    </View>
  );
}

/**
 * StyleSheet — token-driven. Any visual tweak should land in the theme
 * module rather than here.
 */
const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.xl,
  },
  surface: {
    width: 240,
    height: 240,
    // borderRadius half the width/height gives a perfect circle — matches
    // the Phase 2.3 design's "selfie portrait" framing without
    // react-native-svg.
    borderRadius: 120,
    borderWidth: 2,
    borderColor: COLORS.grayscale.border,
    backgroundColor: COLORS.base.pink,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
  },
  surfaceCaptured: {
    borderColor: COLORS.base.coral,
    backgroundColor: COLORS.base.blush,
  },
  surfacePressed: {
    // Subtle press feedback without an animation library. 0.7 is the
    // canonical RN "pressed" opacity used historically by
    // TouchableOpacity — we preserve that visual intuition.
    opacity: 0.7,
  },
  icon: {
    // Use a large font size for the emoji glyph — RN handles the emoji
    // rasterisation from the platform font (no asset loaded).
    fontSize: 48,
  },
  label: {
    ...TYPOGRAPHY.body.bold,
    color: COLORS.grayscale.text,
    textAlign: 'center',
  },
});
