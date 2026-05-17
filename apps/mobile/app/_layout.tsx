import { Stack, Redirect } from 'expo-router';
import { useState } from 'react';

/**
 * Root layout for the personal-color-kr Expo Router app shell.
 *
 * Conditional redirect scaffold:
 * - Paywall gate: redirects users without an active subscription to the funnel paywall.
 * - Referral gate: redirects users who entered through a referral link to the referral screen.
 *
 * Real gating logic (subscription / referral state, Superwall, StoreKit, etc.) lands in
 * Phase 3/4. For the shell, both gates are disabled (`false`) so the default Stack
 * renders all child routes without redirection.
 */
export default function RootLayout(): JSX.Element {
  // Placeholder gate state — real implementations will read from
  // packages/core-ts state machines and async data hooks (DataHook<T>).
  const [shouldShowPaywall] = useState<boolean>(false);
  const [shouldShowReferral] = useState<boolean>(false);

  if (shouldShowPaywall) {
    return <Redirect href="/(funnel)/step-12" />;
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
