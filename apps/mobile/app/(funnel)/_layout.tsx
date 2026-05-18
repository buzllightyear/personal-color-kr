import { Stack, Redirect } from 'expo-router';
import { useState } from 'react';

import { FUNNEL_KEBAB_SLUGS_ORDERED, toKebabSlug } from '../../src/linking.config';
import { FunnelStateProvider } from '../../src/providers/FunnelStateProvider';
import { shouldSkipFunnelSubscribed } from './_guards';

/**
 * Funnel group layout for the 12-step onboarding funnel (v0.2).
 *
 * Stack.Screen registry is derived from `FUNNEL_KEBAB_SLUGS_ORDERED`
 * (the single source of truth, computed from
 * `packages/core-ts/funnel/types.ts`'s `FUNNEL_STEPS_ORDERED`).  This
 * encodes the 4중 정합 cross-check at the layout layer: core-ts
 * snake_case constant → kebab slug map → file routes → Stack.Screen
 * declarations.  Drift in any of the four is caught at runtime by the
 * sibling unit test (`tests/funnel-registry-cross-check.test.ts`).
 *
 * Phase 2.2 additions:
 *   - The whole funnel group is wrapped in `<FunnelStateProvider>` so steps
 *     3 (onboarding_priming) and later can share the in-flight onboarding
 *     answers via React Context.  The provider is scoped to this layout
 *     (NOT the root layout) so the post-payment surface and magazine
 *     reader do not subscribe to funnel-only state.
 *   - The `rating-gate` Stack.Screen carries `presentation: 'modal'` so it
 *     overlays the previous screen as a native sheet on iOS and a dialog
 *     on Android, matching its dismissable: true semantic from
 *     FUNNEL_SCREENS.rating_gate.metadata.  All other 11 screens retain the
 *     default (`card`) presentation.
 *
 * Conditional redirect scaffold:
 * - Resume gate: if the funnel state machine has a persisted current step,
 *   resume the user at that step instead of always entering at welcome-hook.
 *   Real implementation reads from AsyncStorage (`shouldResumeFunnel` stub
 *   currently `false`).
 * - Subscription completion gate: returning users with an active subscription
 *   bypass the entire funnel and land in the post-payment area.  Decision is
 *   delegated to `shouldSkipFunnelSubscribed()` from `_guards.ts` which
 *   currently returns a fail-loud `false`.
 *
 * Real gating logic lands in Phase 3/4. For now, both gates resolve to
 * `false` so the default Stack renders all 12 kebab routes without
 * redirection.
 */
const RATING_GATE_KEBAB_SLUG = toKebabSlug('rating_gate');

export default function FunnelLayout(): JSX.Element {
  // Placeholder gate state — real implementations will read from
  // packages/core-ts/funnel state machines and async data hooks (DataHook<T>).
  const [shouldResumeFunnel] = useState<boolean>(false);
  const hasCompletedFunnel = shouldSkipFunnelSubscribed();

  if (hasCompletedFunnel) {
    return <Redirect href="/(post-payment)/diagnosis" />;
  }

  if (shouldResumeFunnel) {
    // In Phase 3/4 this will redirect to the persisted current step
    // (e.g. `/welcome-hook`) sourced from the funnel state machine.
    return <Redirect href="/(funnel)/welcome-hook" />;
  }

  return (
    <FunnelStateProvider>
      <Stack
        screenOptions={{
          headerShown: false,
        }}
      >
        {FUNNEL_KEBAB_SLUGS_ORDERED.map((slug) => {
          // rating-gate uses the modal presentation per FUNNEL_SCREENS
          // metadata (dismissable: true). All other screens use the default
          // card presentation.
          if (slug === RATING_GATE_KEBAB_SLUG) {
            return (
              <Stack.Screen
                key={slug}
                name={slug}
                options={{ presentation: 'modal' }}
              />
            );
          }
          return <Stack.Screen key={slug} name={slug} />;
        })}
      </Stack>
    </FunnelStateProvider>
  );
}
