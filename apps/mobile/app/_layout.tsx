import { Stack, Redirect, usePathname } from 'expo-router';
import * as React from 'react';
import { useEffect, useState } from 'react';
import { usePostHog } from 'posthog-react-native';

import { PostHogProvider } from '../src/providers/PostHogProvider';
import { FUNNEL_KEBAB_SLUGS_ORDERED } from '../src/linking.config';
import { getVendorKeys } from '../src/config/vendor-keys';
import { configureSuperwall } from '../src/superwall/client';
import { useStashReferralCodeOnDeepLink } from '../src/hooks/use-stash-referral-code';

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
/**
 * Inner shell mounted INSIDE `<PostHogProvider>` so it can call `usePostHog()`
 * for the funnel_step_entered auto-capture (the hook is only valid below the
 * provider).  Kept as a sibling component rather than inlined into
 * `RootLayout` because the provider's graceful-degradation fragment must wrap
 * exactly one child, and a separate component makes the hook ordering
 * trivially auditable.
 */
function RootLayoutInner(): React.ReactElement {
  // Placeholder gate state — real implementations will read from
  // packages/core-ts state machines and async data hooks (DataHook<T>).
  const [shouldShowPaywall] = useState<boolean>(false);
  const [shouldShowReferral] = useState<boolean>(false);

  // Stash any inbound `/r/:code` referral code into AsyncStorage (last-wins,
  // no TTL) so a later Apple Sign In can transmit it for referee attribution
  // (Phase 4.5). Mounted once at the root so it catches referral links on
  // cold start AND while the app is already foregrounded on any screen.
  useStashReferralCodeOnDeepLink();

  // funnel_step_entered auto-capture:
  //   When the active pathname is one of the 12 funnel kebab slugs, fire a
  //   PostHog event with `step_id` so the entire navigation tree is logged
  //   from one place rather than per-screen.  Active route → event mapping
  //   is exhaustive over `FUNNEL_KEBAB_SLUGS_ORDERED` (the 4중 정합 source
  //   of truth) so a kebab rename surfaces both as a layout-level test
  //   failure AND as zero-events in PostHog rather than as a silent miss.
  const pathname = usePathname();
  const posthog = usePostHog();
  useEffect(() => {
    if (!posthog || !pathname) return;
    const lastSegment = pathname.replace(/^\/+/, '').split('/').pop() ?? '';
    if (FUNNEL_KEBAB_SLUGS_ORDERED.includes(lastSegment)) {
      posthog.capture('funnel_step_entered', { step_kebab: lastSegment });
    }
  }, [pathname, posthog]);

  // Select the route-tree subtree first, then wrap it with the provider at a
  // single point in `RootLayout` below.  This keeps the singleton wrap site
  // invariant across all gate-branch combinations (paywall, referral,
  // default) — see the module-level docstring for rationale.
  if (shouldShowPaywall) {
    return <Redirect href="/(funnel)/payment-model" />;
  }
  if (shouldShowReferral) {
    return <Redirect href="/" />;
  }
  return (
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

/**
 * Phase 2.5 Sub-AC 2.2 — one-shot Superwall SDK initialisation.
 *
 * The native Superwall SDK exposes a global `Superwall.configure({ apiKey })`
 * call that MUST run exactly once per JS runtime. The wrapper module
 * (`src/superwall/client.ts`) gates re-entrancy with its own
 * module-private `configured` flag (belt-and-suspenders alongside the
 * SDK's own idempotency); the root layout's responsibility is purely
 * to *trigger* the first call at app mount time.
 *
 * Why an empty dependency array:
 *   - The SDK is process-global state (StoreKit observers, paywall
 *     asset cache, presentation handler registry). Re-running configure
 *     on every re-render would churn that state and is explicitly
 *     forbidden by the Sub-AC contract ("called exactly once across
 *     initial render + rerender").
 *   - The Superwall publishable key is shipped via the Expo runtime
 *     manifest at build time, so it cannot change during a single JS
 *     runtime — making the empty deps array semantically correct as
 *     well as Sub-AC-mandated.
 *
 * Graceful degradation:
 *   - When `superwallApiKey` is undefined (developer hasn't populated
 *     `SUPERWALL_API_KEY` in their local `.env` yet — the placeholder
 *     onboarding state), we skip the configure call entirely. The
 *     wrapper would otherwise throw `SuperwallNotConfiguredError` from
 *     the regex validation. Subsequent `triggerPaywall` calls will
 *     surface the not-configured state via their own error path, which
 *     the route file maps to a Korean inline error message.
 *
 * Why a fire-and-forget `.catch`:
 *   - `useEffect` callbacks cannot be `async`. We invoke the wrapper
 *     and attach a `.catch` so unhandled promise rejection warnings
 *     do not fire in development. The error is logged for visibility
 *     but not surfaced to the UI — the proper user-facing error path
 *     for Superwall problems is the route-level `triggerPaywall` catch
 *     (per the Seed `error_transparency` evaluation principle, which
 *     scopes inline errors to paywall TRIGGER failures, not configure
 *     failures). TODO(phase-4): emit `superwall_configure_failed` to
 *     PostHog when the analytics swap lands.
 */
function useConfigureSuperwallOnce(): void {
  useEffect(() => {
    const { superwallApiKey } = getVendorKeys();
    if (superwallApiKey === undefined) {
      return;
    }
    configureSuperwall(superwallApiKey).catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error('[superwall] configure failed', err);
    });
    // Empty deps — Sub-AC 2.2 contract: exactly once across initial
    // render + rerender. The key is fetched fresh inside the effect
    // so a future rotation does not require a different deps array
    // (a rotation still ships in a new build).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export default function RootLayout(): JSX.Element {
  useConfigureSuperwallOnce();
  return (
    <PostHogProvider>
      <RootLayoutInner />
    </PostHogProvider>
  );
}
