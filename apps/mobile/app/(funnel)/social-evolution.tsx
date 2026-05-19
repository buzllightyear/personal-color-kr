/**
 * Funnel route — `social_evolution` (Phase 2.4, step 11 of 12, KR variant).
 *
 * Two-branch route: reads `referral.shared` from `FunnelStateProvider` via
 * the `useFunnelState()` hook and selects which presentational branch to
 * render:
 *
 *   - `shared === false` (default initial state) — renders the
 *     `SocialEvolutionSharedFalseBranch` upsell card with a
 *     "친구에게 공유하기" primary CTA that `router.push`es BACK to
 *     `referral_gate` (the single source of truth for share functionality
 *     per Seed: "no duplicate share functionality on social_evolution") and
 *     a "나중에 할게요" skip CTA that `router.push`es forward to
 *     `payment_model` so the soft-gate invariant holds.
 *
 *   - `shared === true` — renders the empty-state share-confirmation
 *     branch (handled by the sibling AC; placeholder retained here until
 *     that branch component lands).
 *
 * Navigation contract (per Seed):
 *   - `router.push('/(funnel)/referral-gate')` on shared=false "share again"
 *     CTA. Push (not replace) so the back-swipe path back to social_evolution
 *     remains intact if the user later shares on referral_gate.
 *   - `router.push('/(funnel)/payment-model')` on shared=false skip CTA.
 *     Push (not replace) so the back-swipe path back to social_evolution
 *     remains intact for the same reason.
 *   - `router.push('/(funnel)/payment-model')` on the eventual shared=true
 *     forward CTA (handled by sibling AC).
 *
 * What this route is NOT:
 *   - Not a state writer. The route only READS `referral.shared` from the
 *     funnel context — the slice is written exclusively at `referral_gate`
 *     (per the Phase 2.4 contract). A user landing here from a back-swipe
 *     after sharing sees the shared=true branch automatically because the
 *     context update re-renders the route.
 *   - Not a payment surface. The skip CTA navigates forward to
 *     payment_model but does not itself simulate any payment.
 *   - Not a Kakao SDK / share emitter. The "share again" CTA is purely a
 *     navigation handle BACK to `referral_gate`.
 *
 * External deep-link invariant:
 *   `social-evolution` is one of the 9 INTERNAL-ONLY funnel kebab slugs.
 *   External deep links to this slug must be redirected to `welcome-hook`
 *   per the `src/internal-only-routes.ts` allowlist (Phase 2.1 security
 *   invariant preserved).
 */
import * as React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { useFunnelState } from '../../src/hooks/use-funnel-state';
import { SocialEvolutionSharedFalseBranch } from '../../src/screens/funnel/SocialEvolutionSharedFalseBranch';

export default function SocialEvolutionRoute(): React.ReactElement {
  const router = useRouter();
  // `useLocalSearchParams` is called for parity with the rest of the funnel
  // route surface; Phase 2.4 does not yet consume any params here (the
  // branch selection comes from the context, not the URL).
  useLocalSearchParams();
  const { referral } = useFunnelState();

  // shared=false branch — the default initial state. Renders the
  // upsell-to-share card with the CTA that routes BACK to `referral_gate`.
  if (!referral.shared) {
    const handleShareAgain = (): void => {
      router.push('/(funnel)/referral-gate');
    };
    const handleSkip = (): void => {
      router.push('/(funnel)/payment-model');
    };
    return (
      <SocialEvolutionSharedFalseBranch
        onShareAgain={handleShareAgain}
        onSkip={handleSkip}
      />
    );
  }

  // shared=true branch — empty-state share-confirmation surface. Handled
  // by the sibling AC; this placeholder retains the original
  // `social-evolution-screen` testID so the existing route-level smoke
  // test still passes until the real branch component lands.
  return (
    <View style={styles.container} testID="social-evolution-screen">
      <Text style={styles.title}>social_evolution</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
  },
});
