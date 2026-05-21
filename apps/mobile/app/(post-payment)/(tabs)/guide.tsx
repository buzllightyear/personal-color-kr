/**
 * (post-payment)/(tabs)/guide — Phase 3.3 guide tab.
 *
 * Renders the GuideView tile grid for the current ToneState season.
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
import { useGuideContent } from '../../../src/hooks/use-guide-content';
import { useToneState } from '../../../src/providers/ToneStateProvider';

export default function GuideTab(): React.ReactElement {
  const posthog = usePostHog();
  const { current } = useToneState();
  const { state, data } = useGuideContent(current);

  useEffect(() => {
    trackPostPaymentTabViewed(posthog, { tab: 'guide' });
  }, [posthog]);

  if (state === 'loading') {
    return <Skeleton />;
  }
  if (state === 'error' || data === null) {
    return <ErrorRetry />;
  }

  return (
    <View style={styles.container} testID="post-payment-tab-guide">
      <ToneSwitcher />
      <ScrollView contentContainerStyle={styles.list}>
        {data.tiles.map((tile) => (
          <Pressable
            key={tile.id}
            onPress={() =>
              trackPostPaymentContentEngaged(posthog, {
                tab: 'guide',
                action: `tile_opened:${tile.id}`,
              })
            }
            style={styles.tile}
            accessibilityRole="button"
            testID={`post-payment-tab-guide-tile-${tile.id}`}
          >
            <Text style={styles.tileTitle}>{tile.title}</Text>
            <Text style={styles.tileBody}>{tile.body}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  list: { padding: 16, gap: 12 },
  tile: {
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#f7f7f7',
  },
  tileTitle: { fontSize: 16, fontWeight: '600', color: '#222' },
  tileBody: { marginTop: 6, fontSize: 13, color: '#555' },
});
