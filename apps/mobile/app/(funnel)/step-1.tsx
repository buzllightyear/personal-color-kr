/**
 * Funnel Step 1 — welcome_hook
 *
 * Placeholder Expo Router screen. UI implementation is out of scope for the
 * shell work unit; this file only establishes the route surface so that the
 * core-ts funnel state machine (packages/core-ts/funnel) can drive navigation
 * via `router.push('/(funnel)/step-1')` etc. in later phases.
 *
 * Step config (headline, CTAs, metadata) lives in
 * packages/core-ts/funnel/screens.ts → FUNNEL_SCREENS.welcome_hook.
 */
import { View, Text, StyleSheet } from 'react-native';

export default function FunnelStep1Screen(): JSX.Element {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Funnel Step 1</Text>
      <Text style={styles.subtitle}>welcome_hook</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  title: { fontSize: 20, fontWeight: '600' },
  subtitle: { fontSize: 14, opacity: 0.6, marginTop: 4 },
});
