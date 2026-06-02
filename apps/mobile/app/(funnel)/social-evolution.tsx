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
 *   - `shared === true` — renders the `SocialEvolutionSharedTrueBranch`
 *     empty-state share-confirmation surface with a "다음으로" continue CTA
 *     that `router.push`es forward to `payment_model`. The branch never
 *     re-renders a share control (Seed: "no duplicate share functionality
 *     on social_evolution"); it acknowledges the prior share and forwards.
 *
 * Navigation contract (per Seed):
 *   - `router.push('/(funnel)/referral-gate')` on shared=false "share again"
 *     CTA. Push (not replace) so the back-swipe path back to social_evolution
 *     remains intact if the user later shares on referral_gate.
 *   - `router.push('/(funnel)/payment-model')` on shared=false skip CTA.
 *     Push (not replace) so the back-swipe path back to social_evolution
 *     remains intact for the same reason.
 *   - `router.push('/(funnel)/payment-model')` on the shared=true forward
 *     CTA. Same push semantics for back-swipe symmetry.
 *
 * Real friend-count wiring (Phase 4.5 — this revision):
 *   - On the shared=true branch the route fetches the live
 *     `friend_used_count` from `GET /v1/referrals/me` (the server is the
 *     single source of truth — the client never aggregates) and passes it to
 *     `SocialEvolutionSharedTrueBranch`, which renders the real count
 *     (`친구 N명이 참여했어요`) when positive and the original empty state
 *     otherwise.
 *   - The fetch is fire-and-forget inside a `useEffect` guarded by an
 *     `active` flag (no setState after unmount). Failures are swallowed —
 *     the count stays `null` → empty state — so a network/auth error never
 *     breaks this soft gate (Seed: silent degradation). The transport is
 *     built once via `createReferralMeTransport`; the effect only runs on the
 *     shared=true branch (the shared=false branch shows no count).
 *
 * PostHog analytics wiring (Phase 2.6 — client pass-through DI):
 *   - `trackSocialEvolutionSkipped({})` now accepts a `PostHog | undefined`
 *     client as its first argument. The route resolves the singleton via
 *     `usePostHog()` (the hook returns `undefined` when the provider is in
 *     degraded mode — no api key in `.env`) and closes over the result
 *     inside each `useCallback` handler.
 *   - Both call-sites (the shared=false skip CTA and the shared=true
 *     forward CTA) invoke `trackSocialEvolutionSkipped(posthog, {})`. The
 *     helper degrades silently when `posthog` is `undefined`
 *     (optional-chain guard on `capture`) so the handlers never throw even
 *     with the SDK absent. This matches the Seed constraint
 *     "Degraded mode posthog undefined must produce silent no-op".
 *   - Handlers are defined with `React.useCallback` before the conditional
 *     branch so the rules-of-hooks invariant holds across both render
 *     paths (the unused `handleContinue` on the shared=false branch and
 *     the unused `handleSkip`/`handleShareAgain` on the shared=true
 *     branch incur no runtime cost — the callbacks are stable references
 *     and never invoked outside their owning branch).
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
import { useRouter } from 'expo-router';
import { usePostHog } from 'posthog-react-native';

import { trackSocialEvolutionSkipped } from '../../src/analytics/track-social-evolution-skipped';
import {
  createReferralMeTransport,
  fetchReferralMe,
} from '../../src/fetch-referral-me';
import { useFunnelState } from '../../src/hooks/use-funnel-state';
import { SocialEvolutionSharedFalseBranch } from '../../src/screens/funnel/SocialEvolutionSharedFalseBranch';
import { SocialEvolutionSharedTrueBranch } from '../../src/screens/funnel/SocialEvolutionSharedTrueBranch';

export default function SocialEvolutionRoute(): React.ReactElement {
  const router = useRouter();
  const { referral } = useFunnelState();
  // One real `fetch`-backed transport for `GET /v1/referrals/me`, memoised so
  // the friend-count effect reuses a single instance. The backend JWT is
  // supplied by the auth-session store once wired; until then the request
  // degrades silently (see the effect below).
  const referralMeTransport = React.useMemo(() => createReferralMeTransport(), []);
  // Live `friend_used_count` from the server (single source of truth). `null`
  // while the fetch is in-flight, fails, or the gate has not been shared —
  // the shared=true branch renders the empty state for `null`/`0`, so a
  // silent fetch failure degrades gracefully rather than crashing the soft
  // gate (Seed: silent degradation; share_url/count are server-owned).
  const [friendUsedCount, setFriendUsedCount] = React.useState<number | null>(null);

  // Fetch the friend-used count only on the shared=true branch — the
  // empty/false branch never shows a count. Guarded by an `active` flag so a
  // late-resolving response cannot setState after unmount. Failures are
  // swallowed (the count stays `null` → empty state) so the soft gate never
  // breaks on a network/auth error.
  React.useEffect(() => {
    if (!referral.shared) {
      return undefined;
    }
    let active = true;
    void (async (): Promise<void> => {
      try {
        const { friendUsedCount: count } = await fetchReferralMe(referralMeTransport);
        if (active) {
          setFriendUsedCount(count);
        }
      } catch {
        // Silent degradation — leave the count `null` (empty state).
      }
    })();
    return (): void => {
      active = false;
    };
  }, [referral.shared, referralMeTransport]);
  // `usePostHog()` returns `PostHog | undefined`. The `undefined` branch is
  // the documented degraded-mode contract (no api key in `.env` → provider
  // renders a fragment, no context value). `trackSocialEvolutionSkipped`
  // optional-chains on `capture`, so passing `undefined` is a silent no-op
  // by design — no throw, no console output, capture call count is 0.
  const posthog = usePostHog();

  // Handlers are defined unconditionally (before the branch split) so the
  // rules-of-hooks invariant holds across re-renders that flip between the
  // shared=false and shared=true branches.
  const handleShareAgain = React.useCallback((): void => {
    router.push('/(funnel)/referral-gate');
  }, [router]);

  const handleSkip = React.useCallback((): void => {
    trackSocialEvolutionSkipped(posthog, {});
    router.push('/(funnel)/payment-model');
  }, [posthog, router]);

  const handleContinue = React.useCallback((): void => {
    trackSocialEvolutionSkipped(posthog, {});
    router.push('/(funnel)/payment-model');
  }, [posthog, router]);

  if (!referral.shared) {
    return (
      <SocialEvolutionSharedFalseBranch
        onShareAgain={handleShareAgain}
        onSkip={handleSkip}
      />
    );
  }

  return (
    <SocialEvolutionSharedTrueBranch
      onContinue={handleContinue}
      friendUsedCount={friendUsedCount}
    />
  );
}
