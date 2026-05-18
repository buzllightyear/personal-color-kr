/**
 * Funnel placeholder — social_evolution (Phase 2.1, step 11 of 12, KR variant)
 *
 * v0.2 — social_proof_intro 흡수. Internal-only; advances to
 * payment_model. Real UGC + influencer + aggregate proof rendering
 * lands in a subsequent unit.
 */
import { useRouter } from 'expo-router';

import { FunnelPlaceholder } from '../../src/funnel-placeholder';

export default function SocialEvolutionScreen(): JSX.Element {
  const router = useRouter();
  return (
    <FunnelPlaceholder
      stepId="social_evolution"
      onNext={() => router.push('/(funnel)/payment-model')}
    />
  );
}
