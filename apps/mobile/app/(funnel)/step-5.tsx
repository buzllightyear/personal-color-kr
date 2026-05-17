/**
 * Funnel Step 5 — price_anchoring (offline consult anchor vs. $12/mo)
 *
 * Placeholder Expo Router screen. UI implementation is out of scope for the
 * shell work unit; this file only establishes the route surface.
 *
 * Step config lives in packages/core-ts/funnel/screens.ts →
 * FUNNEL_SCREENS.price_anchoring.
 */
import { View, Text, StyleSheet } from 'react-native';

export default function FunnelStep5Screen(): JSX.Element {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Funnel Step 5</Text>
      <Text style={styles.subtitle}>price_anchoring</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  title: { fontSize: 20, fontWeight: '600' },
  subtitle: { fontSize: 14, opacity: 0.6, marginTop: 4 },
});
