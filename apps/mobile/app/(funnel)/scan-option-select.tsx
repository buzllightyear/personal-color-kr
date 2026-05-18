/**
 * Funnel placeholder — scan_option_select (Phase 2.1, step 6 of 12)
 *
 * Internal-only. The real screen presents 3 scan options (퍼스널 컬러 as
 * the primary CTA + 2 Phase-N secondary scans). The placeholder advances
 * to diagnosis-input — selecting personal-color is the only path the
 * funnel currently models.
 */
import { useRouter } from 'expo-router';

import { FunnelPlaceholder } from '../../src/funnel-placeholder';

export default function ScanOptionSelectScreen(): JSX.Element {
  const router = useRouter();
  return (
    <FunnelPlaceholder
      stepId="scan_option_select"
      onNext={() => router.push('/(funnel)/diagnosis-input')}
    />
  );
}
