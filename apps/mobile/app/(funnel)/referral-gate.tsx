/**
 * Funnel route — `referral_gate` (Phase 2.4, step 10 of 12, KR variant).
 *
 * Thin Expo Router wrapper that:
 *   1. Acquires `useRouter()` for navigation side effects.
 *   2. Reads `setReferral` from `FunnelStateProvider` via `useFunnelState()`
 *      so the share-completion path can flip `referral.shared` to `true`.
 *      The route writes the slice — the presentational `ReferralGateScreen`
 *      component stays pure props-in / callbacks-out (matches the pattern
 *      established by every other funnel route in Phases 2.1–2.3).
 *   3. Delegates rendering to `ReferralGateScreen` with three handlers wired
 *      to the seed's navigation contract.
 *
 * Navigation contract (per Seed):
 *   - Share completion (kakao OR copy_link) →
 *     `router.replace('/(funnel)/social-evolution')`. Replace (not push) so
 *     the user cannot back-swipe from `social_evolution` into the just-
 *     completed share gate (would only re-share the same content).
 *   - Skip CTA → `router.push('/(funnel)/social-evolution')`. Push (not
 *     replace) so the back-swipe path from `social_evolution` back to
 *     `referral_gate` remains intact — the `shared=false` upsell branch on
 *     `social_evolution` links the user BACK here to share.
 *
 * Placeholder side effects (Seed constraint:
 *   "All external SDK interactions are noop placeholders with TODO
 *   comments"):
 *   - `trackReferralShared({ method: 'kakao' | 'copy_link' })` and
 *     `trackReferralSkipped({})` are `console.log` wrappers under
 *     `src/analytics/` that will swap to `posthog.capture(...)` in
 *     Phase 2.5.
 *   - No real Kakao SDK call, no clipboard write — both share buttons
 *     route through the same `setReferral({ shared: true })` write so the
 *     funnel-state contract treats them identically.
 *
 * External deep-link allowlist invariant:
 *   `referral-gate` is one of the 3 externally-allowed funnel kebab slugs
 *   (alongside `welcome-hook` and `result-reveal`) per
 *   `src/internal-only-routes.ts`. Reachable via `/r/<code>` deep links.
 *   The other 9 internal funnel screens remain blocked from external
 *   deep-link entry (Phase 2.1 security invariant preserved).
 */
import * as React from 'react';
import { useRouter } from 'expo-router';

import { trackReferralShared } from '../../src/analytics/track-referral-shared';
import { trackReferralSkipped } from '../../src/analytics/track-referral-skipped';
import { useFunnelState } from '../../src/hooks/use-funnel-state';
import { ReferralGateScreen } from '../../src/screens/funnel/ReferralGateScreen';

export default function ReferralGateRoute(): React.ReactElement {
  const router = useRouter();
  const { setReferral } = useFunnelState();

  const handleShareKakao = React.useCallback((): void => {
    trackReferralShared({ method: 'kakao' });
    setReferral({ shared: true });
    router.replace('/(funnel)/social-evolution');
  }, [router, setReferral]);

  const handleCopyLink = React.useCallback((): void => {
    trackReferralShared({ method: 'copy_link' });
    setReferral({ shared: true });
    router.replace('/(funnel)/social-evolution');
  }, [router, setReferral]);

  const handleSkip = React.useCallback((): void => {
    trackReferralSkipped({});
    router.push('/(funnel)/social-evolution');
  }, [router]);

  return (
    <ReferralGateScreen
      onShareKakao={handleShareKakao}
      onCopyLink={handleCopyLink}
      onSkip={handleSkip}
    />
  );
}
