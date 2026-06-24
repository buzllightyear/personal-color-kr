/**
 * Route — funnel step 9 (`result_reveal`).
 *
 * Thin wrapper: expo-router hooks → derive isPreviewMode from share_token
 * route param (Phase 2.1 invariant preserved) → read isPremium from the
 * FunnelStateProvider payment slice (Phase 2.4 Seed constraint:
 * "isPremium is managed solely in FunnelStateProvider payment slice, not
 * route params") → delegate to `ResultRevealScreen` presentational
 * component.
 *
 * Externally-allowed: reachable via `/s/<token>` and `/result-reveal` deep
 * links carrying `share_token`. When the token is present `isPreviewMode`
 * is true and the screen renders read-only (no share-to-unlock CTA). When
 * absent and `isPremium === false`, the share-to-unlock CTA
 * ("친구와 공유하고 잠금 해제") renders and navigates to referral-gate
 * (step 10). When `isPremium === true` (set after the placeholder payment
 * completes), the CTA is also omitted — the locked content is unlocked.
 *
 * Phase 2.4 AC 13 — premium-branch Android hardware back interception.
 *   When `payment.isPremium === true` AND the route is focused, the
 *   Android hardware back button must NOT pop back to `payment-model` (the
 *   placeholder payment screen the user just completed). Instead it must
 *   collapse the entire funnel stack via `router.dismissAll()` so the user
 *   lands at the funnel root — preventing accidental re-entry into the
 *   placeholder payment flow after the unlock has already been recorded
 *   in the FunnelStateProvider payment slice.
 *
 *   The interception is wired here (the route file), NOT in the
 *   presentational screen component, because:
 *     - `BackHandler` and `useFocusEffect` are platform / navigation
 *       concerns that the Phase 2.4 Seed constraint pins to the route
 *       layer ("The route wrapper still owns the share_token →
 *       isPreviewMode derivation; this screen receives the flag as a
 *       prop" — same boundary applies to BackHandler).
 *     - The presentational screen stays unit-testable without a router
 *       context (mirrors how `isPreviewMode` and `onUnlock` are passed
 *       as plain props in Sub-AC 11.1).
 *
 *   `useFocusEffect` (re-exported from `@react-navigation/native` via
 *   `expo-router`) registers the handler ONLY while the screen is the
 *   focused screen on the Stack — so when the user navigates back into
 *   another funnel screen the handler is automatically unsubscribed and
 *   that screen's default back behaviour resumes. The cleanup function
 *   returned from the effect calls `subscription.remove()` on the
 *   `BackHandler.addEventListener` subscription (the RN 0.74 contract);
 *   without this cleanup the listener would leak across focus changes
 *   and a second focus would register a duplicate listener, calling
 *   `dismissAll()` twice on a single back press.
 *
 *   When `payment.isPremium === false` the effect's body is a no-op
 *   (early return) so the default Android back behaviour (pop one
 *   screen) is preserved on the non-premium branch — the Seed
 *   constraint pins BackHandler scope to "premium result-reveal
 *   screen ONLY".
 */
import * as React from 'react';
import { BackHandler } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { useFunnelState } from '../../src/hooks/use-funnel-state';
import { ResultRevealScreen } from '../../src/screens/funnel/ResultRevealScreen';

export default function ResultRevealRoute(): JSX.Element {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { payment, diagnosis } = useFunnelState();
  const shareToken =
    typeof params['share_token'] === 'string' ? params['share_token'] : undefined;
  const isPreviewMode = shareToken !== undefined;
  const { isPremium } = payment;

  // Phase 2.4 AC 13 — Android hardware-back interception on the premium
  // branch only. `useFocusEffect` ties the BackHandler subscription to the
  // focused lifecycle of this Stack screen so the listener is automatically
  // detached when the user navigates away (or this screen is unmounted),
  // satisfying the Seed constraint "BackHandler applies only to premium
  // result-reveal screen (useFocusEffect + cleanup)".
  //
  // The callback identity is memoised with `useCallback` and keyed on the
  // two dependencies (`isPremium`, `router`) so a re-render that does not
  // change those references does not re-register the listener (RN's
  // `BackHandler` would otherwise queue a duplicate handler).
  const onScreenFocus = React.useCallback((): (() => void) | undefined => {
    // Non-premium branch: do not intercept the back gesture — preserve the
    // default Stack pop behaviour. Returning `undefined` is a valid
    // useFocusEffect cleanup (no-op).
    if (!isPremium) {
      return undefined;
    }
    // Premium branch: register a hardware-back handler that collapses the
    // entire funnel stack instead of popping back into `payment-model`.
    // Returning `true` from the handler tells RN we've consumed the back
    // event and the default behaviour must NOT run.
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      (): boolean => {
        router.dismissAll();
        return true;
      },
    );
    return () => {
      subscription.remove();
    };
  }, [isPremium, router]);

  useFocusEffect(onScreenFocus);

  return (
    <ResultRevealScreen
      isPreviewMode={isPreviewMode}
      isPremium={isPremium}
      onUnlock={() => router.push('/(funnel)/referral-gate')}
      onBrowseTrends={() => router.push('/(generate)/(tabs)/catalog')}
      diagnosisResult={diagnosis.result}
    />
  );
}
