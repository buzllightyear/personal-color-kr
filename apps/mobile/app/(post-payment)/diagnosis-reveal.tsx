/**
 * (post-payment)/diagnosis-reveal — Phase 3.3 first-touch full-screen
 * reveal of the personal-color diagnosis (Sub-AC 1).
 *
 * Mounted full-screen (no tab bar, no native header) the first time
 * the user enters (post-payment). The (post-payment) `_layout.tsx`
 * gates entry via the `diagnosisRevealSeen` AsyncStorage key — once
 * the user dismisses the reveal, the gate flips and subsequent
 * launches skip straight to the (tabs) shell.
 *
 * Data source: the first-install DiagnosisView fixture
 * (`DEFAULT_DIAGNOSIS`) — Phase 3.3 has no real diagnose call, the
 * Phase 4 swap reads the funnel-derived diagnosis from session state.
 *
 * PostHog event: emits `post_payment_revealed { season }` exactly once
 * on mount via the tracker module.
 */
import { useRouter } from 'expo-router';
import { usePostHog } from 'posthog-react-native';
import * as React from 'react';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { trackPostPaymentRevealed } from '../../src/analytics/track-post-payment-revealed';
import { useDiagnosisContent } from '../../src/hooks/use-diagnosis-content';
import { DEFAULT_DIAGNOSIS } from '../../src/fixtures/post-payment-default-diagnosis';
import { writeDiagnosisRevealSeen } from '../../src/storage/post-payment-storage';
import { Skeleton } from '../../src/components/Skeleton';
import { ErrorRetry } from '../../src/components/ErrorRetry';

export default function DiagnosisRevealScreen(): React.ReactElement {
  const router = useRouter();
  const posthog = usePostHog();
  const { state, data } = useDiagnosisContent(DEFAULT_DIAGNOSIS.season);

  // Emit the reveal event once when the data is ready. The dependency
  // includes `data` so the event fires after the hook resolves; in
  // Phase 4 (async usePython) this means the event corresponds to the
  // moment the user actually sees the reveal payload, not the empty
  // loading state.
  useEffect(() => {
    if (state === 'ready' && data !== null) {
      trackPostPaymentRevealed(posthog, { season: data.season });
    }
  }, [state, data, posthog]);

  if (state === 'loading') {
    return <Skeleton />;
  }
  if (state === 'error' || data === null) {
    return <ErrorRetry />;
  }

  const handleDismiss = (): void => {
    void writeDiagnosisRevealSeen(true).then(() => {
      router.replace('/(post-payment)/(tabs)/edit');
    });
  };

  return (
    <View style={styles.container} testID="post-payment-diagnosis-reveal">
      <View style={styles.card}>
        <Text style={styles.koreanLabel}>{data.koreanLabel}</Text>
        <Text style={styles.confidence}>
          신뢰도 {Math.round(data.confidence * 100)}%
        </Text>
        <View style={styles.detailRow}>
          <Text style={styles.detail}>{data.toneLabel}</Text>
          <Text style={styles.detail}>{data.contrastLabel}</Text>
        </View>
      </View>
      <Pressable
        onPress={handleDismiss}
        style={styles.cta}
        accessibilityRole="button"
        testID="post-payment-diagnosis-reveal-cta"
      >
        <Text style={styles.ctaLabel}>확인</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#fff',
  },
  card: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 24,
    borderRadius: 16,
    backgroundColor: '#f7f7f7',
    width: '100%',
  },
  koreanLabel: {
    fontSize: 36,
    fontWeight: '700',
    color: '#222',
  },
  confidence: {
    marginTop: 12,
    fontSize: 14,
    color: '#666',
  },
  detailRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  detail: {
    fontSize: 14,
    color: '#333',
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#e8e8e8',
    borderRadius: 12,
  },
  cta: {
    marginTop: 32,
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 24,
    backgroundColor: '#222',
  },
  ctaLabel: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
