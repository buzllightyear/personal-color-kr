/**
 * Funnel Step 8 — fake_loader (5-second anchoring loader, auto-advances)
 *
 * Placeholder Expo Router screen. UI implementation is out of scope for the
 * shell work unit; this file only establishes the route surface.
 *
 * Step config lives in packages/core-ts/funnel/screens.ts →
 * FUNNEL_SCREENS.fake_loader (durationMs: 5000, autoAdvance: true).
 */
import { View, Text, StyleSheet } from 'react-native';

export default function FunnelStep8Screen(): JSX.Element {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Funnel Step 8</Text>
      <Text style={styles.subtitle}>fake_loader</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  title: { fontSize: 20, fontWeight: '600' },
  subtitle: { fontSize: 14, opacity: 0.6, marginTop: 4 },
});
