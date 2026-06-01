/**
 * `present-referral-share.ts` — surfaces the server-assembled referral
 * `share_url` to the OS share sheet (Phase 4.5).
 *
 * Responsibility:
 *   Given a share method and the *server-provided* share URL, present it for
 *   sharing. This is the side-effect end of the referral-gate share handlers:
 *   the URL is fetched from `GET /v1/referrals/me` (single source of truth),
 *   then handed here to actually reach the user's share affordance.
 *
 * Why React Native's built-in `Share` (not the Kakao SDK):
 *   The Seed defers the real Kakao SDK invocation to a later phase, so this
 *   module uses React Native core's dependency-free `Share.share(...)` to open
 *   the OS share sheet pre-filled with the real referral URL. The OS sheet is
 *   not the Kakao SDK — the user may still pick KakaoTalk from it — so this
 *   honours "no Kakao SDK real invocation" while still making genuine use of
 *   the server `share_url` (replacing the former `console.log` placeholder).
 *   When the dedicated Kakao share / clipboard integrations land, the `method`
 *   argument is the branch point to specialise per-method behaviour.
 *
 * Why the RN import is isolated in its own module:
 *   Keeping the `react-native` import here (rather than in the orchestration
 *   module) lets `share-referral-link.ts` stay a pure, RN-free unit that
 *   injects this presenter — so its fetch → present sequencing is testable in
 *   vitest's node env without an RN stub.
 */
import { Share } from 'react-native';

import type { ReferralShareMethod } from './analytics/track-referral-shared';

/**
 * Present the referral `shareUrl` for the given `method` via the OS share
 * sheet.
 *
 * The `method` is accepted (and currently unbranched) so the future
 * Kakao-SDK / clipboard specialisations slot in without changing the caller
 * contract. The promise resolves once the share sheet has been dismissed
 * (shared or cancelled) — both are non-error outcomes for a soft gate.
 *
 * @param method - the share affordance the user tapped (`kakao` | `copy_link`).
 * @param shareUrl - the server-assembled referral URL from
 *   `GET /v1/referrals/me`.
 */
export async function presentReferralShare(
  method: ReferralShareMethod,
  shareUrl: string,
): Promise<void> {
  void method;
  await Share.share({ message: shareUrl });
}
