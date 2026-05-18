/**
 * Funnel placeholder — value_props (Phase 2.1, step 2 of 12)
 *
 * Internal-only step: no external deep link reaches here. The `onNext`
 * advances linearly to step 3 (onboarding-priming).
 */
import { useRouter } from 'expo-router';

import { FunnelPlaceholder } from '../../src/funnel-placeholder';

export default function ValuePropsScreen(): JSX.Element {
  const router = useRouter();
  return (
    <FunnelPlaceholder
      stepId="value_props"
      onNext={() => router.push('/(funnel)/onboarding-priming')}
    />
  );
}
