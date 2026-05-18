/**
 * Funnel placeholder — onboarding_priming (Phase 2.1, step 3 of 12)
 *
 * v0.2 신설 (replaces social_proof_intro). Internal-only; advances to
 * the rating_gate step that uses these priming answers as the
 * consistency-lever anchor.
 */
import { useRouter } from 'expo-router';

import { FunnelPlaceholder } from '../../src/funnel-placeholder';

export default function OnboardingPrimingScreen(): JSX.Element {
  const router = useRouter();
  return (
    <FunnelPlaceholder
      stepId="onboarding_priming"
      onNext={() => router.push('/(funnel)/rating-gate')}
    />
  );
}
