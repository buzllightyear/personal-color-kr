import { Stack, Redirect } from 'expo-router';
import { useState } from 'react';

import { FUNNEL_KEBAB_SLUGS_ORDERED } from '../../src/linking.config';
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
 * sibling unit test (`tests/funnel-layout-screens.test.tsx`).
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
    <Stack
      screenOptions={{
        headerShown: false,
      }}
    >
      {FUNNEL_KEBAB_SLUGS_ORDERED.map((slug) => (
        <Stack.Screen key={slug} name={slug} />
      ))}
    </Stack>
  );
}
