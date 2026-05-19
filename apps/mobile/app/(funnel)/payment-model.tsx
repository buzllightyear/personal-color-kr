/**
 * Funnel route — `payment_model` (Phase 2.4, step 12 of 12, KR variant).
 *
 * Sub-AC 17.3 scope (this file, minimum viable surface):
 *   - Default-exports an Expo Router screen component (the route contract).
 *   - Renders a stable root testID (`payment-model-screen`) so subsequent
 *     sub-ACs can layer the payment-method radio selection (kakao | toss),
 *     the hardcoded `PAYMENT_AMOUNT_KRW` price line, the primary "unlock"
 *     CTA, and the soft-gate skip control onto a known anchor without
 *     re-bootstrapping the surface.
 *   - Acquires `useRouter()` and `useLocalSearchParams()` at module
 *     evaluation time so the import / mount path is exercised by the
 *     route-level smoke test. Navigation side effects (router.replace to
 *     `result-reveal?premium=true` on a successful 250ms payment
 *     placeholder, router.replace to `result-reveal` on skip) are
 *     intentionally NOT wired here — those land in later sub-ACs along
 *     with the real UI and the FunnelStateProvider payment-slice writes.
 *
 * What this route is NOT (yet):
 *   - It does NOT contain KakaoPay or Toss SDK imports, network calls, or
 *     real payment intents. Per the seed contract every external payment
 *     SDK interaction is a `console.log` + `TODO(phase-2.5)` placeholder
 *     introduced by later sub-ACs (with the 250ms `setTimeout` placeholder
 *     that simulates the in-flight transaction, and a `useEffect` cleanup
 *     to neutralise the timer on unmount).
 *   - It does NOT render the payment-method radio selection, the
 *     `PAYMENT_AMOUNT_KRW` price line, the "unlock premium" primary CTA,
 *     or the soft-gate skip control. Those land in later sub-ACs on top
 *     of the testID anchor established here.
 *   - It does NOT write to the FunnelStateProvider payment slice
 *     (`isProcessing`, `isPremium`, `selectedMethod`). The slice exists
 *     in a sibling sub-AC; the writes land in the payment-action sub-AC
 *     that also wires the SDK placeholders.
 *   - It does NOT pass `payment_token`, `transaction_id`, or any payment
 *     PII through route params. `useLocalSearchParams()` is called for
 *     parity with the sibling route files (so the import surface is real)
 *     but the params are not yet consumed; future sub-ACs adding
 *     entry-source telemetry will introduce consumption explicitly.
 *   - It does NOT manage `isPremium` via route params. Per the seed
 *     contract `isPremium` is owned solely by the FunnelStateProvider
 *     payment slice; `?premium=true` on the result-reveal target is a
 *     navigation trigger only, never a source of truth.
 *
 * External deep-link invariant:
 *   `payment-model` is one of the 9 INTERNAL-ONLY funnel kebab slugs.
 *   External deep links to this slug must be redirected to `welcome-hook`
 *   per the `src/internal-only-routes.ts` allowlist (Phase 2.1 security
 *   invariant preserved — payment-related routes especially must not be
 *   reachable cold from a URL).
 */
import * as React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

export default function PaymentModelRoute(): React.ReactElement {
  // Acquire the expo-router hooks at module evaluation time so the route
  // file's import surface is exercised by the route-level smoke test. The
  // returned values are intentionally not consumed yet — sub-ACs adding
  // the "unlock premium" success path (router.replace →
  // `result-reveal?premium=true`) and the soft-gate skip path
  // (router.replace → `result-reveal`) will wire navigation explicitly.
  useRouter();
  useLocalSearchParams();

  return (
    <View style={styles.container} testID="payment-model-screen">
      <Text style={styles.title}>payment_model</Text>
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
