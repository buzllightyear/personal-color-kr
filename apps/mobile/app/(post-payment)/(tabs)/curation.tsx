/**
 * (post-payment)/(tabs)/curation — Phase 3.3 curation tab.
 *
 * Renders the 4 CurationView items for the current ToneState season.
 * Exhaustive DataHook state handling per Sub-AC 10.
 */
import { usePostHog } from 'posthog-react-native';
import * as React from 'react';
import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { trackPostPaymentContentEngaged } from '../../../src/analytics/track-post-payment-content-engaged';
import { trackPostPaymentTabViewed } from '../../../src/analytics/track-post-payment-tab-viewed';
import { ErrorRetry } from '../../../src/components/ErrorRetry';
import { Skeleton } from '../../../src/components/Skeleton';
import { ToneSwitcher } from '../../../src/components/ToneSwitcher';
import { useCurationContent } from '../../../src/hooks/use-curation-content';
import { useToneState } from '../../../src/providers/ToneStateProvider';

export default function CurationTab(): React.ReactElement {
  const posthog = usePostHog();
  const { current } = useToneState();
  const { state, data } = useCurationContent(current);

  useEffect(() => {
    trackPostPaymentTabViewed(posthog, { tab: 'curation' });
  }, [posthog]);

  if (state === 'loading') {
    return <Skeleton />;
  }
  if (state === 'error' || data === null) {
    return <ErrorRetry />;
  }

  return (
    <View style={styles.container} testID="post-payment-tab-curation">
      <ToneSwitcher />
      <ScrollView contentContainerStyle={styles.list}>
        {data.items.map((item) => (
          <Pressable
            key={item.id}
            onPress={() =>
              trackPostPaymentContentEngaged(posthog, {
                tab: 'curation',
                action: `item_tapped:${item.id}`,
              })
            }
            style={styles.item}
            accessibilityRole="button"
            testID={`post-payment-tab-curation-item-${item.id}`}
          >
            <Text style={styles.itemName}>{item.name}</Text>
            <Text style={styles.itemBlurb}>{item.blurb}</Text>
            <Text style={styles.itemTag}>{item.toneTag}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  list: { padding: 16, gap: 12 },
  item: {
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#f7f7f7',
  },
  itemName: { fontSize: 16, fontWeight: '600', color: '#222' },
  itemBlurb: { marginTop: 6, fontSize: 13, color: '#555' },
  itemTag: {
    marginTop: 8,
    fontSize: 11,
    color: '#0058a3',
  },
});
