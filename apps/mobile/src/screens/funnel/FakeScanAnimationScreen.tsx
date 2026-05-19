/**
 * Funnel step 8 — `fake_scan_animation` presentational screen.
 *
 * The *visual* twin of step 5's text loader: a 5,000ms face-scan overlay that
 * sweeps a coral horizontal line down a borderRadius-driven face oval while
 * the 24 hardcoded face-landmark dots light up in source order. The screen
 * auto-advances to step 9 (`result_reveal`) at the moment the sweep reaches
 * the chin row — the underlying timer is the same shared `useAutoAdvanceTimer`
 * hook that powers `fake_loader`.
 *
 * Sunk-cost mechanism (Seed-derived):
 *   Step 5 (`fake_loader`) and step 8 (`fake_scan_animation`) form a dual
 *   priming pair — text effort justification (step 5) + visual effort
 *   justification (step 8). The user pays attention for 10s in total before
 *   landing on the gated result-reveal at step 9. The Korean copy on this
 *   screen ("얼굴 24개 포인트 스캔 중") and the literal 24-dot rendering are
 *   the visual half of that mechanism.
 *
 * Visual rhythm:
 *
 *   ┌────────────────────────────────────┐
 *   │ Headline:  얼굴 24개 포인트 스캔 중    │
 *   │ Subhead:   셀카 위에서 스캔 라인이…    │
 *   │                                    │
 *   │ ┌────────────────────────────┐     │
 *   │ │     · · ·                  │     │   ← borderRadius-driven oval
 *   │ │   · · · · · ·              │     │     view ("face") with 24 dots
 *   │ │   · · · · · · ·            │     │     positioned via normalised
 *   │ │   ════════════════         │ ←── │     {x, y} pairs scaled at
 *   │ │   · · · · · · ·            │     │     render time, plus a coral
 *   │ │   · · · · · ·              │     │     sweep line whose `top`
 *   │ │     · · ·                  │     │     interpolates from 0 to
 *   │ └────────────────────────────┘     │     FACE_HEIGHT over 5,000ms.
 *   │                                    │
 *   │              12 / 24               │   ← counter — floor(progress * 24)
 *   └────────────────────────────────────┘
 *
 * Constraints (Seed):
 *   - Pure React Native built-ins only — no `react-native-reanimated`,
 *     `lottie-react-native`, `react-native-svg`. The single `Animated.Value`
 *     drives every animated thing on the screen (sweep-line position,
 *     per-dot colour interpolation, counter snapshot). Easing is `linear`
 *     so the counter ticks at a constant 4.8 dots/second (≈ 24 / 5).
 *   - `useNativeDriver: false` — the sweep line animates `top` and the
 *     dots animate `backgroundColor`. Neither of those are layout-only
 *     transforms, so the native driver would reject them at runtime.
 *   - The face outline is a plain `<View>` with `borderRadius` half the
 *     min dimension (oval-ish on a 240×320 box). No SVG path.
 *   - The animation fires *once* — no loop. After completion the dots and
 *     sweep line stay at their final state until `useAutoAdvanceTimer`
 *     navigates away.
 *   - The 24 dot positions are hardcoded as `{x, y}` pairs in the
 *     normalised `[0, 1]` range and scaled at render time. This avoids the
 *     need for a layout-measure pass.
 *
 * Pattern parity with Phase 2.1/2.2/2.3 screens:
 *   - Props-in / callbacks-out: the screen takes a single `onElapsed`
 *     callback (and an optional `durationMs` override for tests) and never
 *     touches `expo-router`. The route wrapper at
 *     `app/(funnel)/fake-scan-animation.tsx` resolves
 *     `router.push('/(funnel)/result-reveal')` and forwards it as
 *     `onElapsed` so this screen is trivially unit-testable.
 *   - Headline + subhead come from `FUNNEL_SCREENS.fake_scan_animation`
 *     (single source of truth for Korean copy).
 *   - Layout is wrapped in the shared `FunnelScreenLayout` so the safe-area
 *     padding and background are normalised across every funnel step.
 *
 * Accessibility:
 *   - The layout root carries `accessibilityLabel="얼굴 스캔 중"` so
 *     screen-reader users hear what is happening.
 *   - The counter Text node carries a stable testID and a Korean-friendly
 *     content string (`"12 / 24"`) so the screen reader announces progress
 *     numerically — the underlying value is the same `Math.floor` snapshot
 *     used for visual rendering, so sighted and non-sighted users see the
 *     same number.
 *   - No interactive controls — the user cannot cancel the scan. This is
 *     intentional (sunk-cost design); the auto-advance timer is the only
 *     navigation out.
 */
import * as React from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { FUNNEL_SCREENS } from 'core-ts/funnel';

import { FunnelHeadline } from '../../components/FunnelHeadline';
import { FunnelScreenLayout } from '../../funnel/FunnelScreenLayout';
import { useAutoAdvanceTimer } from '../../hooks/use-auto-advance-timer';
import { COLORS, SPACING, TYPOGRAPHY } from '../../theme';

const SCREEN = FUNNEL_SCREENS.fake_scan_animation;
const METADATA = SCREEN.metadata as Readonly<{
  readonly durationMs: number;
  readonly analysisPoints: number;
}>;

/** 5,000ms default duration (from core-ts FUNNEL_SCREENS metadata). */
const DEFAULT_DURATION_MS = METADATA.durationMs;

/** 24 analysis points (from core-ts FUNNEL_SCREENS metadata). */
const POINT_COUNT = METADATA.analysisPoints;

/** Face overlay box dimensions. Calibrated for a 4-inch+ phone — wide enough
 * that the 24 dots remain individually distinguishable, tall enough that the
 * sweep line has visible travel during the 5s animation. The aspect ratio
 * (240:320 = 3:4) approximates a centred portrait crop. */
const FACE_WIDTH = 240;
const FACE_HEIGHT = 320;

/** Dot size — keep this an even integer so the centring negative-margin
 * (`-DOT_SIZE / 2`) lands on a whole pixel and never produces a subpixel
 * rounding artefact on Android. */
const DOT_SIZE = 8;

/** Sweep line thickness. */
const SWEEP_LINE_HEIGHT = 2;

/**
 * 24 hardcoded face landmark dots in normalised `[0, 1]` coordinates. The
 * positions trace a stylised "face" — forehead → brow → eyes → nose →
 * cheeks → mouth → chin — so the sweep line lighting them up in `y` order
 * reads as a top-to-bottom face scan.
 *
 * Why hardcoded (not generated from a layout-measure):
 *   The Seed constraint pins the positions to a static array scaled at
 *   render time. Measuring on layout would force a second render and
 *   complicate the animation start time — the 5s window is the only
 *   timing-sensitive moment on this screen.
 */
const FACE_POINTS: ReadonlyArray<{ readonly x: number; readonly y: number }> = [
  // Forehead row
  { x: 0.32, y: 0.1 },
  { x: 0.5, y: 0.07 },
  { x: 0.68, y: 0.1 },
  // Brow row
  { x: 0.28, y: 0.22 },
  { x: 0.4, y: 0.2 },
  { x: 0.6, y: 0.2 },
  { x: 0.72, y: 0.22 },
  // Eye row
  { x: 0.3, y: 0.32 },
  { x: 0.42, y: 0.34 },
  { x: 0.58, y: 0.34 },
  { x: 0.7, y: 0.32 },
  // Nose / mid-face row
  { x: 0.36, y: 0.45 },
  { x: 0.5, y: 0.46 },
  { x: 0.64, y: 0.45 },
  // Cheek row
  { x: 0.24, y: 0.56 },
  { x: 0.42, y: 0.58 },
  { x: 0.58, y: 0.58 },
  { x: 0.76, y: 0.56 },
  // Mouth row
  { x: 0.4, y: 0.68 },
  { x: 0.5, y: 0.7 },
  { x: 0.6, y: 0.68 },
  // Chin row
  { x: 0.36, y: 0.82 },
  { x: 0.5, y: 0.86 },
  { x: 0.64, y: 0.82 },
];

if (FACE_POINTS.length !== POINT_COUNT) {
  // Fail-loud guard — keeps the 24-point invariant pinned to core-ts.
  throw new Error(
    `FACE_POINTS length (${FACE_POINTS.length}) must equal FUNNEL_SCREENS.fake_scan_animation.metadata.analysisPoints (${POINT_COUNT}).`,
  );
}

export interface FakeScanAnimationScreenProps {
  /**
   * Fires when the 5-second sweep finishes (via `useAutoAdvanceTimer`).
   * Parent wires this to `router.push('/(funnel)/result-reveal')`.
   */
  readonly onElapsed: () => void;
  /**
   * Optional override for the timer duration. Defaults to
   * `FUNNEL_SCREENS.fake_scan_animation.metadata.durationMs` (5_000ms).
   * Provided as an escape hatch for tests that want to verify timer
   * behaviour without waiting 5 real seconds.
   */
  readonly durationMs?: number;
}

/**
 * Renders the visual face-scan animation. Mounts a single `Animated.Value`
 * (0 → 1), drives it to completion via `Animated.timing(... duration:
 * durationMs ...).start()`, and pipes the same value into:
 *
 *   - The sweep-line `top` position via `interpolate(0 → FACE_HEIGHT)`.
 *   - Each of the 24 dots' `backgroundColor` via per-dot
 *     `interpolate(thresholdLow → thresholdHigh → coral)`.
 *   - A `useState`-backed counter snapshot via a listener attached to the
 *     animated value so the rendered "X / 24" text ticks in real time.
 *
 * Cleanup contract:
 *   - `Animated.timing.stop()` is called from the effect cleanup so an
 *     unmount mid-animation does not leak callbacks.
 *   - The value listener is removed in the cleanup so post-unmount
 *     `setState` calls cannot fire.
 *   - `useAutoAdvanceTimer` owns its own cleanup; the test for the
 *     unmount-cleanup path lives there.
 */
export function FakeScanAnimationScreen(
  props: FakeScanAnimationScreenProps,
): React.ReactElement {
  const { onElapsed, durationMs = DEFAULT_DURATION_MS } = props;

  // Single Animated.Value drives every visual: sweep line, dot colours, counter.
  // Lazy-initialised via `useRef` so the instance is constructed exactly
  // once (not re-allocated on every render — the canonical `useRef(new
  // Animated.Value(0))` shortcut would evaluate `new Animated.Value(0)` on
  // every render and merely discard the extras, which is wasteful at best
  // and breaks our test's "exactly one Animated.Value was created"
  // assertion at worst).
  const progressRef = React.useRef<Animated.Value | null>(null);
  if (progressRef.current === null) {
    progressRef.current = new Animated.Value(0);
  }
  const progress: Animated.Value = progressRef.current;
  const [scannedCount, setScannedCount] = React.useState<number>(0);

  // Schedule the navigation hand-off at exactly `durationMs`. Cleanup-safe
  // on unmount by the hook's contract.
  useAutoAdvanceTimer({ durationMs, onElapsed });

  // Drive the Animated.Value 0 → 1 over `durationMs`. The listener on the
  // value updates `scannedCount` so the counter Text re-renders as the scan
  // progresses. Both the animation handle and the listener are cleaned up on
  // unmount and on `durationMs` change.
  React.useEffect((): (() => void) => {
    // Register the listener BEFORE starting the animation so the first
    // value tick (and any synchronous tick from a faster-than-realtime
    // implementation) does not slip past us. Removing the listener in the
    // cleanup is paired with `animation.stop()` so neither path can fire
    // post-unmount.
    const listenerId = progress.addListener(({ value }: { value: number }): void => {
      // Snapshot the continuous 0..1 value into a 0..24 integer for the
      // counter. `Math.floor(value * 24)` ticks the counter only when the
      // sweep line crosses a new row — clamping at POINT_COUNT keeps the
      // final state at "24 / 24" even if the value rounds slightly above 1.
      const next = Math.min(POINT_COUNT, Math.floor(value * POINT_COUNT));
      setScannedCount(next);
    });

    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: durationMs,
      easing: Easing.linear,
      // `useNativeDriver: false` — we animate `top` (layout) and
      // `backgroundColor` (style), neither of which the native driver
      // supports. The Seed constraint explicitly pins this.
      useNativeDriver: false,
    });
    animation.start();

    return (): void => {
      animation.stop();
      progress.removeListener(listenerId);
    };
  }, [progress, durationMs]);

  // Animated.View style interpolation for the sweep line `top`.
  const sweepLineTop = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, FACE_HEIGHT],
  });

  return (
    <FunnelScreenLayout
      testID="fake-scan-animation-screen"
      accessibilityLabel="얼굴 스캔 중"
    >
      <FunnelHeadline
        headline={SCREEN.headline}
        subhead={SCREEN.subhead}
        testIDPrefix="fake-scan-animation"
      />
      <View style={styles.scanArea} testID="fake-scan-animation-scan-area">
        <View
          style={styles.faceOval}
          testID="fake-scan-animation-face-oval"
        >
          {FACE_POINTS.map((point, index) => {
            const left = point.x * FACE_WIDTH;
            const top = point.y * FACE_HEIGHT;
            return (
              <FaceDot
                key={`dot-${index}`}
                index={index}
                progress={progress}
                left={left}
                top={top}
              />
            );
          })}
          <Animated.View
            style={[styles.sweepLine, { top: sweepLineTop }]}
            testID="fake-scan-animation-sweep-line"
          />
        </View>
      </View>
      <View style={styles.counterWrapper}>
        <Text
          style={styles.counter}
          testID="fake-scan-animation-counter"
          accessibilityLabel={`${scannedCount} / ${POINT_COUNT}`}
        >
          {`${scannedCount} / ${POINT_COUNT}`}
        </Text>
      </View>
    </FunnelScreenLayout>
  );
}

interface FaceDotProps {
  readonly index: number;
  readonly progress: Animated.Value;
  readonly left: number;
  readonly top: number;
}

/**
 * A single face landmark dot. The `backgroundColor` interpolates from the
 * neutral grayscale border colour to the coral accent at the moment the
 * sweep line reaches that dot's source-order index — producing the
 * "lights up in order" effect.
 *
 * Extracted into a sibling component so each dot owns its own interpolation
 * configuration (the `outputRange` is the same for every dot, but the
 * `inputRange` shifts per index). Keeping the per-dot interpolation work
 * inside the dot component prevents the parent screen from rebuilding 24
 * interpolation handles on every render.
 */
function FaceDot(props: FaceDotProps): React.ReactElement {
  const { index, progress, left, top } = props;
  // Each dot fires when `progress` crosses `(index + 1) / POINT_COUNT`. We
  // give the colour a small `0.001` ramp window so it flips cleanly without
  // a perceptible interpolation gradient — visually this reads as a discrete
  // colour change in source order, matching the "snap" expected by the
  // sunk-cost mechanism (the user sees a clear "another dot was scanned").
  const upper = (index + 1) / POINT_COUNT;
  const lower = Math.max(0, upper - 0.001);
  const backgroundColor = progress.interpolate({
    inputRange: [0, lower, upper, 1],
    outputRange: [
      COLORS.grayscale.border,
      COLORS.grayscale.border,
      COLORS.base.coral,
      COLORS.base.coral,
    ],
  });
  return (
    <Animated.View
      style={[styles.dot, { left, top, backgroundColor }]}
      testID={`fake-scan-animation-dot-${index}`}
    />
  );
}

const styles = StyleSheet.create({
  scanArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.xl,
  },
  faceOval: {
    width: FACE_WIDTH,
    height: FACE_HEIGHT,
    // BorderRadius set to half the *width* so the result is a tall vertical
    // oval (rounded-rectangle pill) — the closest pure-RN approximation of a
    // face portrait without resorting to SVG.
    borderRadius: FACE_WIDTH / 2,
    borderWidth: 2,
    borderColor: COLORS.grayscale.border,
    backgroundColor: COLORS.base.pink,
    overflow: 'hidden',
    position: 'relative',
  },
  dot: {
    position: 'absolute',
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    // Centre the dot on its (left, top) anchor so a normalised {x: 0.5,
    // y: 0.5} point lands the dot's centre at the box centre.
    marginLeft: -DOT_SIZE / 2,
    marginTop: -DOT_SIZE / 2,
  },
  sweepLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: SWEEP_LINE_HEIGHT,
    backgroundColor: COLORS.base.coral,
  },
  counterWrapper: {
    alignItems: 'center',
    paddingBottom: SPACING.xl,
  },
  counter: {
    ...TYPOGRAPHY.body.bold,
    color: COLORS.grayscale.text,
  },
});
