/**
 * Funnel Step 8 — fake_scan_animation (v0.2 — NEW)
 *
 * v0.2 addition: newly introduced step that overlays a 24-point scan
 * animation on the uploaded selfie before revealing the result.
 * Placeholder Expo Router file — richer dev-info UI is added by subsequent
 * acceptance criteria.
 *
 * Step config lives in
 *   packages/core-ts/src/funnel/screens.ts → FUNNEL_SCREENS.fake_scan_animation
 *
 * Route-params contract: none (empty params; internal-only screen).
 */
import { View, Text, StyleSheet } from 'react-native';

export default function FakeScanAnimationScreen(): JSX.Element {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Funnel Step 8 of 12</Text>
      <Text style={styles.subtitle}>fake_scan_animation</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  title: { fontSize: 20, fontWeight: '600' },
  subtitle: { fontSize: 14, opacity: 0.6, marginTop: 4 },
});
