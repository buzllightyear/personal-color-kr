/**
 * Post-payment AsyncStorage wrapper — Phase 3.3 single import boundary
 * for the `@react-native-async-storage/async-storage` library.
 *
 * Responsibility (Seed constraint, AC 14):
 *   Encapsulate every AsyncStorage call the post-payment surface needs
 *   behind a typed function API. Three persisted keys back three
 *   ontology fields:
 *
 *     - `pck.post_payment.last_tone`           → ToneState.current (Season)
 *     - `pck.post_payment.last_tab`            → LastPostPaymentTab (TabKey)
 *     - `pck.post_payment.diagnosis_reveal_seen` → DiagnosisRevealSeen (boolean)
 *
 * Why a thin wrapper module rather than direct AsyncStorage imports at
 * each call site:
 *   - **Boundary isolation (testable invariant).** The sibling test
 *     `apps/mobile/tests/asyncstorage-boundary-isolation.test.ts`
 *     greps the entire `apps/mobile/src` and `apps/mobile/app` trees
 *     and asserts that this file is the ONLY source that imports
 *     `@react-native-async-storage/async-storage`. Drift surfaces as a
 *     test failure rather than a quiet code smell.
 *   - **Single key registry.** The three namespaced keys are defined
 *     as exported constants so the keys (which would otherwise be
 *     stringly-typed magic) are auditable from one file and impossible
 *     to fat-finger across call sites.
 *   - **DI-friendly testing.** Hooks and providers that need to read or
 *     write tone / tab / reveal state inject the read+write functions
 *     as callable parameters, so the vitest suites do not have to mock
 *     the AsyncStorage module at the module-graph level. The wrapper
 *     itself is unit-tested against a `Pick<typeof AsyncStorage,
 *     'getItem'|'setItem'>` stub.
 *
 * Why namespaced (`pck.post_payment.*`) keys:
 *   AsyncStorage is a process-global key/value store on the device. A
 *   future module-level rename collides only with another `pck.*`
 *   consumer — and the `pck` prefix makes it grep-discoverable across
 *   the entire codebase. (`pck` = personal-color-kr; same prefix the
 *   funnel slice planned to use when it lands its persistence in
 *   Phase 3.)
 *
 * Why hook-internal swap-friendly default values:
 *   Each `read*` returns `null | T` (or `false` for the boolean reveal
 *   gate). Callers narrow the null branch to a sensible default (the
 *   first-install fixture diagnosis season for tone, `'edit'` for tab,
 *   `false` for reveal-seen). Returning `null` rather than the default
 *   keeps the "have we ever persisted this?" signal observable —
 *   important for the Phase 4 hook swap so the future Python-funnel
 *   diagnosis source can distinguish "user has touched the switcher"
 *   from "fresh install, follow the diagnosis default".
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Closed enum of the 4 Korean personal-color seasons. Mirrors the
 * `Season` alias defined locally in each `track-*.ts` analytics module
 * (see e.g. `../analytics/track-post-payment-revealed.ts`). Defined
 * locally so the storage wrapper compiles independently of the
 * analytics surface; a future shared `Season` alias is a 1-line import
 * swap.
 */
export type Season =
  | 'spring-warm'
  | 'summer-cool'
  | 'autumn-warm'
  | 'winter-cool';

/**
 * Closed enum of the 4 post-payment tab identifiers.
 */
export type TabKey = 'edit' | 'diagnosis' | 'guide' | 'curation';

/**
 * AsyncStorage namespaced key — current Tone Switcher selection.
 * Persisted across app restart per Seed constraint
 * "Global tone state ... persisted via AsyncStorage namespaced key
 * 'pck.post_payment.last_tone'".
 */
export const LAST_TONE_STORAGE_KEY = 'pck.post_payment.last_tone' as const;

/**
 * AsyncStorage namespaced key — most-recently-active post-payment tab.
 * Persisted on every tab switch and read on app launch to restore the
 * user to the tab they last viewed.
 */
export const LAST_POST_PAYMENT_TAB_STORAGE_KEY =
  'pck.post_payment.last_tab' as const;

/**
 * AsyncStorage namespaced key — first-entry reveal gate. Written `true`
 * once the user has dismissed `diagnosis-reveal`; thereafter the
 * (post-payment) `_layout.tsx` short-circuits the redirect and routes
 * the user straight into the (tabs) shell.
 */
export const DIAGNOSIS_REVEAL_SEEN_STORAGE_KEY =
  'pck.post_payment.diagnosis_reveal_seen' as const;

const SEASON_VALUES: readonly Season[] = [
  'spring-warm',
  'summer-cool',
  'autumn-warm',
  'winter-cool',
];

const TAB_VALUES: readonly TabKey[] = ['edit', 'diagnosis', 'guide', 'curation'];

/**
 * Narrow an arbitrary string read back from AsyncStorage to the closed
 * `Season` enum. Returns `null` when the value is missing or has
 * drifted away from the enum (e.g. a manual edit by a future
 * developer).
 *
 * Why a runtime check at the boundary: AsyncStorage is untyped — its
 * `getItem` returns `Promise<string | null>`. The narrow function is
 * the only place we cross that trust boundary, so we centralize the
 * defensive parse rather than scatter `as Season` casts across the
 * hooks.
 */
function narrowSeason(raw: string | null): Season | null {
  if (raw === null) {
    return null;
  }
  return (SEASON_VALUES as readonly string[]).includes(raw)
    ? (raw as Season)
    : null;
}

function narrowTab(raw: string | null): TabKey | null {
  if (raw === null) {
    return null;
  }
  return (TAB_VALUES as readonly string[]).includes(raw)
    ? (raw as TabKey)
    : null;
}

/**
 * Read the persisted Tone Switcher selection. Returns `null` on first
 * install (or after a corrupted write) so callers can fall back to the
 * diagnosis season from the first-install fixture.
 */
export async function readLastTone(): Promise<Season | null> {
  const raw = await AsyncStorage.getItem(LAST_TONE_STORAGE_KEY);
  return narrowSeason(raw);
}

/**
 * Persist a new Tone Switcher selection.
 *
 * @param season - the Season the user just picked.
 */
export async function writeLastTone(season: Season): Promise<void> {
  await AsyncStorage.setItem(LAST_TONE_STORAGE_KEY, season);
}

/**
 * Read the persisted most-recent tab. Returns `null` on first install
 * so callers can default to `'edit'` (the Seed-locked primary tab).
 */
export async function readLastPostPaymentTab(): Promise<TabKey | null> {
  const raw = await AsyncStorage.getItem(LAST_POST_PAYMENT_TAB_STORAGE_KEY);
  return narrowTab(raw);
}

/**
 * Persist the active tab.
 */
export async function writeLastPostPaymentTab(tab: TabKey): Promise<void> {
  await AsyncStorage.setItem(LAST_POST_PAYMENT_TAB_STORAGE_KEY, tab);
}

/**
 * Read the diagnosis-reveal-seen gate. Returns `false` on first install
 * (and after a corrupted write) so the reveal fires by default —
 * matches the fail-loud-but-safe stance documented in the
 * `(post-payment)/_layout.tsx` rationale.
 */
export async function readDiagnosisRevealSeen(): Promise<boolean> {
  const raw = await AsyncStorage.getItem(DIAGNOSIS_REVEAL_SEEN_STORAGE_KEY);
  return raw === 'true';
}

/**
 * Mark the diagnosis-reveal as seen. Called by the reveal screen on
 * dismiss so subsequent app launches skip the full-screen reveal.
 */
export async function writeDiagnosisRevealSeen(seen: boolean): Promise<void> {
  await AsyncStorage.setItem(
    DIAGNOSIS_REVEAL_SEEN_STORAGE_KEY,
    seen ? 'true' : 'false',
  );
}
