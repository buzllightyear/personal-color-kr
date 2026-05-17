import { Stack, Redirect } from 'expo-router';
import { useState } from 'react';

/**
 * Funnel group layout for the 12-step onboarding funnel.
 *
 * Conditional redirect scaffold:
 * - Resume gate: if the funnel state machine has a persisted current step,
 *   resume the user at that step instead of always entering at step-1.
 * - Completion gate: if the user has already completed the funnel
 *   (e.g. previously paid or restored a subscription), bounce them out
 *   of the funnel group into the post-payment area.
 *
 * Real gating logic will be wired in Phase 3/4 by reading from
 * `packages/core-ts/funnel` state machine and async `DataHook<T>` consumers
 * (`useDummy<T>` for the shell, `usePython<T>` for the Python-backed flows).
 * For the shell, both gates are disabled (`false`) so the default Stack
 * renders all child step routes without redirection.
 *
 * Step routes (step-1.tsx ... step-12.tsx) are siblings of this file inside
 * the `(funnel)` route group, which keeps URLs flat (`/step-1`) while sharing
 * this layout.
 */
export default function FunnelLayout(): JSX.Element {
  // Placeholder gate state — real implementations will read from
  // packages/core-ts/funnel state machines and async data hooks (DataHook<T>).
  const [shouldResumeFunnel] = useState<boolean>(false);
  const [hasCompletedFunnel] = useState<boolean>(false);

  if (hasCompletedFunnel) {
    return <Redirect href="/(post-payment)/diagnosis" />;
  }

  if (shouldResumeFunnel) {
    // In Phase 3/4 this will redirect to the persisted current step
    // (e.g. `/step-${currentStep}`) sourced from the funnel state machine.
    return <Redirect href="/(funnel)/step-1" />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
      }}
    >
      <Stack.Screen name="step-1" />
      <Stack.Screen name="step-2" />
      <Stack.Screen name="step-3" />
      <Stack.Screen name="step-4" />
      <Stack.Screen name="step-5" />
      <Stack.Screen name="step-6" />
      <Stack.Screen name="step-7" />
      <Stack.Screen name="step-8" />
      <Stack.Screen name="step-9" />
      <Stack.Screen name="step-10" />
      <Stack.Screen name="step-11" />
      <Stack.Screen name="step-12" />
    </Stack>
  );
}
