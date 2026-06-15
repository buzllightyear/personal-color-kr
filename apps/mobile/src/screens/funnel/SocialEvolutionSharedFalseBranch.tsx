/**
 * Funnel step 11 — `social_evolution` shared=false branch (Phase 2.4, KR variant).
 *
 * Sibling to the shared=true empty-state branch. Both branches live under the
 * single `social_evolution` route file (`app/(funnel)/social-evolution.tsx`);
 * the route reads `referral.shared` from `FunnelStateProvider` and chooses
 * which branch component to render. This file owns ONLY the shared=false
 * upsell surface.
 *
 * What this branch renders:
 *   1. The canonical `FUNNEL_SCREENS.social_evolution` headline + subhead
 *      typography group (so the social-proof framing is consistent across
 *      both shared=true and shared=false branches — only the CTA row
 *      differs).
 *   2. An upsell card explaining WHY the user should go back to
 *      `referral_gate` and share with a friend to unlock the next step.
 *      The card is a presentational `<View>` (no Pressable, no animation)
 *      and uses the project's soft-pink surface tint to read as a
 *      friendly nudge rather than a hard gate.
 *   3. The primary "친구에게 공유하기" CTA. Tapping fires `onShareAgain` —
 *      the route file wires that to `router.push('/(funnel)/referral-gate')`,
 *      which is the canonical share surface (per Seed:
 *      "shared=false social_evolution links back to referral_gate for
 *      sharing — no duplicate share functionality on social_evolution").
 *      The CTA label is sourced from the frozen
 *      `SOCIAL_EVOLUTION_SHARE_AGAIN_CTA_LABEL` constant — never a string
 *      literal — so a localisation update flows through one file.
 *   4. A quiet "나중에 할게요" skip CTA. Even though the user did not
 *      share, the soft-gate invariant ("All 3 screens are soft gates with
 *      skip options — no hard gating blocks progression") requires a
 *      forward path. Tapping fires `onSkip`; the route file wires that to
 *      `router.push('/(funnel)/payment-model')` so the user lands on step
 *      12 without revisiting `referral_gate`.
 *
 * What this branch is NOT:
 *   - Not a share-action emitter. The Seed pins all share functionality to
 *     `referral_gate`. No Kakao SDK calls, no copy-link calls, no
 *     `onShareKakao` / `onCopyLink` props. The primary CTA is purely a
 *     navigation handle BACK to the canonical share surface.
 *   - Not aware of its caller's navigation source. The component receives
 *     `onShareAgain` and `onSkip` callbacks; whether they invoke
 *     `router.push` or `router.replace` is the route file's choice (per
 *     Seed: "router.push used at: ... social_evolution shared=false →
 *     referral_gate, social_evolution → payment_model").
 *   - Not a payment surface. Payment lives at step 12 (`payment_model`).
 *     The skip CTA navigates forward to payment_model but does not itself
 *     simulate any payment.
 *   - Not a state writer. The branch does not call `setReferral` or any
 *     other slice updater — the upsell only routes the user back to
 *     `referral_gate`, which is the slice's authoritative write site.
 *
 * Pattern alignment:
 *   - Uses `FunnelScreenLayout` for safe-area + edge padding (same shared
 *     frame as every other funnel screen).
 *   - Uses `FunnelHeadline` for the typography group (sourced from
 *     `FUNNEL_SCREENS.social_evolution`).
 *   - Uses `FunnelPrimaryButton` for the primary CTA (coral pill).
 *   - Uses a plain `Pressable` + text for the skip CTA, matching the
 *     `RatingGateContent` skip pattern so the two soft-gate surfaces read
 *     identically.
 *   - All text colours, spacing, and radii pull from design tokens —
 *     zero hard-coded values.
 */
import * as React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { FUNNEL_SCREENS } from 'core-ts/funnel';

import { FunnelHeadline } from '../../components/FunnelHeadline';
import { FunnelPrimaryButton } from '../../components/funnel/FunnelPrimaryButton';
import {
  SOCIAL_EVOLUTION_SHARE_AGAIN_CTA_LABEL,
  SOCIAL_EVOLUTION_SKIP_CTA_LABEL,
} from '../../funnel/social-evolution-ctas';
import { FunnelScreenLayout } from '../../funnel/FunnelScreenLayout';
import { SPACING } from '../../theme';
import { FONT, INK } from '../../theme/editorial';

/**
 * Korean upsell copy rendered inside the soft-pink nudge card. The card body
 * explains the value of going back to `referral_gate` to share — kept here
 * as a frozen module constant so a Phase 2.5 copy review changes one line
 * rather than digging through JSX.
 *
 * The headline + subhead above the card already carry the proof message
 * (UGC + influencer + 12만+ user count) from `FUNNEL_SCREENS.social_evolution`;
 * this card adds the specific "share with one friend to continue" upsell so
 * the user understands WHY the CTA routes back to step 10 rather than
 * forward to step 12.
 */
export const SOCIAL_EVOLUTION_UPSELL_TITLE =
  '친구 1명에게 진단을 공유하면 다음으로 넘어가요' as const;
export const SOCIAL_EVOLUTION_UPSELL_BODY =
  '실제 사용자 12만+ 명이 이렇게 함께 시작했어요. 카카오톡 공유 또는 링크 복사로 친구에게 진단을 보내고 결과를 이어서 확인하세요.' as const;

const SCREEN = FUNNEL_SCREENS.social_evolution;

/**
 * Props for {@link SocialEvolutionSharedFalseBranch}.
 *
 * Both callbacks are required — there is no "no-op" default. The route
 * file always provides real navigation handlers; tests pass `vi.fn()` spies
 * to assert the callbacks fire on the expected presses.
 */
export interface SocialEvolutionSharedFalseBranchProps {
  /**
   * Invoked when the user taps the primary "친구에게 공유하기" CTA. The
   * route file wires this to `router.push('/(funnel)/referral-gate')` so
   * the user lands on the canonical share surface — `social_evolution`
   * itself MUST NOT render share controls (Seed constraint).
   */
  readonly onShareAgain: () => void;
  /**
   * Invoked when the user taps the quiet "나중에 할게요" skip CTA. The
   * route file wires this to `router.push('/(funnel)/payment-model')` so
   * the user advances forward to step 12 without revisiting step 10. The
   * soft-gate invariant requires this forward path even when the user
   * has not yet shared.
   */
  readonly onSkip: () => void;
}

/**
 * shared=false branch of `social_evolution` — renders the upsell card and
 * the back-to-`referral_gate` CTA pair.
 *
 * Pure props-in / callbacks-out. Owns no React state of its own — the
 * branch selection (shared=true vs. shared=false) happens in the route
 * file via `useFunnelState().referral.shared`, and the navigation side
 * effects are the route file's concern.
 */
export function SocialEvolutionSharedFalseBranch(
  props: SocialEvolutionSharedFalseBranchProps,
): React.ReactElement {
  const { onShareAgain, onSkip } = props;

  return (
    <FunnelScreenLayout
      testID="social-evolution-shared-false-branch"
      accessibilityLabel="친구에게 공유하고 다음 단계로"
    >
      <View style={styles.body}>
        <FunnelHeadline
          headline={SCREEN.headline}
          subhead={SCREEN.subhead}
          testIDPrefix="social-evolution-shared-false"
        />
        <View
          style={styles.upsellCard}
          testID="social-evolution-shared-false-upsell-card"
          accessibilityLabel="공유 안내 카드"
        >
          <Text
            style={styles.upsellTitle}
            testID="social-evolution-shared-false-upsell-title"
          >
            {SOCIAL_EVOLUTION_UPSELL_TITLE}
          </Text>
          <Text
            style={styles.upsellBody}
            testID="social-evolution-shared-false-upsell-body"
          >
            {SOCIAL_EVOLUTION_UPSELL_BODY}
          </Text>
        </View>
      </View>
      <View style={styles.ctaStack}>
        <FunnelPrimaryButton
          label={SOCIAL_EVOLUTION_SHARE_AGAIN_CTA_LABEL}
          onPress={onShareAgain}
          testID="social-evolution-shared-false-share-again"
          accessibilityLabel={SOCIAL_EVOLUTION_SHARE_AGAIN_CTA_LABEL}
        />
        <Pressable
          onPress={onSkip}
          style={styles.skipButton}
          testID="social-evolution-shared-false-skip"
          accessibilityRole="button"
          accessibilityLabel={SOCIAL_EVOLUTION_SKIP_CTA_LABEL}
        >
          <Text style={styles.skipLabel}>{SOCIAL_EVOLUTION_SKIP_CTA_LABEL}</Text>
        </Pressable>
      </View>
    </FunnelScreenLayout>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    justifyContent: 'center',
    gap: SPACING.xl,
  },
  // Editorial nudge: a neutral wash panel with a hairline, not a pink tint.
  upsellCard: {
    backgroundColor: INK.wash,
    borderWidth: 1,
    borderColor: INK.line,
    borderRadius: 2,
    padding: SPACING.lg,
    gap: SPACING.sm,
  },
  upsellTitle: {
    fontFamily: FONT.medium,
    fontSize: 17,
    color: INK.primary,
  },
  upsellBody: {
    fontFamily: FONT.regular,
    fontSize: 14,
    lineHeight: 22,
    color: INK.muted,
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
    fontFamily: FONT.medium,
    fontSize: 13,
    letterSpacing: 0.5,
    color: INK.muted,
  },
});
