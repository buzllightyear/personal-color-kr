/**
 * Funnel step 7 — `diagnosis_input` presentational screen.
 *
 * The single-input step where the user "captures" a selfie before the visual
 * fake-scan animation (step 8). Phase 2.3 ships a stubbed capture: tapping
 * the central capture surface stores a `stub://selfie/<timestamp>` URI on
 * the `FunnelStateContext.diagnosisInput` slice via the parent-supplied
 * `onCaptureSelfie` callback. No real `expo-image-picker` runs — the actual
 * file-system wiring is deferred to Phase 3.1 (the ban on `expo-image-picker`
 * in this phase's constraint set codifies that boundary).
 *
 * Composition (Sub-AC 5.3):
 *   This screen *composes* two leaf components extracted in Sub-AC 5.1 and
 *   5.2, and itself contains no inline JSX for either concern:
 *
 *     - `<GuideList />` (Sub-AC 5.1) — the three-row Korean checklist
 *       (`정면` / `자연광` / `민낯`) that augments the headline subhead with
 *       a *visually* discrete "do this" affordance.
 *     - `<SelfieUploadPressable />` (Sub-AC 5.2) — the oval capture surface
 *       that mints a fresh `stub://selfie/<timestamp>` URI on every tap and
 *       hands it back to the parent via `onCapture`.
 *
 *   The screen's job, post-extraction, is:
 *     1. Wire the screen layout / headline / subhead from FUNNEL_SCREENS.
 *     2. Mount `<GuideList />` underneath the headline.
 *     3. Mount `<SelfieUploadPressable />` between the cue list and the
 *        primary CTA, threading the `selfieUri` prop through and forwarding
 *        the `onCapture` URI straight to the route's `onCaptureSelfie`.
 *     4. Gate the primary CTA on `selfieUri !== null` so the route's
 *        `onNext` cannot fire until the context slice carries a URI.
 *
 * Visual rhythm (matches the FUNNEL_SCREENS metadata + Phase 2.3 visual spec):
 *
 *   ┌──────────────────────────────┐
 *   │ Headline:  셀카 1장만 올려주세요  │
 *   │ Subhead:   정면 · 자연광 · …    │
 *   │                              │
 *   │ ✓ 정면                       │   ← GuideList
 *   │ ✓ 자연광                     │
 *   │ ✓ 민낯                       │
 *   │                              │
 *   │ ┌──────────────────────────┐ │   ← SelfieUploadPressable
 *   │ │      📷 셀카 등록하기      │ │
 *   │ └──────────────────────────┘ │
 *   │                              │
 *   │ [    셀카 업로드하기    ]      │   ← primary CTA from FUNNEL_SCREENS,
 *   └──────────────────────────────┘     disabled until first tap; advances
 *                                        to step 8 (fake_scan_animation)
 *
 * Why props-in / callbacks-out (and not a direct `useFunnelState` call here):
 *   Mirroring the Phase 2.2 OnboardingPrimingScreen pattern, the route file
 *   (`app/(funnel)/diagnosis-input.tsx`) is the only place that touches
 *   expo-router AND `useFunnelState`. The screen receives the current value
 *   (`selfieUri`) and two callbacks (`onCaptureSelfie`, `onNext`) as plain
 *   props so it unit-tests without any provider or router context.
 *
 * Why `<SelfieUploadPressable testID="diagnosis-input-capture-surface" />`
 * (not the component's default testID):
 *   The screen-level test contract pins the wrapper Pressable's testID to a
 *   screen-scoped string so a future screen that also wants to embed a
 *   `SelfieUploadPressable` can disambiguate its tree. The component's
 *   internal label testIDs (`selfie-upload-label-idle` /
 *   `selfie-upload-label-captured`) and icon testID (`selfie-upload-icon`)
 *   are intentionally NOT shadowed — the component owns the visible-state
 *   testIDs as part of its public contract.
 *
 * Accessibility:
 *   - Capture surface (SelfieUploadPressable) carries
 *     `accessibilityRole="button"` and an `accessibilityLabel` that reflects
 *     the current state ("셀카 등록하기" before capture, "셀카 등록됨"
 *     after). VoiceOver/TalkBack announces the state transition naturally
 *     without needing a `liveRegion`.
 *   - Primary CTA mirrors the Phase 2.2 FunnelPrimaryButton accessibility
 *     contract — `accessibilityState.disabled` follows the `!hasCapturedSelfie`
 *     flag so screen readers correctly announce the gated state.
 *   - GuideList rows expose `accessibilityRole="text"` and an
 *     `accessibilityLabel` equal to each cue (`정면`/`자연광`/`민낯`); the
 *     leading ✓ glyph is hidden from screen readers so the cue is announced
 *     exactly once.
 */
import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import { FUNNEL_SCREENS } from 'core-ts/funnel';

import { FunnelHeadline } from '../../components/FunnelHeadline';
import { FunnelPrimaryButton } from '../../components/funnel/FunnelPrimaryButton';
import { GuideList } from '../../components/funnel/GuideList';
import { SelfieUploadPressable } from '../../components/funnel/SelfieUploadPressable';
import { FunnelScreenLayout } from '../../funnel/FunnelScreenLayout';
import { SPACING } from '../../theme';

export interface DiagnosisInputScreenProps {
  /**
   * Current selfie URI from `FunnelStateContext.diagnosisInput.selfieUri`.
   * `null` indicates the user has not yet tapped the capture surface; a
   * non-null string (Phase 2.3: a `stub://selfie/<timestamp>` URI) indicates
   * the captured state.
   */
  readonly selfieUri: string | null;
  /**
   * Invoked the first time the user taps the capture surface (Phase 2.3:
   * also fires on subsequent taps so the route handler can swap the stub
   * timestamp). The route handler writes the URI into the funnel context
   * via `setDiagnosisInput({ selfieUri })`.
   */
  readonly onCaptureSelfie: (uri: string) => void;
  /**
   * Invoked when the primary CTA is pressed. Parent wires this to
   * `router.push('/(funnel)/fake-scan-animation')`. Only fires when
   * `selfieUri !== null` (the CTA is disabled until then).
   */
  readonly onNext: () => void;
}

const SCREEN = FUNNEL_SCREENS.diagnosis_input;

/**
 * Stable testID handle that the screen pins to the wrapper Pressable of the
 * embedded `<SelfieUploadPressable />`. Exported so route- and screen-level
 * tests can reference it by symbol rather than re-typing the literal.
 *
 * The component's own internal label/icon testIDs
 * (`selfie-upload-label-idle`, `selfie-upload-label-captured`,
 * `selfie-upload-icon`) are part of the SelfieUploadPressable contract and
 * are NOT shadowed by the screen.
 */
export const DIAGNOSIS_INPUT_CAPTURE_SURFACE_TEST_ID =
  'diagnosis-input-capture-surface';

function requirePrimaryCta(): { readonly label: string } {
  const cta = SCREEN.ctas[0];
  if (cta === undefined) {
    throw new Error('FUNNEL_SCREENS.diagnosis_input is missing its primary CTA');
  }
  return cta;
}

const PRIMARY_CTA = requirePrimaryCta();

export function DiagnosisInputScreen(
  props: DiagnosisInputScreenProps,
): React.ReactElement {
  const { selfieUri, onCaptureSelfie, onNext } = props;
  const hasCapturedSelfie = selfieUri !== null;

  // The SelfieUploadPressable owns the stub-URI builder — the screen simply
  // forwards whatever URI the component emits into the route-supplied
  // `onCaptureSelfie` callback. Memoised so the SelfieUploadPressable's own
  // `useCallback` dependency stays stable across renders.
  const handleCapture = React.useCallback(
    (uri: string): void => {
      onCaptureSelfie(uri);
    },
    [onCaptureSelfie],
  );

  return (
    <FunnelScreenLayout testID="diagnosis-input-screen" accessibilityLabel="셀카 등록">
      <FunnelHeadline
        headline={SCREEN.headline}
        subhead={SCREEN.subhead}
        testIDPrefix="diagnosis-input"
      />
      <View style={styles.guideWrapper}>
        <GuideList testIDPrefix="diagnosis-input-guide-list" />
      </View>
      <View style={styles.captureWrapper}>
        <SelfieUploadPressable
          selfieUri={selfieUri}
          onCapture={handleCapture}
          testID={DIAGNOSIS_INPUT_CAPTURE_SURFACE_TEST_ID}
        />
      </View>
      <View style={styles.ctaWrapper}>
        <FunnelPrimaryButton
          label={PRIMARY_CTA.label}
          onPress={onNext}
          disabled={!hasCapturedSelfie}
          testID="diagnosis-input-submit"
          accessibilityLabel={PRIMARY_CTA.label}
        />
      </View>
    </FunnelScreenLayout>
  );
}

const styles = StyleSheet.create({
  guideWrapper: {
    paddingVertical: SPACING.md,
  },
  captureWrapper: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaWrapper: {
    paddingBottom: SPACING.xl,
  },
});
