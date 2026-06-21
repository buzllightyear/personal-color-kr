/**
 * (generate) route group layout — Content Generation Phase Sub-AC 2.
 *
 * Wraps the content-generation route subtree with a Stack navigator.
 * The two direct children declared here are:
 *   - `(tabs)` — the tabs surface holding the recipe catalog and (future)
 *     gallery tabs. The tab bar UI is owned by the nested
 *     `(generate)/(tabs)/_layout.tsx`.
 *
 * Why a separate route group (not merging into `(post-payment)`):
 *   The Seed specifies the recipe catalog as an **independent tab** whose
 *   content generation feature is fully decoupled from the personal-color
 *   diagnosis funnel. Keeping `(generate)` as its own group enforces that
 *   conceptual boundary at the file-system level and lets Phase 1 ship a
 *   minimal scaffold without touching the existing post-payment flow.
 *
 * This layout does NOT register any deep-link paths — the generate surface
 * is accessed via in-app navigation only (no external UTM/referral paths),
 * consistent with the linking-config invariant in `src/linking.config.ts`.
 */
import { Stack } from 'expo-router';
import * as React from 'react';

export default function GenerateLayout(): React.ReactElement {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
      }}
    >
      <Stack.Screen name="(tabs)" />
    </Stack>
  );
}
