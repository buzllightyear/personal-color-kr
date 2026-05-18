/**
 * Funnel Step 2 — value_props
 *
 * Placeholder Expo Router screen.  This file establishes the route surface
 * for the v0.2 semantic-kebab funnel registry; richer placeholder UI
 * (dev-info, route params dump, guard-stub status, Next button) is added
 * by subsequent acceptance criteria in the same work unit.
 *
 * Step config lives in
 *   packages/core-ts/src/funnel/screens.ts → FUNNEL_SCREENS.value_props
 *
 * Route-params contract: none (empty params; internal-only screen).
 */
import { View, Text, StyleSheet } from 'react-native';

export default function ValuePropsScreen(): JSX.Element {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Funnel Step 2 of 12</Text>
      <Text style={styles.subtitle}>value_props</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  title: { fontSize: 20, fontWeight: '600' },
  subtitle: { fontSize: 14, opacity: 0.6, marginTop: 4 },
});
