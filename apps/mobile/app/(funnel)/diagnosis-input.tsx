/**
 * Funnel route — diagnosis_input (Phase 2.3, step 7 of 12).
 *
 * Thin expo-router wrapper. Resolves the `useRouter` push handler and the
 * `useFunnelState` hook here so the presentational `DiagnosisInputScreen`
 * stays pure props-in / callbacks-out (and unit-tests without any
 * provider or router context).
 *
 *   - `selfieUri` is read from `FunnelStateContext.diagnosisInput`.
 *   - `onCaptureSelfie(uri)` writes the stub URI via `setDiagnosisInput`.
 *   - `onNext()` navigates to the next funnel step
 *     (`/(funnel)/fake-scan-animation`).
 */
import * as React from 'react';
import { useRouter } from 'expo-router';

import { DiagnosisInputScreen } from '../../src/screens/funnel/DiagnosisInputScreen';
import { useFunnelState } from '../../src/hooks/use-funnel-state';

export default function DiagnosisInputRoute(): React.ReactElement {
  const router = useRouter();
  const { diagnosisInput, setDiagnosisInput } = useFunnelState();
  return (
    <DiagnosisInputScreen
      selfieUri={diagnosisInput.selfieUri}
      onCaptureSelfie={(uri) => setDiagnosisInput({ selfieUri: uri })}
      onNext={() => router.push('/(funnel)/fake-scan-animation')}
    />
  );
}
