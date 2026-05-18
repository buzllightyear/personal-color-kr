/**
 * Funnel Step 1 — welcome_hook
 *
 * Placeholder Expo Router screen.  This file establishes the route surface
 * for the v0.2 semantic-kebab funnel registry; richer placeholder UI
 * (dev-info, route params dump, guard-stub status, Next button) is added
 * by subsequent acceptance criteria in the same work unit.
 *
 * Step config lives in
 *   packages/core-ts/src/funnel/screens.ts → FUNNEL_SCREENS.welcome_hook
 *
 * Route-params contract (validated by Zod in a sibling AC):
 *   - utm_source, utm_medium, utm_campaign, utm_term, utm_content
 *   - referrer_code, referrer_channel
 */
import { View, Text, StyleSheet } from 'react-native';

export default function WelcomeHookScreen(): JSX.Element {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Funnel Step 1 of 12</Text>
      <Text style={styles.subtitle}>welcome_hook</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  title: { fontSize: 20, fontWeight: '600' },
  subtitle: { fontSize: 14, opacity: 0.6, marginTop: 4 },
});
