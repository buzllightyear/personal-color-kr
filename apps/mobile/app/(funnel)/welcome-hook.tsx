/**
 * Route — funnel step 1 (`welcome_hook`).
 *
 * Thin wrapper per Phase 2.1 pattern: expo-router hooks → onNext handler →
 * delegate to `WelcomeHookScreen` presentational component.
 */
import { useRouter } from 'expo-router';

import { WelcomeHookScreen } from '../../src/screens/funnel/WelcomeHookScreen';

export default function WelcomeHookRoute(): JSX.Element {
  const router = useRouter();
  return (
    <WelcomeHookScreen onNext={() => router.push('/(funnel)/value-props')} />
  );
}
