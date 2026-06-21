/**
 * (generate)/(tabs) tab layout — Content Generation Phase Sub-AC 2.
 *
 * Mounts an Expo Router Tabs navigator with the catalog tab as the initial
 * route. Phase 1 ships a single `catalog` tab; a `gallery` tab will be
 * added in a subsequent phase when per-user image history is implemented.
 *
 * Tab ordering:
 *   1. `catalog` (initial) — the curated recipe catalog, sorted by
 *      `publish_date DESC, display_order ASC`.
 *
 * Why `initialRouteName="catalog"`:
 *   The recipe catalog is the primary entry point for content generation.
 *   The user lands on the catalog, selects a recipe, submits a selfie, and
 *   returns to the catalog (or a future gallery tab) to view their result.
 */
import { Tabs } from 'expo-router';
import * as React from 'react';

export default function GenerateTabsLayout(): React.ReactElement {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
      }}
      initialRouteName="catalog"
    >
      <Tabs.Screen name="catalog" options={{ title: '트렌드' }} />
    </Tabs>
  );
}
