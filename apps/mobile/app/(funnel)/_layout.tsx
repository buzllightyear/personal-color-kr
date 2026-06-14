import { Stack, Redirect } from 'expo-router';
import { useState } from 'react';

import { FUNNEL_KEBAB_SLUGS_ORDERED } from '../../src/linking.config';
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
 *
 * Presentation — all 12 funnel steps use the default `card` presentation:
 *   `rating_gate` was originally registered with a `modal` presentation option
 *   to echo its `dismissable: true` metadata. That broke forward navigation:
 *   rating_gate is a pass-through step that `router.push`es to `fake_loader`,
 *   but on iOS a `modal` screen is presented as a separate modal view
 *   controller — pushing the next card placed it BENEATH the still-presented
 *   modal sheet, so tapping either CTA ("별점 남기기" / "나중에") left the
 *   rating screen visibly stuck on top (no forward transition). The
 *   `dismissable: true` semantic is satisfied by the always-available skip
 *   CTA, NOT by a modal sheet, so every step now uses the default card
 *   presentation and `router.push` advances uniformly across the funnel.
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
        {FUNNEL_KEBAB_SLUGS_ORDERED.map((slug) => (
          // Every funnel step uses the default `card` presentation. (See the
          // module header: rating_gate's former `modal` presentation trapped
          // forward navigation under the modal sheet on iOS.)
          <Stack.Screen key={slug} name={slug} />
        ))}
      </Stack>
    </FunnelStateProvider>
  );
}
