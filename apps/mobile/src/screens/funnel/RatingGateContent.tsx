/**
 * Funnel step 4 — `rating_gate` shared presentational content.
 *
 * The route file (`app/(funnel)/rating-gate.tsx`) keeps the Platform.select
 * variant selector from Phase 2.1 (iOS default / Android secondary stubs)
 * and renders this content under each variant. Both variants render the
 * same submit + skip buttons; the variant selector exists for Phase 3+
 * native bridge wiring.
 *
 * Both CTAs advance to fake-loader (step 5) — submit_rating and skip both
 * navigate forward. dismissable:true is implemented by always allowing the
 * skip path to proceed.
 */
import * as React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { FUNNEL_SCREENS } from 'core-ts/funnel';

import { FunnelHeadline } from '../../components/FunnelHeadline';
import { FunnelPrimaryButton } from '../../components/funnel/FunnelPrimaryButton';
import { FunnelScreenLayout } from '../../funnel/FunnelScreenLayout';
import { COLORS, SPACING, TYPOGRAPHY } from '../../theme';

export interface RatingGateContentProps {
  readonly onSubmit: () => void;
  readonly onSkip: () => void;
  /** Identifier for the variant (ios/android) — wired into testIDs. */
  readonly variant: 'default' | 'secondary';
}

const SCREEN = FUNNEL_SCREENS.rating_gate;

function getCtaByAction(action: string): { readonly label: string } {
  const cta = SCREEN.ctas.find((c) => c.action === action);
  if (cta === undefined) {
    throw new Error(`rating_gate is missing CTA with action=${action}`);
  }
  return cta;
}

const SUBMIT_CTA = getCtaByAction('submit_rating');
const SKIP_CTA = getCtaByAction('skip');

export function RatingGateContent(props: RatingGateContentProps): React.ReactElement {
  const { onSubmit, onSkip, variant } = props;
  return (
    <FunnelScreenLayout
      testID={`rating-gate-${variant}-screen`}
      accessibilityLabel="별점 부탁"
    >
      <View style={styles.body}>
        <FunnelHeadline
          headline={SCREEN.headline}
          subhead={SCREEN.subhead}
          testIDPrefix="rating-gate"
        />
      </View>
      <View style={styles.ctaStack}>
        <FunnelPrimaryButton
          label={SUBMIT_CTA.label}
          onPress={onSubmit}
          testID="rating-gate-submit"
          accessibilityLabel="별점 남기기"
        />
        <Pressable
          onPress={onSkip}
          style={styles.skipButton}
          testID="rating-gate-skip"
          accessibilityRole="button"
          accessibilityLabel="나중에"
        >
          <Text style={styles.skipLabel}>{SKIP_CTA.label}</Text>
        </Pressable>
      </View>
    </FunnelScreenLayout>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    justifyContent: 'center',
  },
  ctaStack: {
    gap: SPACING.md,
    paddingBottom: SPACING.xl,
  },
  skipButton: {
    paddingVertical: SPACING.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipLabel: {
    ...TYPOGRAPHY.button.medium,
    color: COLORS.grayscale.disabled,
  },
});
