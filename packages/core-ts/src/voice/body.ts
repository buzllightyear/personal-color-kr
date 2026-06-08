/**
 * Body copy derivation from VoiceConfig — Sub-AC 13b-3.
 *
 * `deriveBody` is the single pure function that deterministically maps a
 * VoiceConfig to the primary body copy string.
 *
 * Design contract (Sub-AC 13b-3):
 *   - **Pure function** — no side effects, no I/O, no vendor calls.
 *   - **Deterministic** — same VoiceConfig input always produces the same
 *     body string output.  Referentially transparent.
 *   - **Voice-config-driven** — all copy derives exclusively from the injected
 *     config's `slots.payment_step_body`.  No hardcoded string literals.
 *   - **Single-voice** — the function does not branch on voiceId or implement
 *     any form of tone switching.  It reads the authoritative slot value that
 *     the operator has already authored in the config.
 *   - **Edge-case-safe** — empty or whitespace-only slot values are coerced to
 *     an empty string; values longer than `BODY_MAX_LENGTH` characters are
 *     truncated.  Both behaviours are unit-tested with boundary inputs.
 *
 * Edge cases (tested by boundary-value unit tests):
 *   1. **Empty slot** (`''`) → returns `''`.
 *   2. **Whitespace-only slot** (`'   '`) → returns `''`.
 *   3. **Slot length === BODY_MAX_LENGTH** → returns the string unchanged.
 *   4. **Slot length > BODY_MAX_LENGTH** → returns a truncated string of
 *      exactly `BODY_MAX_LENGTH` characters.
 *   5. **Normal slot** (non-empty, within limit) → returns the string unchanged.
 *
 * Context (Seed moat):
 *   The "primary body copy" is the explanatory paragraph shown on the
 *   step-12 payment screen — describing the free-trial breakdown (7-day base
 *   + 30-day annual bonus = 37 total days).  The operator authors this text in
 *   `VOICE_CONFIG.slots.payment_step_body`.
 *
 *   `deriveBody` is the stable derivation contract that callers (screens,
 *   analytics, A/B harnesses) use to access it — without coupling to the slot
 *   key name or the singleton import.
 *
 * No side effects, no vendor calls, no I/O.  Pure function.
 */

import { type VoiceConfig } from './config.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum character length for derived body copy.
 *
 * Body copy strings that exceed this limit are truncated to `BODY_MAX_LENGTH`
 * characters.  The value is chosen to be comfortably above the longest
 * expected production body text (≈ 80 Korean characters ≈ 240 bytes) while
 * staying within a reasonable screen-render budget for a mobile UI paragraph.
 *
 * Exported so unit tests can construct boundary-value inputs without
 * hardcoding the magic number.
 */
export const BODY_MAX_LENGTH = 300;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Derives the primary body copy string from a VoiceConfig.
 *
 * Returns `config.slots.payment_step_body` after applying two safety
 * transforms:
 *
 *   1. **Empty guard** — if the slot value is an empty string or contains only
 *      whitespace, `''` is returned.  This makes the function safe to call
 *      even with minimal test stubs that leave the body slot blank.
 *
 *   2. **Length cap** — if the resolved value exceeds `BODY_MAX_LENGTH`
 *      characters, it is truncated to exactly `BODY_MAX_LENGTH` characters.
 *      No ellipsis is appended; callers that want a visual indicator are
 *      responsible for adding it.
 *
 * The production `VOICE_CONFIG.slots.payment_step_body` is well within the
 * length cap, so normal usage never triggers truncation.
 *
 * @example
 *   import { VOICE_CONFIG } from '../voice/config.js';
 *   import { deriveBody } from '../voice/body.js';
 *
 *   deriveBody(VOICE_CONFIG);
 *   // → "연결제를 고르면 기본 7일 무료체험에 30일이 더해져 총 37일 무료. ..."
 *
 * @param config - The VoiceConfig to derive the body copy from.
 *                 Typically `VOICE_CONFIG` in production; any stub in tests.
 * @returns The resolved body copy string, empty if the slot is blank,
 *          truncated at `BODY_MAX_LENGTH` if the slot is too long.
 */
export function deriveBody(config: VoiceConfig): string {
  const raw: string = config.slots.payment_step_body;

  // Edge case 1 & 2: empty / whitespace-only → return empty string.
  if (raw.trim() === '') {
    return '';
  }

  // Edge case 4: exceeds max length → truncate.
  if (raw.length > BODY_MAX_LENGTH) {
    return raw.slice(0, BODY_MAX_LENGTH);
  }

  // Normal case: return as-is.
  return raw;
}
