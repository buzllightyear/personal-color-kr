/**
 * Funnel Step 9 — result_reveal (locked paywalled tease)
 *
 * Placeholder Expo Router screen.  This file establishes the route surface
 * for the v0.2 semantic-kebab funnel registry; richer placeholder UI is
 * added by subsequent acceptance criteria in the same work unit.
 *
 * Step config lives in
 *   packages/core-ts/src/funnel/screens.ts → FUNNEL_SCREENS.result_reveal
 *
 * Route-params contract (validated by Zod in a sibling AC):
 *   - share_token (optional) — when present, activates read-only preview mode
 *     for shared links (`/s/<token>` deep link target).
 */
import { View, Text, StyleSheet } from 'react-native';

export default function ResultRevealScreen(): JSX.Element {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Funnel Step 9 of 12</Text>
      <Text style={styles.subtitle}>result_reveal</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  title: { fontSize: 20, fontWeight: '600' },
  subtitle: { fontSize: 14, opacity: 0.6, marginTop: 4 },
});
