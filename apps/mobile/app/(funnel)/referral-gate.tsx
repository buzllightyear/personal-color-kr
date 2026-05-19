/**
 * Funnel route — `referral_gate` (Phase 2.4, step 10 of 12, KR variant).
 *
 * Sub-AC 17.1 scope (this file, minimum viable surface):
 *   - Default-exports an Expo Router screen component (the route contract).
 *   - Renders a stable root testID (`referral-gate-screen`) so subsequent
 *     sub-ACs can layer kakao-share / copy-link / skip controls onto a
 *     known anchor without re-bootstrapping the surface.
 *   - Acquires `useRouter()` and `useLocalSearchParams()` at module
 *     evaluation time so the import / mount path is exercised by the
 *     route-level smoke test. Navigation side effects (router.replace to
 *     `social-evolution` on share completion, router.push to
 *     `social-evolution` on skip) are intentionally NOT wired here —
 *     those land in later sub-ACs along with the real share / skip UI.
 *
 * What this route is NOT (yet):
 *   - It does NOT call `shouldBypassReferral()` from `_guards.ts`. The
 *     Phase 2.1 placeholder used that guard to surface the bypass flag in
 *     a dev-info row; Phase 2.4 replaces the placeholder with a real
 *     screen UI and the bypass decision moves to the routing layer
 *     (Phase 3/4). Calling the stub on every mount in 2.4 would emit a
 *     spurious `console.warn` for a code path that is no longer the
 *     decision-maker.
 *   - It does NOT contain Kakao SDK calls, share intents, or any payment
 *     SDK references. Per the seed constraint, all SDK interactions are
 *     `console.log` + TODO(phase-2.5) placeholders introduced by later
 *     sub-ACs — never here at the bootstrap layer.
 *   - It does NOT pass `share_token` or any PII through route params.
 *     `useLocalSearchParams()` is called for parity with other route
 *     files (so the import surface is real) but the params are not yet
 *     consumed; sub-ACs adding share-source telemetry will introduce
 *     consumption explicitly.
 *
 * External deep-link allowlist invariant:
 *   `referral-gate` is one of the 3 externally-allowed funnel kebab slugs
 *   (alongside `welcome-hook` and `result-reveal`) per
 *   `src/internal-only-routes.ts`. Reachable via `/r/<code>` deep links.
 *   The other 9 internal funnel screens remain blocked from external
 *   deep-link entry (Phase 2.1 security invariant preserved).
 */
import * as React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

export default function ReferralGateRoute(): React.ReactElement {
  // Acquire the expo-router hooks at module evaluation time so the route
  // file's import surface is exercised by the route-level smoke test. The
  // returned values are intentionally not consumed yet — sub-ACs adding
  // share / skip handlers will wire `router.push` / `router.replace` and
  // any param-driven branches explicitly.
  useRouter();
  useLocalSearchParams();

  return (
    <View style={styles.container} testID="referral-gate-screen">
      <Text style={styles.title}>referral_gate</Text>
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
