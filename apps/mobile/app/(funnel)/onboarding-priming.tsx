/**
 * Funnel Step 3 — onboarding_priming (v0.2)
 *
 * v0.2 change: replaces the deprecated `social_proof_intro` step with a
 * pre-diagnosis onboarding-priming screen.  Placeholder Expo Router file —
 * richer dev-info UI is added by subsequent acceptance criteria.
 *
 * Step config lives in
 *   packages/core-ts/src/funnel/screens.ts → FUNNEL_SCREENS.onboarding_priming
 *
 * Route-params contract: none (empty params; internal-only screen).
 */
import { View, Text, StyleSheet } from 'react-native';

export default function OnboardingPrimingScreen(): JSX.Element {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Funnel Step 3 of 12</Text>
      <Text style={styles.subtitle}>onboarding_priming</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  title: { fontSize: 20, fontWeight: '600' },
  subtitle: { fontSize: 14, opacity: 0.6, marginTop: 4 },
});
