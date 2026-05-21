/**
 * ErrorRetry — Phase 3.3 shared error fallback. Rendered by every
 * post-payment screen when its `DataHook<T>.state === 'error'` (Sub-AC 10).
 *
 * Phase 3.3 shell never produces `state === 'error'` (useDummy only
 * emits loading | ready). The branch exists to keep the screens'
 * exhaustive 3-state switch real today, so Phase 4 (where the real
 * `usePython<T>` can fail) is a hook-internal swap with zero screen
 * changes.
 */
import * as React from 'react';
import { StyleSheet, Text, View } from 'react-native';

export function ErrorRetry(): React.ReactElement {
  return (
    <View style={styles.container} testID="post-payment-error-retry">
      <Text style={styles.message}>콘텐츠를 불러오지 못했어요.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  message: {
    fontSize: 14,
    color: '#555',
  },
});
