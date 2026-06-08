/**
 * Generation funnel copy — Sub-AC 3b.
 *
 * Functions that produce ALL user-facing strings emitted during the AI photo-
 * generation flow:
 *
 *   1. `getCandidateCountLabel(count, config?)` — candidate-count header above
 *      the generated photo grid (template slot: `generation_candidate_count_label`).
 *
 *   2. `getSelectionPrompt(config?)` — instruction shown to the user to choose
 *      their final pick from the filtered candidate set
 *      (slot: `generation_pick_prompt`).
 *
 *   3. `getEnhancerStatusMessage(config?)` — micro-copy shown while the hidden
 *      server-side de-slop enhancer pipeline is running
 *      (slot: `generation_enhancing_label`).
 *
 * Design contract (Seed Sub-AC 3b):
 *   - Every function accepts an optional `VoiceConfig` parameter so callers
 *     (including unit tests) can inject any config — including a stub — without
 *     relying on module-level mocking.
 *   - When no config is provided the functions fall back to `VOICE_CONFIG`, the
 *     frozen production singleton from `voice/config.ts`.
 *   - **No string literal** from the generation flow is hardcoded in this
 *     module.  All copy derives exclusively from the injected (or default)
 *     config's `slots`.  This is what the unit test verifies via a stub whose
 *     values are entirely different from production Korean copy.
 *
 * Enhancer moat note:
 *   The `getEnhancerStatusMessage` copy surfaces the hidden enhancer to the
 *   user as "자동 보정 중" — making the de-slop pipeline legible without
 *   disclosing the recipe.  The copy itself must not describe *what* the
 *   enhancer does in detail (that would commoditise the moat).
 *
 * No side effects, no vendor calls, no I/O.  Pure functions.
 */

import { VOICE_CONFIG, type VoiceConfig } from '../voice/config.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the candidate count label for `count` generated AI photos.
 *
 * The voice config slot (`generation_candidate_count_label`) is a template
 * that may contain the `{{count}}` placeholder; this function substitutes it
 * with the actual integer before returning.
 *
 * @example
 *   getCandidateCountLabel(4)
 *   // → "후보 4장 생성됨"  (using production VOICE_CONFIG)
 *
 * @param count  Number of AI-generated candidates produced in this run.
 * @param config Optional voice config to use; defaults to `VOICE_CONFIG`.
 */
export function getCandidateCountLabel(
  count: number,
  config: VoiceConfig = VOICE_CONFIG,
): string {
  return config.slots.generation_candidate_count_label.replace(
    '{{count}}',
    String(count),
  );
}

/**
 * Returns the selection prompt displayed above the filtered candidate grid,
 * prompting the user to pick their final photo.
 *
 * @param config Optional voice config to use; defaults to `VOICE_CONFIG`.
 */
export function getSelectionPrompt(config: VoiceConfig = VOICE_CONFIG): string {
  return config.slots.generation_pick_prompt;
}

/**
 * Returns the enhancer status message shown in the UI while the hidden
 * server-side de-slop enhancer pipeline processes the AI candidates.
 *
 * @param config Optional voice config to use; defaults to `VOICE_CONFIG`.
 */
export function getEnhancerStatusMessage(
  config: VoiceConfig = VOICE_CONFIG,
): string {
  return config.slots.generation_enhancing_label;
}
