/**
 * Post-Payment — Edit screen
 *
 * Placeholder Expo Router screen for the photo-edit flow that follows a
 * successful payment. UI implementation is out of scope for the Phase 2
 * shell work unit; this file only establishes the route surface so that
 * Expo Router can resolve `/(post-payment)/edit` during navigation.
 *
 * The actual edit pipeline (style transfer, retouching, etc.) is owned by
 * the Python core package (packages/core-python/image_edit) and will be
 * surfaced through the DataHook<T> async-boundary contract (`usePython<T>()`)
 * in Phase 3/4. Until then this component intentionally renders only
 * placeholder content.
 */
import { View, Text, StyleSheet } from 'react-native';

export default function EditScreen(): JSX.Element {
  return (
    <View style={styles.container} testID="post-payment-edit">
      <Text style={styles.title}>Edit</Text>
      <Text style={styles.subtitle}>post_payment.edit</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  title: { fontSize: 20, fontWeight: '600' },
  subtitle: { fontSize: 14, opacity: 0.6, marginTop: 4 },
});
