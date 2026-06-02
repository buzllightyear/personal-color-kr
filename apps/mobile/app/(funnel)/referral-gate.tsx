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
 * PostHog analytics wiring (Phase 2.6 — client pass-through DI):
 *   - `trackReferralShared({ method })` and `trackReferralSkipped({})` now
 *     accept a `PostHog | undefined` client as their first argument. The
 *     route resolves the singleton via `usePostHog()` (the hook returns
 *     `undefined` when the provider is in degraded mode — no api key in
 *     `.env`) and closes over the result inside each `useCallback` handler.
 *   - The track helpers degrade silently when `posthog` is `undefined`
 *     (optional-chain guard on `capture`) so the share / skip handlers
 *     never throw even with the SDK absent. This matches the Seed
 *     constraint "Degraded mode posthog undefined must produce silent
 *     no-op".
 *
 * Real share-URL wiring (Phase 4.5 — this revision):
 *   - The two share buttons no longer noop. On tap they fetch the
 *     *server-assembled* `share_url` from `GET /v1/referrals/me` (the server
 *     is the single source of truth — the client carries no
 *     `REFERRAL_BASE_URL` constant and never assembles the URL) and hand it
 *     to the OS share sheet via `shareReferralLink` → `presentReferralShare`.
 *   - The transport is built once via `createReferralMeTransport` against the
 *     `EXPO_PUBLIC_API_BASE_URL` origin. The backend JWT is forwarded by the
 *     auth-session store once that lands; until then the request degrades
 *     silently (the share gate is soft — `shareReferralLink` swallows
 *     fetch/auth failures), so navigation is always preserved.
 *   - No real Kakao SDK call (deferred): the OS share sheet is used, not the
 *     Kakao SDK. Both share buttons still route through the same
 *     `setReferral({ shared: true })` write so the funnel-state contract
 *     treats them identically.
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
import { usePostHog } from 'posthog-react-native';

import { trackReferralShared } from '../../src/analytics/track-referral-shared';
import { trackReferralSkipped } from '../../src/analytics/track-referral-skipped';
import { createReferralMeTransport } from '../../src/fetch-referral-me';
import { useFunnelState } from '../../src/hooks/use-funnel-state';
import { presentReferralShare } from '../../src/present-referral-share';
import { shareReferralLink } from '../../src/share-referral-link';
import { ReferralGateScreen } from '../../src/screens/funnel/ReferralGateScreen';

export default function ReferralGateRoute(): React.ReactElement {
  const router = useRouter();
  const { setReferral } = useFunnelState();
  // One real `fetch`-backed transport for `GET /v1/referrals/me`, memoised so
  // the share handlers share a single instance. The backend JWT is supplied
  // by the auth-session store once wired; until then the request degrades
  // silently (the share gate is soft) and navigation is always preserved.
  const referralMeTransport = React.useMemo(() => createReferralMeTransport(), []);
  // `usePostHog()` returns `PostHog | undefined`. The `undefined` branch is
  // the documented degraded-mode contract (no api key in `.env` → provider
  // renders a fragment, no context value). The track helpers below
  // optional-chain on `capture`, so passing `undefined` is a silent no-op
  // by design — no throw, no console output, capture call count is 0.
  const posthog = usePostHog();

  const handleShareKakao = React.useCallback((): void => {
    trackReferralShared(posthog, { method: 'kakao' });
    // Fetch the server `share_url` and open the OS share sheet. Fire-and-
    // -forget: `shareReferralLink` degrades silently on failure, so the
    // funnel-state write + navigation below never wait on (or break with)
    // the network call — the gate stays soft.
    void shareReferralLink('kakao', {
      transport: referralMeTransport,
      present: presentReferralShare,
    });
    setReferral({ shared: true });
    router.replace('/(funnel)/social-evolution');
  }, [posthog, referralMeTransport, router, setReferral]);

  const handleCopyLink = React.useCallback((): void => {
    trackReferralShared(posthog, { method: 'copy_link' });
    void shareReferralLink('copy_link', {
      transport: referralMeTransport,
      present: presentReferralShare,
    });
    setReferral({ shared: true });
    router.replace('/(funnel)/social-evolution');
  }, [posthog, referralMeTransport, router, setReferral]);

  const handleSkip = React.useCallback((): void => {
    trackReferralSkipped(posthog, {});
    router.push('/(funnel)/social-evolution');
  }, [posthog, router]);

  return (
    <ReferralGateScreen
      onShareKakao={handleShareKakao}
      onCopyLink={handleCopyLink}
      onSkip={handleSkip}
    />
  );
}
