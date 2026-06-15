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
 * Visual direction — "Editorial / VSCO":
 *   Monochrome and type-led, built on negative space. The hook headline +
 *   subhead (shared `FunnelHeadline`, now Pretendard Light) sit low in the
 *   frame so the top breathes; the primary CTA (shared `FunnelPrimaryButton`,
 *   now a flat charcoal bar) rests at the bottom. All visual tokens live in
 *   the shared primitives, so this screen only owns its vertical composition.
 */
import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import { FUNNEL_SCREENS } from 'core-ts/funnel';

import { FunnelHeadline } from '../../components/FunnelHeadline';
import { FunnelPrimaryButton } from '../../components/funnel/FunnelPrimaryButton';
import { FunnelScreenLayout } from '../../funnel/FunnelScreenLayout';

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

export function WelcomeHookScreen(props: WelcomeHookScreenProps): React.ReactElement {
  const { onNext } = props;

  return (
    <FunnelScreenLayout testID="welcome-hook-screen" accessibilityLabel="환영합니다">
      <View style={styles.typeBlock}>
        <FunnelHeadline
          headline={SCREEN.headline}
          subhead={SCREEN.subhead}
          testIDPrefix="welcome-hook"
        />
      </View>
      <FunnelPrimaryButton
        label={PRIMARY_CTA.label}
        onPress={onNext}
        testID="welcome-hook-cta"
        accessibilityLabel="1분 진단 시작"
      />
    </FunnelScreenLayout>
  );
}

const styles = StyleSheet.create({
  // The headline block fills the frame and sits at the bottom edge of that
  // space, leaving generous negative space above (the editorial move).
  typeBlock: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingBottom: 40,
  },
});
