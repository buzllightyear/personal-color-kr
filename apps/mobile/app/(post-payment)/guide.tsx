/**
 * Post-Payment — Guide screen
 *
 * Placeholder Expo Router screen for the personalised style guide that is
 * unlocked for a user after a successful payment. UI implementation is out of
 * scope for the Phase 2 shell work unit; this file only establishes the route
 * surface so that Expo Router can resolve `/(post-payment)/guide` during
 * navigation.
 *
 * Guide content (color guides, makeup guidance, styling tips, etc.) is
 * produced by the Python core package (packages/core-python/content/guides)
 * and will be surfaced through the DataHook<T> async-boundary contract
 * (`usePython<T>()`) in Phase 3/4. Until then this component intentionally
 * renders only placeholder content.
 */
import { View, Text, StyleSheet } from 'react-native';

export default function GuideScreen(): JSX.Element {
  return (
    <View style={styles.container} testID="post-payment-guide">
      <Text style={styles.title}>Guide</Text>
      <Text style={styles.subtitle}>post_payment.guide</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  title: { fontSize: 20, fontWeight: '600' },
  subtitle: { fontSize: 14, opacity: 0.6, marginTop: 4 },
});
