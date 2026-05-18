/**
 * Funnel placeholder — fake_scan_animation (Phase 2.1, step 8 of 12)
 *
 * v0.2 신설 — visual 24-point scan animation that pairs with step 5's
 * text loader for a dual sunk-cost mechanism. Internal-only; advances
 * to result_reveal.
 */
import { useRouter } from 'expo-router';

import { FunnelPlaceholder } from '../../src/funnel-placeholder';

export default function FakeScanAnimationScreen(): JSX.Element {
  const router = useRouter();
  return (
    <FunnelPlaceholder
      stepId="fake_scan_animation"
      onNext={() => router.push('/(funnel)/result-reveal')}
    />
  );
}
