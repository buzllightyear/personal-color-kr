/**
 * `DiagnosisSignInGateScreen` — the signed-out face of funnel step 7
 * (`diagnosis_input`).
 *
 * The step-8 `POST /v1/diagnose` round-trip requires a backend JWT (Apple Sign
 * In only), so the funnel gates selfie capture behind sign-in: while the auth
 * slice is not `signed_in`, the route renders THIS screen instead of
 * `DiagnosisInputScreen`. Signing in (Face ID, ~1s) flips the slice and reveals
 * the capture surface. Keeping the gate a separate presentational screen leaves
 * `DiagnosisInputScreen` (and its exhaustive test suite) untouched.
 *
 * Pure props-in / callbacks-out: it owns no router, no `useFunnelState`, no
 * network. The route wires `onSignIn` to the `runSignIn` orchestrator and feeds
 * back the in-flight (`isSigningIn`) and failure (`errorMessage`) state for the
 * button-disable + error-copy branches. Korean copy is hardcoded (no i18n),
 * per the project convention.
 */
import * as React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FunnelHeadline } from '../../components/FunnelHeadline';
import { AppleSignInButton } from '../../components/funnel/AppleSignInButton';
import { FunnelScreenLayout } from '../../funnel/FunnelScreenLayout';
import { COLORS, SPACING, TYPOGRAPHY } from '../../theme';

export interface DiagnosisSignInGateScreenProps {
  /** Invoked when the Apple Sign In button is pressed. */
  readonly onSignIn: () => void;
  /**
   * `true` while a sign-in is in flight — disables the button so a double-tap
   * cannot launch two system sheets.
   */
  readonly isSigningIn?: boolean;
  /**
   * A user-facing error message to show under the button, or `null`/absent when
   * the last attempt did not fail. A user cancel is NOT an error (the route
   * leaves this `null` on cancel).
   */
  readonly errorMessage?: string | null;
}

/** Hardcoded Korean copy (no i18n) — the gate's headline / subhead / footnote. */
const HEADLINE = 'Apple로 로그인하고\n진단을 시작하세요';
const SUBHEAD = '진단 결과를 안전하게 저장하고 언제든 다시 확인할 수 있어요.';
const FOOTNOTE = 'Apple ID로 1초 만에. 셀카는 진단 분석에만 쓰여요.';

export const DIAGNOSIS_SIGN_IN_GATE_ERROR_TEST_ID = 'diagnosis-sign-in-gate-error';

export function DiagnosisSignInGateScreen(
  props: DiagnosisSignInGateScreenProps,
): React.ReactElement {
  const { onSignIn, isSigningIn = false, errorMessage = null } = props;

  return (
    <FunnelScreenLayout
      testID="diagnosis-sign-in-gate-screen"
      accessibilityLabel="Apple 로그인"
    >
      <FunnelHeadline
        headline={HEADLINE}
        subhead={SUBHEAD}
        testIDPrefix="diagnosis-sign-in-gate"
      />
      <View style={styles.spacer} />
      <View style={styles.actions}>
        <AppleSignInButton onPress={onSignIn} disabled={isSigningIn} />
        {errorMessage !== null ? (
          <Text
            style={styles.error}
            testID={DIAGNOSIS_SIGN_IN_GATE_ERROR_TEST_ID}
            accessibilityRole="alert"
          >
            {errorMessage}
          </Text>
        ) : null}
        <Text style={styles.footnote}>{FOOTNOTE}</Text>
      </View>
    </FunnelScreenLayout>
  );
}

const styles = StyleSheet.create({
  spacer: {
    flex: 1,
  },
  actions: {
    paddingBottom: SPACING.xl,
    gap: SPACING.sm,
  },
  error: {
    ...TYPOGRAPHY.caption.regular,
    color: COLORS.grayscale.text,
    textAlign: 'center',
  },
  footnote: {
    ...TYPOGRAPHY.caption.regular,
    color: COLORS.grayscale.disabled,
    textAlign: 'center',
  },
});
