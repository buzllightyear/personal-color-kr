/**
 * Funnel route — diagnosis_input (Phase 2.3, step 7 of 12).
 *
 * Thin expo-router wrapper. Resolves the `useRouter` push handler and the
 * `useFunnelState` hook here so the presentational `DiagnosisInputScreen`
 * stays pure props-in / callbacks-out (and unit-tests without any
 * provider or router context).
 *
 *   - `selfieUri` is read from `FunnelStateContext.diagnosisInput`.
 *   - `acquireSelfieUri` injects the real `expo-image-picker` device capture
 *     (`pickSelfieUri`) — a `file://` URI, or `null` on permission-deny/cancel.
 *   - `onCaptureSelfie(uri)` writes the captured URI via `setDiagnosisInput`.
 *   - `onNext()` navigates to the next funnel step
 *     (`/(funnel)/fake-scan-animation`).
 */
import * as React from 'react';
import { useRouter } from 'expo-router';

import { DiagnosisInputScreen } from '../../src/screens/funnel/DiagnosisInputScreen';
import { useFunnelState } from '../../src/hooks/use-funnel-state';
import { pickSelfieUri } from '../../src/pick-selfie';

export default function DiagnosisInputRoute(): React.ReactElement {
  const router = useRouter();
  const { diagnosisInput, setDiagnosisInput } = useFunnelState();
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
