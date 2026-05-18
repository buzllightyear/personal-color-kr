/**
 * Funnel placeholder — fake_loader (Phase 2.1, step 5 of 12)
 *
 * v0.2 이동 (구 step 8 → step 5; price_anchoring 자리). Internal-only;
 * the 5-second auto-advance behaviour is intentionally left out of the
 * placeholder so a manual smoke test can still inspect the dev-info row.
 * Real auto-advance lands in subsequent units.
 */
import { useRouter } from 'expo-router';

import { FunnelPlaceholder } from '../../src/funnel-placeholder';

export default function FakeLoaderScreen(): JSX.Element {
  const router = useRouter();
  return (
    <FunnelPlaceholder
      stepId="fake_loader"
      onNext={() => router.push('/(funnel)/scan-option-select')}
    />
  );
}
