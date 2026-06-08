/**
 * Post-payment AsyncStorage wrapper — single import boundary for the
 * `@react-native-async-storage/async-storage` library.
 *
 * Responsibility:
 *   Encapsulate every AsyncStorage call the post-payment surface needs
 *   behind a typed function API. Two persisted keys back two ontology fields:
 *
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
 *   - **Single key registry.** The namespaced keys are defined as exported
 *     constants so the keys (which would otherwise be stringly-typed magic)
 *     are auditable from one file and impossible to fat-finger across
 *     call sites.
 *   - **DI-friendly testing.** Hooks that need to read or write tab /
 *     reveal state inject the read+write functions as callable parameters,
 *     so the vitest suites do not have to mock the AsyncStorage module at
 *     the module-graph level.
 *
 * Why namespaced (`pck.post_payment.*`) keys:
 *   AsyncStorage is a process-global key/value store on the device. A
 *   future module-level rename collides only with another `pck.*`
 *   consumer — and the `pck` prefix makes it grep-discoverable across
 *   the entire codebase.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Closed enum of the 4 post-payment tab identifiers.
 */
export type TabKey = 'edit' | 'diagnosis' | 'guide' | 'curation';

/**
 * AsyncStorage namespaced key — most-recently-active post-payment tab.
 * Persisted on every tab switch and read on app launch to restore the
 * user to the tab they last viewed.
 */
export const LAST_POST_PAYMENT_TAB_STORAGE_KEY = 'pck.post_payment.last_tab' as const;

/**
 * AsyncStorage namespaced key — first-entry reveal gate. Written `true`
 * once the user has dismissed `diagnosis-reveal`; thereafter the
 * (post-payment) `_layout.tsx` short-circuits the redirect and routes
 * the user straight into the (tabs) shell.
 */
export const DIAGNOSIS_REVEAL_SEEN_STORAGE_KEY =
  'pck.post_payment.diagnosis_reveal_seen' as const;

const TAB_VALUES: readonly TabKey[] = ['edit', 'diagnosis', 'guide', 'curation'];

function narrowTab(raw: string | null): TabKey | null {
  if (raw === null) {
    return null;
  }
  return (TAB_VALUES as readonly string[]).includes(raw) ? (raw as TabKey) : null;
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
