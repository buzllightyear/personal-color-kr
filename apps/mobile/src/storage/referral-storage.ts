/**
 * Referral-code AsyncStorage wrapper — Phase 4.5 stashed-referral-code
 * boundary for the `@react-native-async-storage/async-storage` library.
 *
 * Responsibility (Seed constraint / ontology `stashed_referral_code`):
 *   Persist the single referral code parsed out of an inbound `/r/:code`
 *   deep link so that a *later* Apple Sign In request (a sibling AC) can
 *   transmit it for referee attribution. The code outlives the deep-link
 *   event (the user may browse the whole funnel before signing in), so it
 *   cannot live only in in-memory React Context — it must survive an app
 *   backgrounding / cold relaunch, which is exactly what AsyncStorage
 *   provides.
 *
 * The three Seed-locked semantics this module encodes:
 *   - **last-wins** — every `writeStashedReferralCode` call overwrites any
 *     previously-stashed code (`setItem` is inherently last-write-wins).
 *     If a user taps two referral links before signing in, the most
 *     recent code is the one attributed.
 *   - **no TTL** — only the bare code string is stored; there is no
 *     timestamp and no expiry sweep. A stashed code is valid until it is
 *     either overwritten (last-wins) or explicitly cleared.
 *   - **cleanup after attribution** — `clearStashedReferralCode` removes
 *     the key entirely. The sibling sign-in flow calls it once attribution
 *     has been transmitted so a code is never double-attributed on a
 *     subsequent sign-in.
 *
 * Why this lives in `src/storage/` alongside `post-payment-storage.ts`:
 *   The `src/storage/` directory is the single AsyncStorage import
 *   boundary for the mobile app (asserted by
 *   `tests/asyncstorage-boundary-isolation.test.ts`). Keeping the referral
 *   stash in its own file — rather than bolting funnel-acquisition keys
 *   onto the post-payment wrapper — keeps each wrapper cohesive to one
 *   surface (post-payment vs. referral funnel) while preserving the
 *   directory-level boundary. Drift (a source file outside `src/storage/`
 *   importing AsyncStorage directly) still fails the isolation test.
 *
 * Why a namespaced (`pck.referral.*`) key:
 *   AsyncStorage is a process-global key/value store. The `pck` prefix
 *   (personal-color-kr) makes the key grep-discoverable and collision-safe
 *   against the existing `pck.post_payment.*` keys. The `referral`
 *   segment scopes it to this surface.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * AsyncStorage namespaced key — the referral code stashed from an inbound
 * `/r/:code` deep link, awaiting transmission on the next Apple Sign In.
 *
 * Held as an exported `const` so the key (which would otherwise be a
 * stringly-typed magic value) is auditable from one place and impossible
 * to fat-finger across the (eventual) sign-in read site.
 */
export const STASHED_REFERRAL_CODE_STORAGE_KEY =
  'pck.referral.stashed_code' as const;

/**
 * Stash a referral code parsed from a deep link.
 *
 * Last-wins by construction: `AsyncStorage.setItem` overwrites any prior
 * value under the same key, so the most-recently-tapped referral link is
 * the code that will be attributed at sign-in. Only the bare code string
 * is written — no timestamp, no envelope — which is what makes the "no
 * TTL" semantics hold (there is nothing to expire against).
 *
 * @param code - the URL-safe referral code from the `/r/:code` path
 *   segment. Callers are expected to have already rejected empty / absent
 *   codes (see `stash-referral-code.ts`); this function does not validate.
 */
export async function writeStashedReferralCode(code: string): Promise<void> {
  await AsyncStorage.setItem(STASHED_REFERRAL_CODE_STORAGE_KEY, code);
}

/**
 * Read the stashed referral code, or `null` when none has been stashed
 * (the organic-signup case) or after it has been cleared.
 *
 * Returns the raw string verbatim — narrowing / validation of the code
 * shape is a server-side concern (the server silently skips an invalid
 * code per the attribution contract), so the client does not second-guess
 * what it stored.
 */
export async function readStashedReferralCode(): Promise<string | null> {
  return AsyncStorage.getItem(STASHED_REFERRAL_CODE_STORAGE_KEY);
}

/**
 * Remove the stashed referral code.
 *
 * Called by the sign-in flow once a referral code has been transmitted
 * for attribution (cleanup-after-attribution semantics) so the same code
 * cannot be re-sent on a later sign-in. Idempotent — removing an absent
 * key is a no-op, so it is safe to call unconditionally.
 */
export async function clearStashedReferralCode(): Promise<void> {
  await AsyncStorage.removeItem(STASHED_REFERRAL_CODE_STORAGE_KEY);
}
