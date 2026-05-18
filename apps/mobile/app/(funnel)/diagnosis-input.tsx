/**
 * Funnel placeholder — diagnosis_input (Phase 2.1, step 7 of 12)
 *
 * v0.2: 셀카 단독 (온보딩 질문은 step 3 onboarding_priming으로 분리).
 * Internal-only; advances to fake_scan_animation (the visual 24-point
 * scan companion to step 5's text loader).
 */
import { useRouter } from 'expo-router';

import { FunnelPlaceholder } from '../../src/funnel-placeholder';

export default function DiagnosisInputScreen(): JSX.Element {
  const router = useRouter();
  return (
    <FunnelPlaceholder
      stepId="diagnosis_input"
      onNext={() => router.push('/(funnel)/fake-scan-animation')}
    />
  );
}
