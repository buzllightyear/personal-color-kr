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
 */
import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import { FUNNEL_SCREENS } from 'core-ts/funnel';

import { FunnelHeadline } from '../../components/FunnelHeadline';
import { FunnelPrimaryButton } from '../../components/funnel/FunnelPrimaryButton';
import { FunnelScreenLayout } from '../../funnel/FunnelScreenLayout';
import { SPACING } from '../../theme';

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
      <View style={styles.headerStack}>
        <FunnelHeadline
          headline={SCREEN.headline}
          subhead={SCREEN.subhead}
          testIDPrefix="welcome-hook"
        />
      </View>
      <View style={styles.ctaWrapper}>
        <FunnelPrimaryButton
          label={PRIMARY_CTA.label}
          onPress={onNext}
          testID="welcome-hook-cta"
          accessibilityLabel="1분 진단 시작"
        />
      </View>
    </FunnelScreenLayout>
  );
}

const styles = StyleSheet.create({
  headerStack: {
    flex: 1,
    justifyContent: 'center',
    gap: SPACING.lg,
  },
  ctaWrapper: {
    paddingBottom: SPACING.xl,
  },
});
