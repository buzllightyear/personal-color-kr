/**
 * `share-referral-link.ts` — orchestration glue for the referral-gate share
 * handlers (Phase 4.5).
 *
 * Responsibility:
 *   Sequence the two halves of a "share my referral link" tap:
 *     1. fetch the *server-assembled* `share_url` from `GET /v1/referrals/me`
 *        (the server is the single source of truth — the client never
 *        assembles the URL); then
 *     2. hand that URL to the injected presenter (the OS share sheet today;
 *        the Kakao SDK / clipboard specialisations later).
 *
 *   This replaces the Phase 2.4 `console.log` placeholder: the share handlers
 *   now operate on the real server share URL rather than a logged noop.
 *
 * Why a standalone, dependency-injected function:
 *   The route component cannot be unit-tested for async fetch sequencing
 *   easily (it needs expo-router + provider context), so the "fetch then
 *   present, and degrade silently on failure" decision lives here as a pure,
 *   RN-free unit. Both the transport and the presenter are injected, mirroring
 *   the sibling `submit-sign-in-with-apple.ts` seam.
 *
 * Silent degradation (Seed: soft gate must never block the funnel):
 *   The referral gate is a soft gate. If the fetch fails (no network, the
 *   auth-session token is not yet wired, server 5xx) the share simply does not
 *   open — the caller still tracks the event, flips `referral.shared`, and
 *   navigates onward. `shareReferralLink` therefore swallows errors and
 *   reports success/failure via its boolean result instead of throwing.
 */
import { fetchReferralMe, type ReferralMeTransport } from './fetch-referral-me';
import type { ReferralShareMethod } from './analytics/track-referral-shared';

/**
 * Side-effect seam that surfaces the resolved `shareUrl` to the user (OS share
 * sheet / Kakao SDK / clipboard). Injected so the orchestration stays RN-free
 * and testable; the real implementation is `presentReferralShare`.
 */
export type ReferralSharePresenter = (
  method: ReferralShareMethod,
  shareUrl: string,
) => Promise<void> | void;

/**
 * Dependencies for {@link shareReferralLink}.
 *
 * `transport` performs `GET /v1/referrals/me`; `present` surfaces the fetched
 * URL to the user.
 */
export interface ShareReferralLinkDeps {
  readonly transport: ReferralMeTransport;
  readonly present: ReferralSharePresenter;
}

/**
 * The outcome of a share attempt — enough for the caller (and tests) to know
 * whether the real `share_url` was fetched and presented, without leaking the
 * failure as a thrown error that would break the soft-gate navigation.
 */
export interface ShareReferralLinkResult {
  readonly shared: boolean;
  readonly shareUrl: string | null;
}

/**
 * Fetch the server `share_url` and present it for the given method.
 *
 * Sequence: `GET /v1/referrals/me` → project to `shareUrl` → `present(method,
 * shareUrl)`. Any failure in either step resolves to
 * `{ shared: false, shareUrl: null }` (silent degradation) so the share gate
 * never throws into the funnel navigation.
 *
 * @param method - the share affordance tapped (`kakao` | `copy_link`).
 * @param deps - injected transport + presenter.
 * @returns whether the URL was fetched and presented, plus the URL on success.
 */
export async function shareReferralLink(
  method: ReferralShareMethod,
  deps: ShareReferralLinkDeps,
): Promise<ShareReferralLinkResult> {
  try {
    const { shareUrl } = await fetchReferralMe(deps.transport);
    await deps.present(method, shareUrl);
    return { shared: true, shareUrl };
  } catch {
    // Soft gate: a fetch/present failure must not block the funnel. The
    // caller still tracks the event, flips `referral.shared`, and navigates.
    return { shared: false, shareUrl: null };
  }
}
