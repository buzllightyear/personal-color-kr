/**
 * Post-Payment — Curation screen
 *
 * Placeholder Expo Router screen for the curated product / content
 * recommendations surfaced to a user after a successful payment. UI
 * implementation is out of scope for the Phase 2 shell work unit; this file
 * only establishes the route surface so that Expo Router can resolve
 * `/(post-payment)/curation` during navigation.
 *
 * Curation data (personal-color-driven product picks, styling sets, monthly
 * magazine cross-links, etc.) is produced by the Python core package
 * (packages/core-python/content) and will be surfaced through the DataHook<T>
 * async-boundary contract (`usePython<T>()`) in Phase 3/4. Until then this
 * component intentionally renders only placeholder content.
 */
import { View, Text, StyleSheet } from 'react-native';

export default function CurationScreen(): JSX.Element {
  return (
    <View style={styles.container} testID="post-payment-curation">
      <Text style={styles.title}>Curation</Text>
      <Text style={styles.subtitle}>post_payment.curation</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  title: { fontSize: 20, fontWeight: '600' },
  subtitle: { fontSize: 14, opacity: 0.6, marginTop: 4 },
});
