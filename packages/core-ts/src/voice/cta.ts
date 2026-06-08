/**
 * CTA derivation from VoiceConfig — Sub-AC 13b-4.
 *
 * `deriveCta` is the single pure function that deterministically maps a
 * VoiceConfig to the primary CTA (Call-to-Action) string.
 *
 * Design contract (Sub-AC 13b-4):
 *   - **Pure function** — no side effects, no I/O, no vendor calls.
 *   - **Deterministic** — same VoiceConfig input always produces the same
 *     CTA string output.  Referentially transparent.
 *   - **Voice-config-driven** — all copy derives exclusively from the injected
 *     config's `slots.trend_drop_cta_primary`.  No hardcoded string literals.
 *   - **Single-voice** — the function does not branch on voiceId or implement
 *     any form of tone switching.  It reads the authoritative slot value that
 *     the operator has already authored in the config.
 *   - **Edge-case-safe** — empty or whitespace-only slot values are coerced to
 *     an empty string; values longer than `CTA_MAX_LENGTH` characters are
 *     truncated.  Both behaviours are unit-tested with boundary inputs.
 *
 * Edge cases (tested by boundary-value unit tests):
 *   1. **Empty slot** (`''`) → returns `''`.
 *   2. **Whitespace-only slot** (`'   '`) → returns `''`.
 *   3. **Slot length === CTA_MAX_LENGTH** → returns the string unchanged.
 *   4. **Slot length > CTA_MAX_LENGTH** → returns a truncated string of
 *      exactly `CTA_MAX_LENGTH` characters.
 *   5. **Normal slot** (non-empty, within limit) → returns the string unchanged.
 *
 * Context (Seed moat):
 *   The "primary CTA" is the action prompt shown when a trend drop arrives —
 *   inviting the user to apply the new trend recipe to their selfie.  It is the
 *   most visible copy in the retention loop, so it must express the
 *   트렌드 타이밍 voice axis concisely.
 *
 *   The operator authors this CTA in `VOICE_CONFIG.slots.trend_drop_cta_primary`.
 *   `deriveCta` is the stable derivation contract that callers use — covering
 *   iOS/Android native and web platform surfaces, and both Korean and
 *   ASCII-sentinel test scenarios — without coupling to the slot key or the
 *   singleton import.
 *
 * No side effects, no vendor calls, no I/O.  Pure function.
 */

import { type VoiceConfig } from './config.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum character length for derived CTA copy.
 *
 * CTA strings that exceed this limit are truncated to `CTA_MAX_LENGTH`
 * characters.  60 characters is chosen to fit comfortably within a mobile
 * button element across iOS, Android, and web surfaces without line-wrapping.
 *
 * Exported so unit tests can construct boundary-value inputs without
 * hardcoding the magic number.
 */
export const CTA_MAX_LENGTH = 60;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Derives the primary CTA string from a VoiceConfig.
 *
 * Returns `config.slots.trend_drop_cta_primary` after applying two safety
 * transforms:
 *
 *   1. **Empty guard** — if the slot value is an empty string or contains only
 *      whitespace, `''` is returned.  This makes the function safe to call
 *      even with minimal test stubs that leave the CTA slot blank.
 *
 *   2. **Length cap** — if the resolved value exceeds `CTA_MAX_LENGTH`
 *      characters, it is truncated to exactly `CTA_MAX_LENGTH` characters.
 *      No ellipsis is appended; callers that want a visual indicator are
 *      responsible for adding it.
 *
 * The production `VOICE_CONFIG.slots.trend_drop_cta_primary` is well within
 * the length cap, so normal usage on iOS, Android, and web never triggers
 * truncation.
 *
 * @example
 *   import { VOICE_CONFIG } from '../voice/config.js';
 *   import { deriveCta } from '../voice/cta.js';
 *
 *   deriveCta(VOICE_CONFIG);
 *   // → "지금 내 셀카에 적용하기"
 *
 * @param config - The VoiceConfig to derive the CTA from.
 *                 Typically `VOICE_CONFIG` in production; any stub in tests.
 * @returns The resolved CTA string, empty if the slot is blank,
 *          truncated at `CTA_MAX_LENGTH` if the slot is too long.
 */
export function deriveCta(config: VoiceConfig): string {
  const raw: string = config.slots.trend_drop_cta_primary;

  // Edge case 1 & 2: empty / whitespace-only → return empty string.
  if (raw.trim() === '') {
    return '';
  }

  // Edge case 4: exceeds max length → truncate.
  if (raw.length > CTA_MAX_LENGTH) {
    return raw.slice(0, CTA_MAX_LENGTH);
  }

  // Normal case: return as-is.
  return raw;
}
