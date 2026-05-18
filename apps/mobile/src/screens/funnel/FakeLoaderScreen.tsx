/**
 * Funnel step 5 — `fake_loader` presentational screen.
 *
 * Renders ActivityIndicator + headline + subhead with no user-interactive
 * buttons. The `useAutoAdvanceTimer` hook fires `onElapsed` after exactly
 * `FUNNEL_SCREENS.fake_loader.metadata.durationMs` (5,000ms) with proper
 * cleanup on unmount.
 *
 * No user CTA — sunk-cost priming relies on the user *not* being able to
 * cancel. screens.ts CTA `{ action: 'auto_advance' }` is a status indicator,
 * not a Pressable.
 */
import * as React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { FUNNEL_SCREENS } from 'core-ts/funnel';

import { FunnelHeadline } from '../../components/FunnelHeadline';
import { FunnelScreenLayout } from '../../funnel/FunnelScreenLayout';
import { useAutoAdvanceTimer } from '../../hooks/use-auto-advance-timer';
import { COLORS, SPACING } from '../../theme';

export interface FakeLoaderScreenProps {
  /** Fires when the 5-second timer elapses. Parent wires to `router.push('/(funnel)/scan-option-select')`. */
  readonly onElapsed: () => void;
  /** Optional override for the timer duration. Defaults to FUNNEL_SCREENS.fake_loader.metadata.durationMs (5000ms). */
  readonly durationMs?: number;
}

const SCREEN = FUNNEL_SCREENS.fake_loader;
const METADATA = SCREEN.metadata as Readonly<{ durationMs: number }>;
const DEFAULT_DURATION_MS = METADATA.durationMs;

export function FakeLoaderScreen(
  props: FakeLoaderScreenProps,
): React.ReactElement {
  const { onElapsed, durationMs = DEFAULT_DURATION_MS } = props;

  useAutoAdvanceTimer({
    durationMs,
    onElapsed,
  });

  return (
    <FunnelScreenLayout
      testID="fake-loader-screen"
      accessibilityLabel="분석 중"
    >
      <View style={styles.center}>
        <ActivityIndicator
          size="large"
          color={COLORS.base.coral}
          testID="fake-loader-spinner"
        />
        <View style={styles.headerStack}>
          <FunnelHeadline
            headline={SCREEN.headline}
            subhead={SCREEN.subhead}
            testIDPrefix="fake-loader"
          />
        </View>
      </View>
    </FunnelScreenLayout>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xl,
  },
  headerStack: {
    alignItems: 'center',
    gap: SPACING.md,
  },
});
