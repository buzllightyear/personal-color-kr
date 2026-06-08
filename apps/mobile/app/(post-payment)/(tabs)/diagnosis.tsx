/**
 * (post-payment)/(tabs)/diagnosis — diagnosis tab.
 *
 * The relocated stub from `(post-payment)/diagnosis.tsx`. Body fully
 * implemented per Sub-AC 10 — exhaustive DataHook states.
 */
import { usePostHog } from 'posthog-react-native';
import * as React from 'react';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { trackPostPaymentContentEngaged } from '../../../src/analytics/track-post-payment-content-engaged';
import { trackPostPaymentTabViewed } from '../../../src/analytics/track-post-payment-tab-viewed';
import { ErrorRetry } from '../../../src/components/ErrorRetry';
import { Skeleton } from '../../../src/components/Skeleton';
import { DEFAULT_DIAGNOSIS } from '../../../src/fixtures/post-payment-default-diagnosis';
import { useDiagnosisContent } from '../../../src/hooks/use-diagnosis-content';

export default function DiagnosisTab(): React.ReactElement {
  const posthog = usePostHog();
  const { state, data } = useDiagnosisContent(DEFAULT_DIAGNOSIS.season);

  useEffect(() => {
    trackPostPaymentTabViewed(posthog, { tab: 'diagnosis' });
  }, [posthog]);

  if (state === 'loading') {
    return <Skeleton />;
  }
  if (state === 'error' || data === null) {
    return <ErrorRetry />;
  }

  return (
    <View style={styles.container} testID="post-payment-tab-diagnosis">
      <Text
        style={styles.categoryLine}
        testID="post-payment-tab-diagnosis-category-line"
      >
        {data.categoryLine}
      </Text>
      <View style={styles.card}>
        <Text style={styles.label}>{data.koreanLabel}</Text>
        <Text style={styles.confidence}>
          신뢰도 {Math.round(data.confidence * 100)}%
        </Text>
        <View style={styles.detailRow}>
          <Text style={styles.detail}>{data.toneLabel}</Text>
          <Text style={styles.detail}>{data.contrastLabel}</Text>
        </View>
      </View>
      <Pressable
        onPress={() =>
          trackPostPaymentContentEngaged(posthog, {
            tab: 'diagnosis',
            action: 'card_inspected',
          })
        }
        style={styles.inspectArea}
        accessibilityRole="button"
        testID="post-payment-tab-diagnosis-inspect"
      >
        <Text style={styles.inspectHint}>자세히 보기</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#fff' },
  categoryLine: {
    marginTop: 12,
    fontSize: 16,
    color: '#333',
    fontWeight: '500',
  },
  card: {
    marginTop: 16,
    padding: 24,
    borderRadius: 16,
    backgroundColor: '#f7f7f7',
    alignItems: 'center',
  },
  label: { fontSize: 32, fontWeight: '700', color: '#222' },
  confidence: { marginTop: 8, fontSize: 14, color: '#666' },
  detailRow: { flexDirection: 'row', gap: 12, marginTop: 16 },
  detail: {
    fontSize: 14,
    color: '#333',
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#e8e8e8',
    borderRadius: 12,
  },
  inspectArea: { marginTop: 16, alignSelf: 'flex-start' },
  inspectHint: { fontSize: 14, color: '#0058a3', textDecorationLine: 'underline' },
});
