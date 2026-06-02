/**
 * Route — funnel step 5 (`fake_loader`).
 *
 * Thin wrapper: expo-router hook → onElapsed handler → delegate to
 * `FakeLoaderScreen`. The screen owns the 5-second timer via
 * `useAutoAdvanceTimer`; the route only navigates when the timer fires.
 */
import { useRouter } from 'expo-router';

import { FakeLoaderScreen } from '../../src/screens/funnel/FakeLoaderScreen';

export default function FakeLoaderRoute(): JSX.Element {
  const router = useRouter();
  return (
    <FakeLoaderScreen onElapsed={() => router.push('/(funnel)/scan-option-select')} />
  );
}
