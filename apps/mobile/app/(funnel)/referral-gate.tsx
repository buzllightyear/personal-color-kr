/**
 * Funnel placeholder — referral_gate (Phase 2.1, step 10 of 12, KR variant)
 *
 * Externally-allowed: reachable via `/r/<code>` deep link. The
 * `shouldBypassReferral()` guard from `_guards.ts` controls whether the
 * funnel skips this step for invited users. The placeholder surfaces
 * the guard's current value in the dev-info row so the fail-loud
 * stub status is visible during manual QA.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';

import { FunnelPlaceholder } from '../../src/funnel-placeholder';
import { shouldBypassReferral } from './_guards';

export default function ReferralGateScreen(): JSX.Element {
  const router = useRouter();
  const params = useLocalSearchParams();
  const bypass = shouldBypassReferral();
  return (
    <FunnelPlaceholder
      stepId="referral_gate"
      routeParams={params as Record<string, unknown>}
      guardStatus={{ name: 'shouldBypassReferral', value: bypass }}
      onNext={() => router.push('/(funnel)/social-evolution')}
    />
  );
}
