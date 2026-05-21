import { Stack, Redirect, usePathname } from 'expo-router';
import * as React from 'react';
import { useState } from 'react';

/**
 * `(post-payment)` route group layout — Phase 3.3 Sub-AC 1.1.
 *
 * Responsibilities owned by this file (and ONLY by this file):
 *   1. **First-touch gate.** On the user's first entry into the
 *      `(post-payment)` group, redirect to the full-screen
 *      `diagnosis-reveal` route so the personal-color diagnosis is shown
 *      ONCE, full-screen, with no tab bar / no Stack header. On every
 *      subsequent entry the redirect short-circuits and the user lands
 *      inside the persistent 4-tab content surface (`(tabs)` child
 *      group — defined by the sibling sub-AC's
 *      `(post-payment)/(tabs)/_layout.tsx`).
 *   2. **Stack registry for the post-payment subtree.** Declare the two
 *      direct children of the group:
 *        - `diagnosis-reveal` — full-screen modal presentation, gesture
 *          dismissal disabled so the user cannot swipe the reveal away
 *          mid-animation; the screen advances itself when its own
 *          animation / timer completes.
 *        - `(tabs)` — the 4-tab content surface (edit primary, diagnosis,
 *          guide, curation). The Stack declares the screen-group name
 *          here; the tab bar UI is owned by the nested `(tabs)/_layout`.
 *      Both children inherit `headerShown: false` from the parent
 *      `screenOptions` so the diagnosis-reveal and the tabbed shell
 *      below it are visually flush with no native header bar.
 *
 * Responsibilities EXPLICITLY NOT owned by this file (sibling sub-ACs):
 *   - The diagnosis-reveal screen body (the actual full-screen Korean
 *     "여름쿨" / season-card render) lives in
 *     `(post-payment)/diagnosis-reveal.tsx`.
 *   - The tab bar configuration, the 4 tab routes (edit / diagnosis /
 *     guide / curation), and the persisted-last-tab restore live in
 *     `(post-payment)/(tabs)/_layout.tsx`.
 *   - The AsyncStorage wrapper module that backs `DiagnosisRevealSeen`,
 *     `LastTone`, and `LastPostPaymentTab` lives in
 *     `src/storage/post-payment-storage.ts` (sibling sub-AC). Until that
 *     wrapper lands, the `diagnosisRevealSeen` placeholder below is a
 *     `useState<boolean>(false)` — the fail-loud-but-safe default which
 *     exactly matches the first-install behaviour the Seed already
 *     requires (the reveal SHOULD fire on first entry).
 *   - The four per-tab data hooks (`useDiagnosisContent`,
 *     `useEditContent`, `useGuideContent`, `useCurationContent`) live in
 *     `src/hooks/` and are independent of this layout.
 *
 * Why the redirect short-circuits BEFORE the Stack render:
 *   Mirrors the precedent set by `(funnel)/_layout.tsx` which returns
 *   `<Redirect href="..." />` ahead of the Stack. Expo Router's
 *   `Redirect` performs a structural replacement of the current
 *   navigation target so the user lands at the new route with no
 *   transition flash and no double-mount of the Stack tree.
 *
 * Why the pathname check is required to break the redirect loop:
 *   Without the `onDiagnosisReveal` short-circuit the layout would loop
 *   indefinitely (re-render → Redirect → reveal mounts → re-render
 *   layout → Redirect again → ...). The `pathname` guard ensures the
 *   redirect ONLY fires when the user is landing somewhere OTHER than
 *   the reveal (e.g. the implicit `(tabs)` entry on a fresh
 *   navigation). The last-segment comparison mirrors how
 *   `app/_layout.tsx` already keys its `funnel_step_entered` auto-capture
 *   off `pathname.split('/').pop()`, so the two layouts stay
 *   structurally similar and side-by-side reviewable.
 *
 * Why `(post-payment)` is NEVER registered in `LINKING_CONFIG`
 * (security invariant — Seed constraint + Exit Condition
 * `deep_link_invariant`):
 *   The 4 post-payment screens are gated behind a completed payment +
 *   a produced diagnosis. They are NEVER addressable via an external
 *   deep link (a UTM campaign URL, a referral link, etc.) because doing
 *   so would bypass the funnel and the payment surface. The compile-time
 *   defence lives in `src/linking.config.ts`'s `FunnelLinkingConfig`
 *   interface, whose `screens` block only types `'(funnel)'` and
 *   `'magazine/[month]'`. The runtime defence — drift prevention if a
 *   future contributor widens that interface — is the sibling test in
 *   `tests/linking-config.test.ts` that asserts
 *   `'(post-payment)' not in LINKING_CONFIG.screens`. This layout file
 *   therefore performs no allowlist registration and exports no path
 *   constant — the absence is the contract.
 *
 * Phase 4 swap site (hook-internal-only, per `phase4_portability`):
 *   The `diagnosisRevealSeen` placeholder becomes a read from the
 *   AsyncStorage wrapper module — a single-line edit inside this
 *   layout. The Stack registry, the Redirect target, the screen
 *   `options`, and the surrounding `(tabs)` / `diagnosis-reveal`
 *   contract all stay identical, which keeps the Phase 4 transition a
 *   strictly-additive change with no blast radius into screens.
 */
export default function PostPaymentLayout(): JSX.Element {
  // Placeholder for the `DiagnosisRevealSeen` ontology concept. The real
  // implementation (sibling sub-AC) replaces this with a read from
  // `readDiagnosisRevealSeen()` exported by
  // `src/storage/post-payment-storage.ts`, which reads the AsyncStorage
  // namespaced key `pck.post_payment.diagnosis_reveal_seen`. Until the
  // wrapper lands, the fail-loud-but-safe default is `false` — i.e. the
  // reveal fires on every entry, matching the first-install behaviour
  // the Seed already requires for sub-AC verification.
  const [diagnosisRevealSeen] = useState<boolean>(false);

  // Last-segment derivation mirrors the pattern in `app/_layout.tsx`'s
  // `funnel_step_entered` capture so both layouts compute the active
  // segment the same way. Defensive null/empty handling so a missing
  // pathname (e.g. during the very first render before the router has
  // attached) falls through to the redirect path rather than crashing.
  const pathname = usePathname();
  const segments = pathname?.replace(/^\/+/, '').split('/') ?? [];
  const lastSegment = segments[segments.length - 1] ?? '';
  const onDiagnosisReveal = lastSegment === 'diagnosis-reveal';

  if (!diagnosisRevealSeen && !onDiagnosisReveal) {
    return <Redirect href="/(post-payment)/diagnosis-reveal" />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
      }}
    >
      {/*
       * Diagnosis-reveal — first-touch full-screen experience.
       *
       * `presentation: 'fullScreenModal'` is the Expo Router option that
       * mounts the screen as a true full-screen overlay on iOS (no
       * status-bar inset, no parent Stack chrome) and a full-screen
       * activity on Android. Combined with the parent's
       * `headerShown: false` this yields the "no tab bar, no header"
       * surface the Seed requires for the first-touch reveal.
       *
       * `gestureEnabled: false` blocks the iOS swipe-down-to-dismiss
       * gesture so the user cannot dismiss the reveal mid-animation.
       * The screen advances itself (e.g. via a CTA tap or an animation
       * complete callback) — that wiring lives in the screen body
       * implemented by a sibling sub-AC.
       */}
      <Stack.Screen
        name="diagnosis-reveal"
        options={{
          presentation: 'fullScreenModal',
          gestureEnabled: false,
        }}
      />
      {/*
       * 4-tab content surface, mounted as a nested route group.
       * Declared here so the parent Stack knows about the child group;
       * the tab bar, the per-tab routes, and the persisted-last-tab
       * restoration are owned by `(post-payment)/(tabs)/_layout.tsx`.
       */}
      <Stack.Screen name="(tabs)" />
    </Stack>
  );
}
