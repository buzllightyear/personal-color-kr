import { Stack, Redirect } from 'expo-router';
import * as React from 'react';
import { useState } from 'react';

import { PostHogProvider } from '../src/providers/PostHogProvider';

/**
 * Root layout for the personal-color-kr Expo Router app shell.
 *
 * Responsibilities of this file:
 *   1. Mount the singleton PostHog analytics provider EXACTLY ONCE so the
 *      entire route tree (every funnel step, every post-payment screen, the
 *      magazine reader, …) lives inside a single `PostHogProvider`. Per the
 *      Sub-AC 7.3 contract, the provider is the root wrapper and the
 *      `posthog-react-native` `PostHog` constructor is invoked exactly once
 *      across the lifetime of the JS runtime (singleton invariant enforced by
 *      `src/providers/PostHogProvider.tsx` + its sibling unit test).
 *   2. Apply two conditional redirects that gate user navigation:
 *        - Paywall gate — redirects users without an active subscription to
 *          the funnel paywall (`/(funnel)/step-12`).
 *        - Referral gate — redirects users who entered through a referral
 *          link to the referral screen (`/`).
 *      Real gating logic (subscription / referral state, Superwall, StoreKit,
 *      etc.) lands in Phase 3/4. For the shell, both gates are disabled
 *      (`false`) so the default Stack renders all child routes without
 *      redirection.
 *
 * Why every branch funnels through a single `<PostHogProvider>` return:
 *   Earlier drafts of this layout used three separate `return` statements
 *   (paywall, referral, default), each one rendering a different element.
 *   Wrapping each with its own `<PostHogProvider>` would have produced three
 *   provider trees in source, easy to drift out of sync when one branch is
 *   updated and the other two are forgotten. By selecting the inner element
 *   into a `content` variable and wrapping it once at the bottom, the
 *   provider's mount semantics, prop wiring, and onboarding-degradation
 *   contract live in a single line of code — there is exactly one place to
 *   audit for "is the provider configured correctly?".
 *
 * Graceful-degradation contract (inherited from `PostHogProvider`):
 *   - When `POSTHOG_API_KEY` is not yet populated in the developer's local
 *     `.env`, the provider degrades to a fragment (children only) and the
 *     `PostHog` constructor is never invoked. The app still mounts.
 *   - When the constructor runs successfully, the resulting client is
 *     exposed to descendants via the `posthog-react-native` context, so any
 *     screen / hook can read it with `usePostHog()`.
 */
export default function RootLayout(): JSX.Element {
  // Placeholder gate state — real implementations will read from
  // packages/core-ts state machines and async data hooks (DataHook<T>).
  const [shouldShowPaywall] = useState<boolean>(false);
  const [shouldShowReferral] = useState<boolean>(false);

  // Select the route-tree subtree first, then wrap it with the provider at a
  // single point below. This keeps the singleton wrap site invariant across
  // all gate-branch combinations (paywall, referral, default) — see the
  // module-level docstring for rationale.
  let content: React.ReactElement;
  if (shouldShowPaywall) {
    content = <Redirect href="/(funnel)/step-12" />;
  } else if (shouldShowReferral) {
    content = <Redirect href="/" />;
  } else {
    content = (
      <Stack
        screenOptions={{
          headerShown: false,
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="(funnel)" />
        <Stack.Screen name="(post-payment)" />
        <Stack.Screen name="magazine/[month]" />
      </Stack>
    );
  }

  return <PostHogProvider>{content}</PostHogProvider>;
}
