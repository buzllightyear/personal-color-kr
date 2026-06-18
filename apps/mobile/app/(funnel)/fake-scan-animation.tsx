/**
 * Funnel route wrapper — `fake_scan_animation` (step 8 of 12)
 *
 * Thin route file that wires `expo-router` into the presentational
 * `FakeScanAnimationScreen` component AND kicks off the real
 * `POST /v1/diagnose` round-trip behind the 5-second scan overlay. The Seed
 * pattern keeps router / navigation / network concerns OUT of the screen file
 * so the screen unit-tests cleanly without an expo-router or provider context.
 *
 *   route (this file)                : owns `useRouter().push(...)` + the
 *                                      diagnosis request side-effect.
 *   screen (FakeScanAnimationScreen) : owns the visual animation + timer.
 *
 * Diagnosis side-effect (masked by the animation):
 *   On mount we resolve the captured selfie ({@link selfieFileFromUri}) and a
 *   dev access token (`getDevAuthToken`). When BOTH are present we fire
 *   `runDiagnosis` once — it drives the `diagnosis` slice through
 *   `pending → success | error` while the 5s overlay plays, so `result_reveal`
 *   typically has the diagnosed category ready by the time the user arrives.
 *
 *   Graceful degradation: until the real device picker (which yields a
 *   `file://` selfie) and Apple-Sign-In token exist, the selfie is a
 *   `stub://` placeholder and/or the token is absent, so the effect no-ops and
 *   the funnel shows the existing static teaser on step 9. No PII crosses the
 *   router — the request reads the in-memory selfie URI from context only.
 *
 * The `onElapsed` callback advances to step 9 (`result_reveal`) on the 5s
 * timer regardless of the request's state — a slow response simply lands in
 * the slice a beat later and `result_reveal` re-renders.
 */
import * as React from 'react';
import { useRouter } from 'expo-router';

import { FakeScanAnimationScreen } from '../../src/screens/funnel/FakeScanAnimationScreen';
import { useFunnelState } from '../../src/hooks/use-funnel-state';
import { getAuthToken } from '../../src/config/auth-token';
import { runDiagnosis, selfieFileFromUri } from '../../src/run-diagnosis';

export default function FakeScanAnimationRoute(): React.ReactElement {
  const router = useRouter();
  const { diagnosisInput, setDiagnosis } = useFunnelState();

  // Fire the real diagnosis exactly once, when a real selfie + token are both
  // available. Keyed on the selfie URI so a re-capture (new URI) re-fires; the
  // guard below makes the no-token path a clean no-op (static teaser fallback).
  //
  // The token now resolves asynchronously (`getAuthToken` reads the Keychain-
  // persisted Apple-Sign-In session, falling back to the dev seam), so the
  // effect short-circuits on a `null` selfie *before* the async read to avoid
  // an unnecessary Keychain hit, then fires the request inside a void IIFE.
  React.useEffect((): void => {
    const selfie = selfieFileFromUri(diagnosisInput.selfieUri);
    if (selfie === null) {
      return;
    }
    void (async (): Promise<void> => {
      const accessToken = await getAuthToken();
      if (accessToken === null) {
        return;
      }
      await runDiagnosis({ selfie, accessToken, setDiagnosis });
    })();
  }, [diagnosisInput.selfieUri, setDiagnosis]);

  return (
    <FakeScanAnimationScreen onElapsed={() => router.push('/(funnel)/result-reveal')} />
  );
}
