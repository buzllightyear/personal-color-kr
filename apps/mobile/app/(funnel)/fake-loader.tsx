/**
 * Funnel Step 5 — fake_loader (v0.2)
 *
 * v0.2 change: moved from the former step-8 slot into step-5, replacing the
 * deprecated `price_anchoring` step.  Placeholder Expo Router file — richer
 * dev-info UI is added by subsequent acceptance criteria.
 *
 * Step config lives in
 *   packages/core-ts/src/funnel/screens.ts → FUNNEL_SCREENS.fake_loader
 *
 * Route-params contract: none (empty params; internal-only screen).
 */
import { View, Text, StyleSheet } from 'react-native';

export default function FakeLoaderScreen(): JSX.Element {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Funnel Step 5 of 12</Text>
      <Text style={styles.subtitle}>fake_loader</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  title: { fontSize: 20, fontWeight: '600' },
  subtitle: { fontSize: 14, opacity: 0.6, marginTop: 4 },
});
