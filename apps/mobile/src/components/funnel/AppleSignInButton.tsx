/**
 * `AppleSignInButton` — the HIG-compliant Sign in with Apple button.
 *
 * Apple's App Store Review Guidelines (§4.8) and Human Interface Guidelines
 * REQUIRE the system-provided button (or one matching its exact style) for
 * Sign in with Apple — a hand-rolled monochrome button would risk rejection.
 * So this wraps the native `AppleAuthentication.AppleAuthenticationButton`
 * rather than the project's `FunnelPrimaryButton`. We do keep it on-brand where
 * Apple allows: the BLACK style + `cornerRadius: 2` mirror the editorial ink
 * ramp + near-square radius of the design system.
 *
 * Presentational / callbacks-out: it owns no navigation or network — the route
 * wires `onPress` to the `runSignIn` orchestration. `disabled` (set while a
 * sign-in is already in flight) swallows the press so a double-tap cannot fire
 * two concurrent system sheets; the native button has no disabled prop, so the
 * guard lives here.
 *
 * Native module note: `expo-apple-authentication` is aliased to an inert stub
 * in `vitest.config.ts`, where `AppleAuthenticationButton` renders as a host
 * element forwarding `testID` / `onPress` — so this component unit-tests
 * (press → callback, disabled → no callback) without the native bridge.
 */
import * as React from 'react';
import { StyleSheet } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';

export interface AppleSignInButtonProps {
  /** Fired when the button is pressed (unless `disabled`). */
  readonly onPress: () => void;
  /**
   * When `true`, the press is swallowed (a sign-in is already in flight). The
   * native button has no disabled state, so the guard is applied to `onPress`.
   */
  readonly disabled?: boolean;
  /** testID for the button host (defaults to `apple-sign-in-button`). */
  readonly testID?: string;
}

/** Default testID so screen tests can locate the button without prop drilling. */
export const APPLE_SIGN_IN_BUTTON_TEST_ID = 'apple-sign-in-button';

export function AppleSignInButton(props: AppleSignInButtonProps): React.ReactElement {
  const { onPress, disabled = false, testID = APPLE_SIGN_IN_BUTTON_TEST_ID } = props;

  const handlePress = React.useCallback((): void => {
    if (disabled) {
      return;
    }
    onPress();
  }, [disabled, onPress]);

  return (
    <AppleAuthentication.AppleAuthenticationButton
      buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
      buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
      cornerRadius={2}
      style={styles.button}
      onPress={handlePress}
      testID={testID}
    />
  );
}

const styles = StyleSheet.create({
  button: {
    width: '100%',
    height: 52,
  },
});
