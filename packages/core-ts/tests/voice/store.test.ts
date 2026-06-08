/**
 * Unit tests — VoiceConfigStore UPDATE (Sub-AC 13c-3).
 *
 * Verifies that:
 *   - `update()` correctly reflects changed fields in the returned snapshot.
 *   - `update()` preserves all fields that were NOT included in the patch.
 *   - Partial `slots` updates change only the specified slot keys.
 *   - `description` updates leave all slot values intact.
 *   - `voiceId` is never changed by an update call.
 *   - The returned snapshot from `update()` is deep-frozen.
 *   - `update()` with an empty patch is a no-op that returns identical values.
 *   - `update()` rejects patches containing empty slot strings.
 *   - `reset()` restores pristine seed state.
 *   - Successive updates accumulate correctly.
 *   - Multiple independent store instances don't share state.
 *
 * All tests are independently executable via:
 *   pnpm --filter core-ts test tests/voice/store.test.ts
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { VOICE_CONFIG } from '../../src/voice/config.js';
import { VoiceConfigStore } from '../../src/voice/store.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Returns a fresh store seeded with the canonical VOICE_CONFIG. */
function makeStore(): VoiceConfigStore {
  return new VoiceConfigStore(VOICE_CONFIG);
}

// ---------------------------------------------------------------------------
// Core UPDATE tests (Sub-AC 13c-3 primary assertions)
// ---------------------------------------------------------------------------

describe('VoiceConfigStore.update() — Sub-AC 13c-3', () => {
  let store: VoiceConfigStore;

  beforeEach(() => {
    store = makeStore();
  });

  // ── Updated field is reflected ──────────────────────────────────────────────

  it('updated description is reflected in the returned snapshot', () => {
    const newDesc = '새로운 voice 설명 — 업데이트됨';
    const result = store.update({ description: newDesc });
    expect(result.description).toBe(newDesc);
  });

  it('updated slot value is reflected in the returned snapshot', () => {
    const newTitle = '신규 트렌드 드롭 제목';
    const result = store.update({
      slots: { trend_drop_push_title: newTitle },
    });
    expect(result.slots.trend_drop_push_title).toBe(newTitle);
  });

  it('get() reflects the update after the call returns', () => {
    const newDesc = '지속 반영 확인용 설명';
    store.update({ description: newDesc });
    const current = store.get();
    expect(current.description).toBe(newDesc);
  });

  // ── Remaining fields are preserved ─────────────────────────────────────────

  it('voiceId is preserved when only description is updated', () => {
    const before = store.get().voiceId;
    const result = store.update({ description: '변경됨' });
    expect(result.voiceId).toBe(before);
  });

  it('all unpatched slots are preserved when one slot is updated', () => {
    const before = store.get();
    store.update({ slots: { trend_drop_push_title: '변경된 제목' } });
    const after = store.get();

    // Every slot key *except* trend_drop_push_title must remain unchanged.
    const unchangedKeys = (
      Object.keys(before.slots) as Array<keyof typeof before.slots>
    ).filter((k) => k !== 'trend_drop_push_title');

    for (const key of unchangedKeys) {
      expect(after.slots[key], `slots.${key} should be preserved`).toBe(
        before.slots[key],
      );
    }
  });

  it('description is preserved when only slots are updated', () => {
    const before = store.get().description;
    store.update({ slots: { generation_pick_prompt: '새 픽 안내문구' } });
    expect(store.get().description).toBe(before);
  });

  it('voiceId is preserved when only slots are updated', () => {
    const before = store.get().voiceId;
    store.update({ slots: { generation_pick_prompt: '변경' } });
    expect(store.get().voiceId).toBe(before);
  });

  // ── Partial slot merge ──────────────────────────────────────────────────────

  it('updating two slots preserves all other slot keys', () => {
    const before = store.get();
    store.update({
      slots: {
        trend_drop_push_body: '새 본문',
        diagnosis_wedge_cta: '새 CTA 텍스트',
      },
    });
    const after = store.get();

    expect(after.slots.trend_drop_push_body).toBe('새 본문');
    expect(after.slots.diagnosis_wedge_cta).toBe('새 CTA 텍스트');

    // All other slots unchanged
    const patchedKeys = new Set(['trend_drop_push_body', 'diagnosis_wedge_cta']);
    for (const key of Object.keys(before.slots) as Array<
      keyof typeof before.slots
    >) {
      if (!patchedKeys.has(key)) {
        expect(after.slots[key], `slots.${key} should be preserved`).toBe(
          before.slots[key],
        );
      }
    }
  });

  // ── No-op update ────────────────────────────────────────────────────────────

  it('empty patch (no keys) is a no-op — all values remain identical', () => {
    const before = store.get();
    const result = store.update({});
    expect(result.voiceId).toBe(before.voiceId);
    expect(result.description).toBe(before.description);
    for (const key of Object.keys(before.slots) as Array<
      keyof typeof before.slots
    >) {
      expect(result.slots[key]).toBe(before.slots[key]);
    }
  });

  // ── Return value ────────────────────────────────────────────────────────────

  it('update() returns a Readonly<VoiceConfig> that is frozen', () => {
    const result = store.update({ description: '새 설명' });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('update() returns a frozen slots object', () => {
    const result = store.update({ slots: { trend_drop_cta_primary: '업데이트된 CTA' } });
    expect(Object.isFrozen(result.slots)).toBe(true);
  });

  it('update() return value matches subsequent get() call', () => {
    const returned = store.update({ description: '반환값 동기 확인' });
    const fetched = store.get();
    expect(returned.description).toBe(fetched.description);
    expect(returned.voiceId).toBe(fetched.voiceId);
  });

  // ── Validation ──────────────────────────────────────────────────────────────

  it('throws when a patched slot value is an empty string', () => {
    expect(() =>
      store.update({ slots: { trend_drop_push_title: '' } }),
    ).toThrow(/empty slot values/);
  });

  it('throws when a patched slot value is whitespace-only', () => {
    expect(() =>
      store.update({ slots: { trend_drop_push_title: '   ' } }),
    ).toThrow(/empty slot values/);
  });

  // ── voiceId immutability ────────────────────────────────────────────────────

  it('voiceId is always "trend-editor-kr" regardless of updates', () => {
    store.update({ description: '변경됨' });
    store.update({ slots: { free_trial_emphasis: '37일 무료체험' } });
    expect(store.get().voiceId).toBe('trend-editor-kr');
  });
});

// ---------------------------------------------------------------------------
// Successive updates
// ---------------------------------------------------------------------------

describe('VoiceConfigStore — successive updates accumulate', () => {
  it('second update reflects both changes cumulatively', () => {
    const store = makeStore();
    store.update({ description: '1차 변경' });
    store.update({ slots: { payment_value_prop: '2차 슬롯 변경' } });

    const current = store.get();
    expect(current.description).toBe('1차 변경');
    expect(current.slots.payment_value_prop).toBe('2차 슬롯 변경');
  });

  it('later slot update overwrites earlier slot update for the same key', () => {
    const store = makeStore();
    store.update({ slots: { trend_drop_push_title: '1차 제목' } });
    store.update({ slots: { trend_drop_push_title: '2차 제목' } });
    expect(store.get().slots.trend_drop_push_title).toBe('2차 제목');
  });
});

// ---------------------------------------------------------------------------
// reset()
// ---------------------------------------------------------------------------

describe('VoiceConfigStore.reset()', () => {
  it('reset() restores the seed description after an update', () => {
    const store = makeStore();
    store.update({ description: '업데이트된 설명' });
    store.reset(VOICE_CONFIG);
    expect(store.get().description).toBe(VOICE_CONFIG.description);
  });

  it('reset() restores all seed slots after updates', () => {
    const store = makeStore();
    store.update({ slots: { trend_drop_push_title: '임시 제목' } });
    store.reset(VOICE_CONFIG);
    expect(store.get().slots.trend_drop_push_title).toBe(
      VOICE_CONFIG.slots.trend_drop_push_title,
    );
  });
});

// ---------------------------------------------------------------------------
// Instance isolation
// ---------------------------------------------------------------------------

describe('VoiceConfigStore — instance isolation', () => {
  it('two stores seeded from the same config do not share state', () => {
    const storeA = makeStore();
    const storeB = makeStore();

    storeA.update({ description: 'A 스토어 변경' });

    // storeB must not be affected
    expect(storeB.get().description).toBe(VOICE_CONFIG.description);
  });
});
