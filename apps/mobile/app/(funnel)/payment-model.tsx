/**
 * Funnel Step 12 — payment_model (KR variant)
 *
 * Korean-market pricing variant: $12/mo or $59/yr (annual = 7-day base trial
 * + 30-day bonus = 37-day free trial total).  Placeholder Expo Router file —
 * richer dev-info UI is added by subsequent acceptance criteria.
 *
 * Step config lives in
 *   packages/core-ts/src/funnel/screens.ts → FUNNEL_SCREENS.payment_model
 *
 * Route-params contract: none (empty params; internal-only screen).
 */
import { View, Text, StyleSheet } from 'react-native';

export default function PaymentModelScreen(): JSX.Element {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Funnel Step 12 of 12</Text>
      <Text style={styles.subtitle}>payment_model (kr_variant)</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  title: { fontSize: 20, fontWeight: '600' },
  subtitle: { fontSize: 14, opacity: 0.6, marginTop: 4 },
});
