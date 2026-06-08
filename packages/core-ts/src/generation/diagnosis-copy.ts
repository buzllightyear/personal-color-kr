/**
 * Personal-colour diagnosis & onboarding copy — Sub-AC 3c.
 *
 * Functions that produce ALL user-facing strings emitted during the
 * **entry-wedge** flow (퍼스널 컬러 진단 → 온보딩 → 결과 공개):
 *
 *   1. `getDiagnosisWedgeHeadline(config?)` — headline for step 1 (welcome_hook /
 *      entry wedge). Voice slot: `diagnosis_wedge_headline`.
 *
 *   2. `getDiagnosisWedgeSubhead(config?)` — supporting subhead for the entry
 *      wedge. Voice slot: `diagnosis_wedge_subhead`.
 *
 *   3. `getDiagnosisWedgeCta(config?)` — primary CTA label that kicks off the
 *      diagnosis flow. Voice slot: `diagnosis_wedge_cta`.
 *
 *   4. `getResultRevealHeadline(season, config?)` — headline shown when the
 *      personal-colour result is revealed (step 9). The slot template contains
 *      `{{season}}`; this function substitutes the runtime season string before
 *      returning. Voice slot: `result_reveal_headline`.
 *
 *   5. `getResultRevealSubhead(config?)` — supporting subhead on the result
 *      reveal screen, surfacing photo-craft sensibility. Voice slot:
 *      `result_reveal_subhead`.
 *
 *   6. `getResultRevealCta(config?)` — primary CTA label on the result reveal
 *      screen (step 9) prompting the user to unlock. Voice slot:
 *      `result_reveal_cta`.
 *
 * Design contract (Seed Sub-AC 3c):
 *   - Every function accepts an optional `VoiceConfig` parameter so callers
 *     (including unit tests) can inject any config — including a stub — without
 *     relying on module-level mocking.
 *   - When no config is provided the functions fall back to `VOICE_CONFIG`, the
 *     frozen production singleton from `voice/config.ts`.
 *   - **No string literal** from the diagnosis/onboarding flow is hardcoded in
 *     this module. All copy derives exclusively from the injected (or default)
 *     config's `slots`. The unit test verifies this via a stub whose values are
 *     entirely different from production Korean copy.
 *   - These functions cover the full entry-wedge surface: diagnosis steps,
 *     result reveal, and CTA text — satisfying the Sub-AC 3c scope.
 *
 * Voice constraints (Seed-derived):
 *   - Copy reflects 트렌드 타이밍 and 사진 감각 only — no appearance/styling language.
 *   - No legacy ToneSwitcher (다정 / 에디토리얼 / 유쾌 / 시적) strings — these
 *     are the 4-tone regression markers detected by the unit test.
 *
 * No side effects, no vendor calls, no I/O. Pure functions.
 */

import { VOICE_CONFIG, type VoiceConfig } from '../voice/config.js';

// ---------------------------------------------------------------------------
// Public API — entry wedge copy (steps 1–3 diagnosis funnel surface)
// ---------------------------------------------------------------------------

/**
 * Returns the headline for the personal-colour diagnosis entry wedge
 * (step 1 welcome hook). The voice config slot is used verbatim — no
 * template placeholders are defined for this slot.
 *
 * @param config Optional voice config to use; defaults to `VOICE_CONFIG`.
 */
export function getDiagnosisWedgeHeadline(config: VoiceConfig = VOICE_CONFIG): string {
  return config.slots.diagnosis_wedge_headline;
}

/**
 * Returns the subhead for the entry wedge, supporting the headline with
 * a brief value-proposition copy line.
 *
 * @param config Optional voice config to use; defaults to `VOICE_CONFIG`.
 */
export function getDiagnosisWedgeSubhead(config: VoiceConfig = VOICE_CONFIG): string {
  return config.slots.diagnosis_wedge_subhead;
}

/**
 * Returns the primary CTA label that initiates the personal-colour
 * diagnosis flow (the "1분 진단 시작하기" equivalent).
 *
 * @param config Optional voice config to use; defaults to `VOICE_CONFIG`.
 */
export function getDiagnosisWedgeCta(config: VoiceConfig = VOICE_CONFIG): string {
  return config.slots.diagnosis_wedge_cta;
}

// ---------------------------------------------------------------------------
// Public API — result reveal copy (step 9 surface)
// ---------------------------------------------------------------------------

/**
 * Returns the result-reveal headline for the given personal-colour season.
 *
 * The voice config slot (`result_reveal_headline`) is a template that may
 * contain the `{{season}}` placeholder; this function substitutes it with the
 * actual season string before returning.
 *
 * @example
 *   getResultRevealHeadline('봄 웜톤')
 *   // → "봄 웜톤 — 지금 가장 잘 맞는 구도와 빛을 찾았어요"  (production config)
 *
 * @param season  The user's diagnosed personal-colour season category.
 * @param config  Optional voice config to use; defaults to `VOICE_CONFIG`.
 */
export function getResultRevealHeadline(
  season: string,
  config: VoiceConfig = VOICE_CONFIG,
): string {
  return config.slots.result_reveal_headline.replace('{{season}}', season);
}

/**
 * Returns the result-reveal subhead — supporting copy that surfaces the
 * photo-craft sensibility of the single editorial voice.
 *
 * @param config Optional voice config to use; defaults to `VOICE_CONFIG`.
 */
export function getResultRevealSubhead(config: VoiceConfig = VOICE_CONFIG): string {
  return config.slots.result_reveal_subhead;
}

/**
 * Returns the primary CTA label on the result-reveal screen (step 9),
 * prompting the user to proceed to unlock their diagnosed result.
 *
 * @param config Optional voice config to use; defaults to `VOICE_CONFIG`.
 */
export function getResultRevealCta(config: VoiceConfig = VOICE_CONFIG): string {
  return config.slots.result_reveal_cta;
}
