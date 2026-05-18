/**
 * Funnel Step 7 — diagnosis_input (v0.2)
 *
 * v0.2 change: selfie upload only — the onboarding questions previously
 * bundled here move out, leaving the step focused exclusively on the selfie
 * input.  Placeholder Expo Router file — richer dev-info UI is added by
 * subsequent acceptance criteria.
 *
 * Step config lives in
 *   packages/core-ts/src/funnel/screens.ts → FUNNEL_SCREENS.diagnosis_input
 *
 * Route-params contract: none (empty params; internal-only screen).
 */
import { View, Text, StyleSheet } from 'react-native';

export default function DiagnosisInputScreen(): JSX.Element {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Funnel Step 7 of 12</Text>
      <Text style={styles.subtitle}>diagnosis_input</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  title: { fontSize: 20, fontWeight: '600' },
  subtitle: { fontSize: 14, opacity: 0.6, marginTop: 4 },
});
