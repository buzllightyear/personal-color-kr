/**
 * Route — funnel step 2 (`value_props`).
 *
 * Thin wrapper: expo-router hooks → onNext handler → delegate to
 * `ValuePropsScreen` presentational component.
 */
import { useRouter } from 'expo-router';

import { ValuePropsScreen } from '../../src/screens/funnel/ValuePropsScreen';

export default function ValuePropsRoute(): JSX.Element {
  const router = useRouter();
  return (
    <ValuePropsScreen
      onNext={() => router.push('/(funnel)/onboarding-priming')}
    />
  );
}
