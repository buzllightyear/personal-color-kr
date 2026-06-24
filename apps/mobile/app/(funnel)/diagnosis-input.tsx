/**
 * Funnel route — diagnosis_input (step 7 of 12).
 *
 * Thin expo-router wrapper that ALSO owns the Sign in with Apple gate. The
 * step-8 `POST /v1/diagnose` round-trip needs a backend JWT (Apple Sign In
 * only), so this route gates selfie capture behind sign-in:
 *
 *   - On mount it hydrates the persisted session: a Keychain-stored access
 *     token flips the auth slice to `signed_in`; otherwise `signed_out`.
 *   - While not `signed_in`, it renders the presentational
 *     `DiagnosisSignInGateScreen` (Apple button). A press drives `runSignIn`
 *     (native credential → backend → Keychain) and, on success, flips the auth
 *     slice — re-rendering into the capture surface below.
 *   - Once `signed_in`, it renders the original `DiagnosisInputScreen`
 *     unchanged (selfie capture → fake-scan-animation).
 *
 * Both screens stay pure props-in / callbacks-out; this route is the only place
 * that touches `expo-router`, `useFunnelState`, the picker, and the auth seams.
 */
import * as React from 'react';
import { useRouter } from 'expo-router';

import { DiagnosisInputScreen } from '../../src/screens/funnel/DiagnosisInputScreen';
import { DiagnosisSignInGateScreen } from '../../src/screens/funnel/DiagnosisSignInGateScreen';
import { useFunnelState } from '../../src/hooks/use-funnel-state';
import { pickSelfieUri } from '../../src/pick-selfie';
import { readAuthToken } from '../../src/storage/auth-token-storage';
import { runSignIn } from '../../src/run-sign-in';
import { signInErrorMessage } from '../../src/sign-in-error-message';

export default function DiagnosisInputRoute(): React.ReactElement {
  const router = useRouter();
  const { diagnosisInput, setDiagnosisInput, auth, setAuth } = useFunnelState();

  const [isSigningIn, setIsSigningIn] = React.useState<boolean>(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  // Hydrate the persisted Apple Sign In session once on mount: a Keychain
  // token means the user is already signed in (capture surface), otherwise the
  // gate is shown. Keyed on `setAuth` (stable via useCallback) so it runs once.
  React.useEffect((): void => {
    void (async (): Promise<void> => {
      const token = await readAuthToken();
      setAuth({ status: token !== null ? 'signed_in' : 'signed_out', userId: null });
    })();
  }, [setAuth]);

  const handleSignIn = React.useCallback((): void => {
    setErrorMessage(null);
    setIsSigningIn(true);
    void (async (): Promise<void> => {
      try {
        const result = await runSignIn();
        if (result.status === 'signed_in') {
          setAuth({ status: 'signed_in', userId: result.userId });
        } else if (result.status === 'error') {
          // Distinguish "couldn't reach the backend" (httpStatus null — usually
          // a transient outage / cold start) from a genuine backend rejection
          // (a non-200 status), so the user isn't told to blame their login.
          setErrorMessage(signInErrorMessage(result.httpStatus));
        }
        // `canceled` is a silent no-op: the user dismissed the sheet, so the
        // gate stays put with no error shown.
      } finally {
        setIsSigningIn(false);
      }
    })();
  }, [setAuth]);

  if (auth.status !== 'signed_in') {
    return (
      <DiagnosisSignInGateScreen
        onSignIn={handleSignIn}
        isSigningIn={isSigningIn}
        errorMessage={errorMessage}
      />
    );
  }

  return (
    <DiagnosisInputScreen
      selfieUri={diagnosisInput.selfieUri}
      onCaptureSelfie={(uri) => setDiagnosisInput({ selfieUri: uri })}
      // Inject the real device picker (expo-image-picker). It yields a
      // `file://` URI the diagnosis upload can use, or `null` on a
      // permission-deny / cancel (the component then leaves the idle state).
      acquireSelfieUri={() => pickSelfieUri()}
      onNext={() => router.push('/(funnel)/fake-scan-animation')}
    />
  );
}
