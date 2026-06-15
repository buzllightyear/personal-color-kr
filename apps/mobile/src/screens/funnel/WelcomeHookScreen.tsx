/**
 * Funnel step 1 — `welcome_hook` presentational screen.
 *
 * The single external campaign-landing entry point. Renders the Korean
 * marketing hook headline + subhead from `FUNNEL_SCREENS.welcome_hook` and
 * a primary CTA that advances to step 2 (value_props).
 *
 * The route file (`app/(funnel)/welcome-hook.tsx`) is the thin wrapper that
 * pulls the `useRouter` push handler and forwards it as `onNext`; this
 * component is pure props-in/callbacks-out so it unit-tests without any
 * expo-router context.
 *
 * Visual direction — "Editorial / VSCO" (Phase: design pivot):
 *   Monochrome, type-led, and built on negative space. No coral, no halos, no
 *   decorative motifs — emptiness is the composition. The headline carries a
 *   light weight with tight optical line-height; the subhead is a small,
 *   letter-spaced mid-gray; the CTA is a flat full-width charcoal bar with
 *   wide-tracked white label. This screen is the *reference* for the broader
 *   token/component pivot (monochrome grayscale ramp + light typography +
 *   flat controls) — the styling lives locally here for the first pass so the
 *   shared `FunnelHeadline` / `FunnelPrimaryButton` primitives (and their
 *   tests) stay untouched until the direction is approved and rolled out.
 *
 *   The `welcome-hook-headline` / `welcome-hook-subhead` / `welcome-hook-cta`
 *   testIDs, the Korean copy from `FUNNEL_SCREENS`, and the CTA accessibility
 *   contract are all preserved.
 */
import * as React from 'react';
import { Pressable, StyleSheet, Text, View, type PressableStateCallbackType } from 'react-native';
import { FUNNEL_SCREENS } from 'core-ts/funnel';

import { FunnelScreenLayout } from '../../funnel/FunnelScreenLayout';
import { COLORS } from '../../theme';

export interface WelcomeHookScreenProps {
  /** Invoked when the user taps the primary CTA. Parent wires to `router.push('/(funnel)/value-props')`. */
  readonly onNext: () => void;
}

const SCREEN = FUNNEL_SCREENS.welcome_hook;

function requirePrimaryCta(): { readonly label: string } {
  const cta = SCREEN.ctas[0];
  if (cta === undefined) {
    throw new Error('FUNNEL_SCREENS.welcome_hook is missing its primary CTA');
  }
  return cta;
}

const PRIMARY_CTA = requirePrimaryCta();

/** Editorial monochrome ink + supporting grays (reference values; promoted to tokens on rollout). */
const INK = COLORS.grayscale.text; // #1A1A1A
const MUTED = '#8A8A8A';

export function WelcomeHookScreen(props: WelcomeHookScreenProps): React.ReactElement {
  const { onNext } = props;

  const ctaStyle = React.useCallback(
    (state: PressableStateCallbackType) =>
      state.pressed ? [styles.cta, styles.ctaPressed] : styles.cta,
    [],
  );

  return (
    <FunnelScreenLayout testID="welcome-hook-screen" accessibilityLabel="환영합니다">
      <View style={styles.root}>
        {/* Type block sits low in the frame, letting the top breathe (VSCO move). */}
        <View style={styles.typeBlock}>
          <Text style={styles.headline} testID="welcome-hook-headline" accessibilityRole="header">
            {SCREEN.headline}
          </Text>
          <Text style={styles.subhead} testID="welcome-hook-subhead" accessibilityRole="header">
            {SCREEN.subhead}
          </Text>
        </View>

        <Pressable
          onPress={onNext}
          style={ctaStyle}
          testID="welcome-hook-cta"
          accessibilityRole="button"
          accessibilityLabel="1분 진단 시작"
        >
          <Text style={styles.ctaLabel}>{PRIMARY_CTA.label}</Text>
        </Pressable>
      </View>
    </FunnelScreenLayout>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  typeBlock: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingBottom: 40,
  },
  headline: {
    fontFamily: 'Pretendard-Light', // the editorial light signature
    fontSize: 32,
    lineHeight: 44,
    letterSpacing: -0.3,
    color: INK,
  },
  subhead: {
    fontFamily: 'Pretendard-Regular',
    marginTop: 16,
    fontSize: 14,
    lineHeight: 22,
    letterSpacing: 0.3,
    color: MUTED,
  },
  cta: {
    backgroundColor: INK,
    paddingVertical: 18,
    borderRadius: 2, // near-square; flat, no shadow
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaPressed: {
    opacity: 0.8,
  },
  ctaLabel: {
    fontFamily: 'Pretendard-Medium',
    fontSize: 13,
    letterSpacing: 1.5, // wide tracking — the VSCO label rhythm
    color: COLORS.grayscale.background,
  },
});
