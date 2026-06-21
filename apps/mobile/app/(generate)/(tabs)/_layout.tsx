/**
 * (generate)/(tabs) tab layout — Content Generation Phase Sub-AC 2.
 *
 * Mounts an Expo Router Tabs navigator with the catalog tab as the initial
 * route. Two tabs ship: the recipe catalog and the per-user image gallery
 * (AC4).
 *
 * Tab ordering:
 *   1. `catalog` (initial) — the curated recipe catalog, sorted by
 *      `publish_date DESC, display_order ASC`.
 *   2. `gallery` — the user's non-expired generated images, newest first.
 *
 * Why `initialRouteName="catalog"`:
 *   The recipe catalog is the primary entry point for content generation.
 *   The user lands on the catalog, selects a recipe, submits a selfie, and
 *   returns to the gallery tab to view + save their result.
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
      <Tabs.Screen name="gallery" options={{ title: '갤러리' }} />
    </Tabs>
  );
}
