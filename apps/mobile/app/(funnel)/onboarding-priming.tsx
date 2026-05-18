/**
 * Route — funnel step 3 (`onboarding_priming`).
 *
 * Thin wrapper: expo-router hooks + FunnelStateContext → onNext + onSelect
 * handlers → delegate to `OnboardingPrimingScreen`. The route owns the
 * navigation push and the context write; the screen is pure props.
 */
import { useRouter } from 'expo-router';

import { OnboardingPrimingScreen } from '../../src/screens/funnel/OnboardingPrimingScreen';
import { useFunnelState } from '../../src/hooks/use-funnel-state';

export default function OnboardingPrimingRoute(): JSX.Element {
  const router = useRouter();
  const { onboarding, setOnboarding } = useFunnelState();
  return (
    <OnboardingPrimingScreen
      onboarding={onboarding}
      onSelectSelfieEditStyle={(value) => setOnboarding({ selfieEditStyle: value })}
      onSelectPriorDiagnosis={(value) => setOnboarding({ priorDiagnosis: value })}
      onNext={() => router.push('/(funnel)/rating-gate')}
    />
  );
}
