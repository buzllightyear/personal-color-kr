/**
 * Skeleton — Phase 3.3 shared loading placeholder. Rendered by every
 * post-payment screen when its `DataHook<T>.state === 'loading'` (Sub-AC 10).
 *
 * Intentionally minimal — a single neutral block. Real visual design is
 * a Phase 4 polish concern; what matters here is that every screen has
 * a uniform `state==='loading'` branch and the hook contract is
 * exhaustively handled.
 */
import * as React from 'react';
import { StyleSheet, View } from 'react-native';

export function Skeleton(): React.ReactElement {
  return <View style={styles.box} testID="post-payment-skeleton" />;
}

const styles = StyleSheet.create({
  box: {
    flex: 1,
    backgroundColor: '#f2f2f2',
  },
});
