/**
 * Funnel step 5 — `fake_loader` presentational screen.
 *
 * Renders the 5-stage analyzing-loader progress ladder + headline + subhead
 * with no user-interactive buttons. The `useAutoAdvanceTimer` hook fires
 * `onElapsed` after exactly `FUNNEL_SCREENS.fake_loader.metadata.durationMs`
 * (5,000ms) with proper cleanup on unmount.
 *
 * Phase 6.2: the previous `ActivityIndicator` spinner is replaced by the shared
 * {@link StageLadder} component, driven by the `core-ts` analyzing-loader
 * controller via {@link useAnalyzingLoaderLadder}. The ladder owns ALL of its
 * own timing through that controller's injected scheduler — this screen adds no
 * timer for it. The ladder's 5000ms completion and the `useAutoAdvanceTimer`
 * 5000ms navigation are two independent timers that happen to land together;
 * the ladder is purely visual and never drives navigation.
 *
 * No user CTA — sunk-cost priming relies on the user *not* being able to
 * cancel. screens.ts CTA `{ action: 'auto_advance' }` is a status indicator,
 * not a Pressable.
 */
import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import { FUNNEL_SCREENS } from 'core-ts/funnel';

import { FunnelHeadline } from '../../components/FunnelHeadline';
import { StageLadder } from '../../components/StageLadder';
import { FunnelScreenLayout } from '../../funnel/FunnelScreenLayout';
import { useAutoAdvanceTimer } from '../../hooks/use-auto-advance-timer';
import {
  useAnalyzingLoaderLadder,
  type UseAnalyzingLoaderLadderOptions,
} from '../../hooks/use-stage-ladder';
import { SPACING } from '../../theme';

export interface FakeLoaderScreenProps {
  /** Fires when the 5-second timer elapses. Parent wires to `router.push('/(funnel)/scan-option-select')`. */
  readonly onElapsed: () => void;
  /** Optional override for the timer duration. Defaults to FUNNEL_SCREENS.fake_loader.metadata.durationMs (5000ms). */
  readonly durationMs?: number;
  /**
   * Optional injected scheduler for the analyzing-loader ladder. Production
   * omits this (the controller uses real `setTimeout`); tests pass a fake clock
   * to drive the ladder ticks synchronously. The RN layer never owns this
   * timer — it only forwards the scheduler to the controller.
   */
  readonly ladderScheduler?: UseAnalyzingLoaderLadderOptions['scheduler'];
}

const SCREEN = FUNNEL_SCREENS.fake_loader;
const METADATA = SCREEN.metadata as Readonly<{ durationMs: number }>;
const DEFAULT_DURATION_MS = METADATA.durationMs;

const LADDER_TESTID_PREFIX = 'fake-loader-ladder';

export function FakeLoaderScreen(
  props: FakeLoaderScreenProps,
): React.ReactElement {
  const { onElapsed, durationMs = DEFAULT_DURATION_MS, ladderScheduler } = props;

  useAutoAdvanceTimer({
    durationMs,
    onElapsed,
  });

  // The ladder controller owns its own timing through the injected scheduler.
  // `exactOptionalPropertyTypes` forbids passing `scheduler: undefined`, so we
  // build the options object conditionally.
  const ladderOptions: UseAnalyzingLoaderLadderOptions =
    ladderScheduler !== undefined ? { scheduler: ladderScheduler } : {};
  const ladder = useAnalyzingLoaderLadder(ladderOptions);

  return (
    <FunnelScreenLayout
      testID="fake-loader-screen"
      accessibilityLabel="분석 중"
    >
      <View style={styles.center}>
        <View style={styles.headerStack}>
          <FunnelHeadline
            headline={SCREEN.headline}
            subhead={SCREEN.subhead}
            testIDPrefix="fake-loader"
          />
        </View>
        <View style={styles.ladderWrap}>
          <StageLadder
            items={ladder.items}
            progress={ladder.progressPercent}
            ariaLive={ladder.ariaLive}
            testIDPrefix={LADDER_TESTID_PREFIX}
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
  ladderWrap: {
    alignSelf: 'stretch',
    paddingHorizontal: SPACING.xl,
  },
});
