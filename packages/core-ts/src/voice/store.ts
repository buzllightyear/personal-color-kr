/**
 * In-memory voice config store — Sub-AC 13c-3.
 *
 * Provides a mutable, in-memory repository for the single VoiceConfig
 * record.  The store is intentionally thin:
 *
 *   - `get()`    → returns the current config as a deep-frozen snapshot.
 *   - `update()` → applies a partial patch, returns the updated frozen snapshot.
 *
 * Design contract:
 *   - All writes are immutable replacements (spread + freeze), never in-place
 *     mutation of the live config.
 *   - Only non-voiceId fields are patchable.  `voiceId` is the stable analytics
 *     key and must never change after construction.
 *   - Partial `slots` updates preserve un-patched slot keys exactly.
 *   - The store holds exactly one voice config record (singleton actor model).
 *
 * The store is a plain class so it can be instantiated per-test with arbitrary
 * seed data (no module-level singleton side-effects in tests).
 *
 * No vendor calls, no I/O.  Pure in-memory.
 */

import { type VoiceConfig, type VoiceCopySlots, type VoiceId } from './config.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Fields that the operator may patch via `VoiceConfigStore.update()`.
 *
 * `voiceId` is intentionally excluded — it is the stable analytics key and
 * must not drift after construction.
 */
export interface VoiceConfigPatch {
  /** Replace the human-readable description (informational, not rendered). */
  readonly description?: string;
  /**
   * Partial slot overrides.  Only the specified keys are changed; all other
   * slot keys are preserved verbatim from the current config.
   */
  readonly slots?: Partial<VoiceCopySlots>;
}

/**
 * Internal mutable state held by the store.
 * Separated from the public `VoiceConfig` interface so frozen snapshots can
 * be derived on demand without keeping two frozen copies in memory.
 */
interface InternalState {
  voiceId: VoiceId;
  description: string;
  slots: VoiceCopySlots;
}

// ---------------------------------------------------------------------------
// VoiceConfigStore
// ---------------------------------------------------------------------------

/**
 * In-memory store for the single VoiceConfig record.
 *
 * @example
 *   import { VOICE_CONFIG } from './config.js';
 *   import { VoiceConfigStore } from './store.js';
 *
 *   const store = new VoiceConfigStore(VOICE_CONFIG);
 *   store.update({ description: 'new desc' });
 *   const current = store.get();
 *   current.description; // 'new desc'
 */
export class VoiceConfigStore {
  private _state: InternalState;

  /**
   * Initialise the store with a seed VoiceConfig (typically `VOICE_CONFIG`).
   * The seed is deep-copied so the store never holds a reference to the
   * frozen singleton — mutations stay isolated to this instance.
   */
  constructor(seed: Readonly<VoiceConfig>) {
    this._state = {
      voiceId: seed.voiceId,
      description: seed.description,
      // Shallow copy of slots object — all values are primitives (strings)
      // so a shallow copy is a full independent copy.
      slots: { ...seed.slots } as VoiceCopySlots,
    };
  }

  /**
   * Returns the current voice config as a deep-frozen snapshot.
   *
   * The returned object satisfies the `Readonly<VoiceConfig>` contract:
   *   - `voiceId`, `description` are plain frozen scalars.
   *   - `slots` is a frozen sub-object.
   *
   * The snapshot is re-derived on every call so callers always receive the
   * latest state without shared mutable references.
   */
  get(): Readonly<VoiceConfig> {
    return Object.freeze({
      voiceId: this._state.voiceId,
      description: this._state.description,
      slots: Object.freeze({ ...this._state.slots }),
    });
  }

  /**
   * Applies a partial patch to the in-memory config and returns the updated
   * frozen snapshot.
   *
   * Patch semantics:
   *   - `description` — replaced entirely if provided; preserved if omitted.
   *   - `slots` — merged at the key level.  Only keys present in the patch
   *     object are updated; all other slot keys are preserved unchanged.
   *
   * @param patch - Partial update to apply.
   * @returns A deep-frozen snapshot of the config after the update.
   * @throws {Error} If a slot value in the patch is an empty string.
   */
  update(patch: VoiceConfigPatch): Readonly<VoiceConfig> {
    // Validate patched slot values — empty strings violate the voice-config
    // integrity contract.
    if (patch.slots) {
      const emptyPatchSlots = Object.entries(patch.slots)
        .filter(([, v]) => typeof v === 'string' && (v as string).trim() === '')
        .map(([k]) => k);

      if (emptyPatchSlots.length > 0) {
        throw new Error(
          `[VoiceConfigStore] patch contains empty slot values: ${emptyPatchSlots.join(', ')}`,
        );
      }
    }

    // Apply description patch (or keep existing)
    const updatedDescription =
      patch.description !== undefined ? patch.description : this._state.description;

    // Merge slots: spread existing, then spread patch overrides (patch wins)
    const updatedSlots: VoiceCopySlots = {
      ...this._state.slots,
      ...(patch.slots ?? {}),
    } as VoiceCopySlots;

    // Replace internal state atomically (no partial mutation)
    this._state = {
      voiceId: this._state.voiceId,
      description: updatedDescription,
      slots: updatedSlots,
    };

    return this.get();
  }

  /**
   * Resets the store back to the original seed value.
   * Useful in tests to restore pristine state between cases.
   *
   * @param seed - The VoiceConfig to reset to (typically `VOICE_CONFIG`).
   */
  reset(seed: Readonly<VoiceConfig>): void {
    this._state = {
      voiceId: seed.voiceId,
      description: seed.description,
      slots: { ...seed.slots } as VoiceCopySlots,
    };
  }
}
