/**
 * Unit tests — Single voice config module (Sub-AC 2).
 *
 * Verifies:
 *   - The module exports a `VOICE_CONFIG` object.
 *   - `voiceId` is present, non-empty, and equals the expected stable value.
 *   - `description` is present and non-empty.
 *   - Every declared copy slot in `VoiceCopySlots` is present and non-empty.
 *   - The config object and its `slots` sub-object are frozen (immutable).
 *   - Only one voice is exported (ToneSwitcher regression guard).
 *
 * These assertions match the Sub-AC 2 acceptance criteria:
 *   "a unit test imports the module and asserts required fields are present
 *    and non-empty."
 */
import { describe, expect, it } from 'vitest';

import { VOICE_CONFIG, type VoiceCopySlots, type VoiceConfig } from '../../src/voice/config.js';

// ---------------------------------------------------------------------------
// Required slot keys — derived from the VoiceCopySlots interface.
// Listing them explicitly ensures the test catches a renamed or deleted slot.
// ---------------------------------------------------------------------------

const REQUIRED_SLOT_KEYS: ReadonlyArray<keyof VoiceCopySlots> = [
  'trend_drop_push_title',
  'trend_drop_push_body',
  'trend_drop_cta_primary',
  // Entry wedge — diagnosis & onboarding (Sub-AC 3c)
  'diagnosis_wedge_headline',
  'diagnosis_wedge_subhead',
  'diagnosis_wedge_cta',
  'result_reveal_cta',
  // Result reveal
  'result_reveal_headline',
  'result_reveal_subhead',
  // Generation funnel (Sub-AC 3b)
  'generation_candidate_count_label',
  'generation_pick_prompt',
  'generation_enhancing_label',
  // Payment (Sub-AC 3d)
  'payment_value_prop',
  'payment_step_headline',
  'payment_step_subhead',
  'payment_step_body',
  'payment_annual_plan_cta',
  'payment_monthly_plan_cta',
  'payment_upsell_prompt',
  'payment_confirmed_headline',
  'payment_confirmed_subhead',
  'free_trial_emphasis',
] as const;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VOICE_CONFIG — Sub-AC 2: single voice config module', () => {
  it('exports a VOICE_CONFIG object', () => {
    expect(VOICE_CONFIG).toBeDefined();
    expect(typeof VOICE_CONFIG).toBe('object');
    expect(VOICE_CONFIG).not.toBeNull();
  });

  it('has a non-empty voiceId string', () => {
    expect(typeof VOICE_CONFIG.voiceId).toBe('string');
    expect(VOICE_CONFIG.voiceId.trim()).not.toBe('');
  });

  it('voiceId equals the stable "trend-editor-kr" identifier', () => {
    // This value is the analytics key — must never drift silently.
    expect(VOICE_CONFIG.voiceId).toBe('trend-editor-kr');
  });

  it('has a non-empty description', () => {
    expect(typeof VOICE_CONFIG.description).toBe('string');
    expect(VOICE_CONFIG.description.trim()).not.toBe('');
  });

  it('has a slots object', () => {
    expect(VOICE_CONFIG.slots).toBeDefined();
    expect(typeof VOICE_CONFIG.slots).toBe('object');
    expect(VOICE_CONFIG.slots).not.toBeNull();
  });

  it.each(REQUIRED_SLOT_KEYS)(
    'slot "%s" is present and non-empty',
    (slotKey) => {
      const value = VOICE_CONFIG.slots[slotKey];
      expect(
        typeof value,
        `slots.${slotKey} should be a string`,
      ).toBe('string');
      expect(
        (value as string).trim(),
        `slots.${slotKey} must not be blank`,
      ).not.toBe('');
    },
  );

  it('all required slots are covered — no slot key is missing', () => {
    for (const key of REQUIRED_SLOT_KEYS) {
      expect(
        Object.prototype.hasOwnProperty.call(VOICE_CONFIG.slots, key),
        `Missing required slot: ${key}`,
      ).toBe(true);
    }
  });

  it('VOICE_CONFIG is frozen (immutable)', () => {
    expect(Object.isFrozen(VOICE_CONFIG)).toBe(true);
  });

  it('VOICE_CONFIG.slots is frozen (immutable)', () => {
    expect(Object.isFrozen(VOICE_CONFIG.slots)).toBe(true);
  });

  it('satisfies the VoiceConfig interface shape (type-level assertion)', () => {
    // TypeScript structural check — assigning to VoiceConfig typed variable
    // will fail at compile time if the shape diverges.
    const typed: Readonly<VoiceConfig> = VOICE_CONFIG;
    expect(typed.voiceId).toBeDefined();
    expect(typed.slots).toBeDefined();
  });
});

describe('VOICE_CONFIG — ToneSwitcher regression guard', () => {
  it('exports exactly one voice object (not an array or multi-voice map)', () => {
    // If someone re-introduces a multi-voice pattern, this test fails.
    // The module should export a single config object, not a collection.
    expect(Array.isArray(VOICE_CONFIG)).toBe(false);
    // voiceId is a scalar string, not an array of IDs
    expect(Array.isArray(VOICE_CONFIG.voiceId)).toBe(false);
  });

  it('voiceId does not include legacy tone names (다정 / 에디토리얼 / 유쾌 / 시적)', () => {
    const legacyToneNames = ['다정', '에디토리얼', '유쾌', '시적'];
    for (const tone of legacyToneNames) {
      expect(
        VOICE_CONFIG.voiceId.includes(tone),
        `voiceId must not contain legacy tone name "${tone}"`,
      ).toBe(false);
    }
  });
});
