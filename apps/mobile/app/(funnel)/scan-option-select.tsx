/**
 * Funnel route — scan_option_select (Phase 2.3, step 6 of 12).
 *
 * Thin expo-router route wrapper. Resolves the `useRouter` push handler and
 * forwards it as `onSelectPersonalColor` to the presentational screen.
 * The screen owns all the visual / accessibility decisions; this file only
 * wires navigation. Per the Seed constraint, selecting `퍼스널 컬러` is the
 * only path the funnel currently models — secondary slots are Phase-N TBD.
 */
import * as React from 'react';
import { useRouter } from 'expo-router';

import { ScanOptionSelectScreen } from '../../src/screens/funnel/ScanOptionSelectScreen';

export default function ScanOptionSelectRoute(): React.ReactElement {
  const router = useRouter();
  return (
    <ScanOptionSelectScreen
      onSelectPersonalColor={() => router.push('/(funnel)/diagnosis-input')}
    />
  );
}
