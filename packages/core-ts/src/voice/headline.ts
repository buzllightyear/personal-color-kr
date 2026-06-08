/**
 * Headline derivation from VoiceConfig — Sub-AC 13b-2.
 *
 * `deriveHeadline` is the single pure function that deterministically maps a
 * VoiceConfig to the primary app headline string.
 *
 * Design contract (Sub-AC 13b-2):
 *   - **Pure function** — no side effects, no I/O, no vendor calls.
 *   - **Deterministic** — same VoiceConfig input always produces the same
 *     headline string output.  Referentially transparent.
 *   - **Voice-config-driven** — all copy derives exclusively from the injected
 *     config's `slots`.  No hardcoded string literals.
 *   - **Single-voice** — the function does not branch on voiceId or implement
 *     any form of tone switching.  It reads the authoritative slot value that
 *     the operator has already authored in the config.
 *
 * Context (Seed moat):
 *   The "primary app headline" is the *above-the-fold* promise of the Korean-
 *   market selfie-generation app — the first copy the user encounters at the
 *   entry wedge.  It expresses both voice axes (트렌드 타이밍 + 사진 감각) in one
 *   sentence without any appearance/styling language.
 *
 *   The operator authors this headline in `VOICE_CONFIG.slots.diagnosis_wedge_headline`.
 *   `deriveHeadline` is the stable derivation contract that callers (screens,
 *   analytics, A/B harnesses) use to access it — without coupling to the slot
 *   key name or the singleton import.
 *
 * No side effects, no vendor calls, no I/O.  Pure function.
 */

import { type VoiceConfig } from './config.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Derives the primary app headline string from a VoiceConfig.
 *
 * Returns `config.slots.diagnosis_wedge_headline` — the entry-wedge headline
 * that is the app's first and most authoritative copy surface.  The function
 * is intentionally thin: the operator's editorial decision is already encoded
 * in the config; this function is the stable dispatch point that callers
 * depend on.
 *
 * Different VoiceConfig objects (representing different operator personas or
 * test stubs) produce deterministically different headline strings, making
 * the function fully unit-testable without module-level mocking.
 *
 * @example
 *   import { VOICE_CONFIG } from '../voice/config.js';
 *   import { deriveHeadline } from '../voice/headline.js';
 *
 *   deriveHeadline(VOICE_CONFIG);
 *   // → "내 퍼스널 컬러로 셀카 구도와 빛을 찾아드려요"
 *
 * @param config - The VoiceConfig to derive the headline from.
 *                 Typically `VOICE_CONFIG` in production; any stub in tests.
 * @returns The resolved primary headline string (no template placeholders).
 */
export function deriveHeadline(config: VoiceConfig): string {
  return config.slots.diagnosis_wedge_headline;
}
