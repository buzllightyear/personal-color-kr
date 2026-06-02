/**
 * Funnel route wrapper — `fake_scan_animation` (Phase 2.3, step 8 of 12)
 *
 * Thin route file that wires `expo-router` into the presentational
 * `FakeScanAnimationScreen` component. The Seed pattern keeps router /
 * navigation concerns OUT of the screen file so the screen unit-tests
 * cleanly without an expo-router context.
 *
 *   route (this file)           : owns `useRouter().push(...)`.
 *   screen (FakeScanAnimationScreen) : owns the visual animation + timer.
 *
 * The `onElapsed` callback advances to step 9 (`result_reveal`) using the
 * same kebab-cased route path the linking config exposes. No PII is passed
 * — the 5-second animation is internal and stateless from the router's
 * perspective.
 */
import * as React from 'react';
import { useRouter } from 'expo-router';

import { FakeScanAnimationScreen } from '../../src/screens/funnel/FakeScanAnimationScreen';

export default function FakeScanAnimationRoute(): React.ReactElement {
  const router = useRouter();
  return (
    <FakeScanAnimationScreen onElapsed={() => router.push('/(funnel)/result-reveal')} />
  );
}
