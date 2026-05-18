/**
 * Funnel Step 10 — referral_gate (KR variant)
 *
 * Korean-market variant: 1-friend referral gate (replaces the standard 50%
 * discount gate).  Placeholder Expo Router file — richer dev-info UI and
 * the `shouldBypassReferral()` guard wiring are added by subsequent
 * acceptance criteria in the same work unit.
 *
 * Step config lives in
 *   packages/core-ts/src/funnel/screens.ts → FUNNEL_SCREENS.referral_gate
 *
 * Route-params contract: none (empty params; internal-only screen).
 */
import { View, Text, StyleSheet } from 'react-native';

export default function ReferralGateScreen(): JSX.Element {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Funnel Step 10 of 12</Text>
      <Text style={styles.subtitle}>referral_gate (kr_variant)</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  title: { fontSize: 20, fontWeight: '600' },
  subtitle: { fontSize: 14, opacity: 0.6, marginTop: 4 },
});
