/**
 * `useStashReferralCodeOnDeepLink()` — app-wide expo-linking glue that
 * stashes an inbound `/r/:code` referral code into AsyncStorage
 * (Phase 4.5, ontology `stashed_referral_code`).
 *
 * Why a hook mounted at the root layout:
 *   A referral deep link can arrive on a cold start (the link launched the
 *   app) OR while the app is already foregrounded on any screen. expo-linking's
 *   `useURL()` covers both: it returns the initial launch URL and re-renders
 *   with each subsequent inbound URL. Mounting this hook once at the root
 *   layout therefore catches every referral link regardless of which funnel
 *   step the user is on.
 *
 * Why the actual logic lives elsewhere:
 *   The parse-and-stash decision is implemented in the pure, dependency-
 *   injected `stashReferralCodeFromDeepLink` so it can be unit-tested without
 *   React / expo-linking / a native AsyncStorage. This hook is the thinnest
 *   possible adapter: read the URL, fire-and-forget the stash. It holds no
 *   state of its own and renders nothing.
 *
 * Fire-and-forget rationale:
 *   `useEffect` callbacks cannot be `async`. We invoke the async stash and
 *   intentionally do not await it — stashing is a best-effort side effect on
 *   the path to a *later* sign-in, and a write failure must never block
 *   navigation. The `void` operator documents the deliberate non-await.
 */
import { useEffect } from 'react';
import { useURL } from 'expo-linking';

import { stashReferralCodeFromDeepLink } from '../stash-referral-code';

export function useStashReferralCodeOnDeepLink(): void {
  const url = useURL();
  useEffect(() => {
    if (url === null) {
      return;
    }
    void stashReferralCodeFromDeepLink(url);
  }, [url]);
}
