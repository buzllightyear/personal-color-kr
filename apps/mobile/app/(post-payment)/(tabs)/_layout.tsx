/**
 * (post-payment)/(tabs)/_layout — Phase 3.3 4-tab content surface (Sub-AC 3).
 *
 * Mounts an Expo Router Tabs navigator with exactly 4 tabs in order
 * [edit, diagnosis, guide, curation], with `edit` as the initial route
 * per the Seed-locked "Tab primary = edit; other 3 equal secondaries".
 *
 * Persisted-last-tab restoration: on mount, read the last viewed tab
 * from AsyncStorage and navigate to it via `router.replace(...)` so
 * the user returns to where they left off. On every tab focus change,
 * write the new tab through. The current navigation state is the
 * source of truth in-memory; the AsyncStorage key is a snapshot for
 * cold-start restoration.
 */
import { Tabs, useRouter, useSegments } from 'expo-router';
import * as React from 'react';
import { useEffect } from 'react';

import {
  readLastPostPaymentTab,
  writeLastPostPaymentTab,
  type TabKey,
} from '../../../src/storage/post-payment-storage';

export default function PostPaymentTabsLayout(): React.ReactElement {
  const router = useRouter();
  const segments = useSegments();

  // Cold-start tab restoration. Read once on mount; if a persisted tab
  // is present and differs from the default (`edit`), navigate the
  // user to that tab. `router.replace` is used rather than `push` so a
  // back-press from the restored tab does not re-enter the initial
  // `edit` route.
  useEffect(() => {
    let cancelled = false;
    void readLastPostPaymentTab().then((stored) => {
      if (cancelled || stored === null || stored === 'edit') {
        return;
      }
      router.replace(`/(post-payment)/(tabs)/${stored}`);
    });
    return () => {
      cancelled = true;
    };
    // Empty deps — restoration happens exactly once per cold start. A
    // re-mount on hot reload also re-restores, which is the correct
    // dev-time behaviour.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the active tab on every focus change so a cold restart
  // restores correctly. The `segments` array surfaces the current
  // route path; we look for the segment immediately under `(tabs)`.
  useEffect(() => {
    const tab = segments[segments.length - 1];
    if (
      tab === 'edit' ||
      tab === 'diagnosis' ||
      tab === 'guide' ||
      tab === 'curation'
    ) {
      void writeLastPostPaymentTab(tab as TabKey);
    }
  }, [segments]);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
      }}
      initialRouteName="edit"
    >
      <Tabs.Screen name="edit" options={{ title: '편집' }} />
      <Tabs.Screen name="diagnosis" options={{ title: '진단' }} />
      <Tabs.Screen name="guide" options={{ title: '가이드' }} />
      <Tabs.Screen name="curation" options={{ title: '큐레이션' }} />
    </Tabs>
  );
}
