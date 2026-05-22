/**
 * (post-payment)/(tabs)/edit — Phase 3.3 edit tab (primary, Sub-AC 3).
 *
 * Reads the EditView via the independent `useEditContent` hook keyed
 * on the global ToneState. Exhaustively handles the 3 DataHook states
 * (loading=Skeleton, error=ErrorRetry, ready=content) per Sub-AC 10.
 *
 * Phase 4 swap site: `useEditContent` internal switches from
 * `useDummy<EditView>` to `usePython<EditView>` — zero changes here.
 */
import { usePostHog } from 'posthog-react-native';
import * as React from 'react';
import { useEffect } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { trackPostPaymentContentEngaged } from '../../../src/analytics/track-post-payment-content-engaged';
import { trackPostPaymentTabViewed } from '../../../src/analytics/track-post-payment-tab-viewed';
import { ErrorRetry } from '../../../src/components/ErrorRetry';
import { Skeleton } from '../../../src/components/Skeleton';
import { ToneSwitcher } from '../../../src/components/ToneSwitcher';
import { useEditContent } from '../../../src/hooks/use-edit-content';
import { useToneState } from '../../../src/providers/ToneStateProvider';

export default function EditTab(): React.ReactElement {
  const posthog = usePostHog();
  const { current } = useToneState();
  const { state, data } = useEditContent(current);

  useEffect(() => {
    trackPostPaymentTabViewed(posthog, { tab: 'edit' });
  }, [posthog]);

  if (state === 'loading') {
    return <Skeleton />;
  }
  if (state === 'error' || data === null) {
    return <ErrorRetry />;
  }

  return (
    <View style={styles.container} testID="post-payment-tab-edit">
      <ToneSwitcher />
      <Text
        style={styles.categoryLine}
        testID="post-payment-tab-edit-category-line"
      >
        {data.categoryLine}
      </Text>
      <Image
        source={{ uri: data.previewImageUrl }}
        style={styles.preview}
        accessibilityIgnoresInvertColors
      />
      <Text style={styles.caption}>{data.caption}</Text>
      <Text style={styles.vendor}>by {data.vendorName}</Text>
      <Text
        style={styles.ctaMicrocopy}
        testID="post-payment-tab-edit-cta-microcopy"
      >
        {data.ctaMicrocopy}
      </Text>
      <Pressable
        style={styles.cta}
        onPress={() =>
          trackPostPaymentContentEngaged(posthog, {
            tab: 'edit',
            action: 'cta_pressed',
          })
        }
        accessibilityRole="button"
        testID="post-payment-tab-edit-cta"
      >
        <Text style={styles.ctaLabel}>다시 편집</Text>
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
  ctaMicrocopy: {
    marginTop: 12,
    fontSize: 14,
    color: '#0058a3',
  },
  preview: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: 12,
    backgroundColor: '#f0f0f0',
    marginTop: 16,
  },
  caption: { marginTop: 16, fontSize: 14, color: '#333' },
  vendor: { marginTop: 4, fontSize: 12, color: '#888' },
  cta: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    backgroundColor: '#222',
    alignSelf: 'flex-start',
  },
  ctaLabel: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
