/**
 * `stashReferralCodeFromDeepLink(url)` — the synthesis layer that turns an
 * inbound deep-link URL into a stashed referral code (Phase 4.5,
 * ontology `stashed_referral_code`).
 *
 * Why this module exists:
 *   `deep-link-parser.ts` is a *pure* classifier — it tells you that a URL
 *   resolves to the `referral-gate` screen with a `{ code }` param, but it
 *   performs no side effects (no AsyncStorage, by design). `referral-storage.ts`
 *   is the *side-effecting* AsyncStorage boundary, but it knows nothing about
 *   URLs. This module is the thin glue between them:
 *
 *     parse the URL → if (and only if) it is a `/r/:code` referral link with
 *     a non-empty code, stash that code (last-wins) and return it; otherwise
 *     do nothing and return `null`.
 *
 *   Keeping this logic in a standalone, dependency-injected function — rather
 *   than inlining it into the expo-linking hook — makes the
 *   "which URLs stash, and what exactly gets written" decision unit-testable
 *   without React, expo-router, or a real AsyncStorage backend.
 *
 * Scope discipline:
 *   Only the canonical referral path (`/r/:code`, which the parser surfaces
 *   as `screen === 'referral-gate'` with a `code` param) is stashed. The
 *   `referrer_code` UTM parameter on a `welcome-hook` campaign link is an
 *   acquisition-attribution concern handled by the UTM allowlist elsewhere
 *   and is deliberately NOT stashed here, so the stashed code always maps
 *   1:1 to a deliberate referral-link tap.
 */
import { parseDeepLink } from './deep-link-parser';
import { FUNNEL_KEBAB_SLUGS } from './linking.config';
import { writeStashedReferralCode } from './storage/referral-storage';

/**
 * Write side of the referral stash, injectable so tests can assert the
 * exact value written (and the last-wins ordering) without a real
 * AsyncStorage backend. Defaults to the real `writeStashedReferralCode`.
 */
export type StashReferralCodeWriter = (code: string) => Promise<void>;

/**
 * Parse `url` and, if it is a `/r/:code` referral deep link carrying a
 * non-empty code, stash that code (last-wins) and return it. For every
 * other URL — non-referral paths, blocked URLs, an empty code segment —
 * this is a no-op that returns `null`.
 *
 * Last-wins: each successful call delegates to `write`, which overwrites
 * any previously-stashed code. No TTL: only the bare code string is
 * persisted.
 *
 * @param url - the raw inbound deep-link URL (e.g. from `expo-linking`'s
 *   `useURL()` / `getInitialURL()`).
 * @param write - injectable stash writer (defaults to the AsyncStorage
 *   wrapper). Override in tests.
 * @returns the stashed code on success, or `null` when nothing was stashed.
 */
export async function stashReferralCodeFromDeepLink(
  url: string,
  write: StashReferralCodeWriter = writeStashedReferralCode,
): Promise<string | null> {
  const result = parseDeepLink(url);
  if (result.status !== 'ok') {
    return null;
  }
  if (result.screen !== FUNNEL_KEBAB_SLUGS.referral_gate) {
    return null;
  }
  // `noUncheckedIndexedAccess` makes this `string | undefined`; the parser
  // only emits a `code` key for the `/r/:code` path with a non-empty
  // segment, but we re-check defensively so a future parser change cannot
  // stash an empty string.
  const code = result.params.code;
  if (code === undefined || code.length === 0) {
    return null;
  }
  await write(code);
  return code;
}
