/**
 * Unit test — `apps/mobile/src/storage/referral-storage.ts`
 * (Phase 4.5 — stashed referral code AsyncStorage wrapper).
 *
 * Mocks `@react-native-async-storage/async-storage` with an in-memory
 * key/value backing so the wrapper exercises its full read/write/remove
 * path without pulling in the native module. Boundary isolation (only
 * `src/storage/` may import the library) is asserted in a sibling test
 * (`asyncstorage-boundary-isolation.test.ts`).
 *
 * Covers the three Seed-locked semantics for the stashed referral code:
 *   - last-wins   — a second write overwrites the first.
 *   - no TTL      — only the bare code string is persisted (no envelope).
 *   - cleanup     — `clearStashedReferralCode` removes the key.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const backingStore = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string): Promise<string | null> =>
      backingStore.has(key) ? (backingStore.get(key) as string) : null,
    setItem: async (key: string, value: string): Promise<void> => {
      backingStore.set(key, value);
    },
    removeItem: async (key: string): Promise<void> => {
      backingStore.delete(key);
    },
  },
}));

// Import AFTER the mock registers so the wrapper picks up the in-memory backing.
import {
  STASHED_REFERRAL_CODE_STORAGE_KEY,
  clearStashedReferralCode,
  readStashedReferralCode,
  writeStashedReferralCode,
} from '../src/storage/referral-storage';

describe('referral-storage wrapper (Phase 4.5)', () => {
  beforeEach(() => {
    backingStore.clear();
  });

  afterEach(() => {
    backingStore.clear();
  });

  describe('namespaced key constant', () => {
    it('pins the stashed_code key to its wire format', () => {
      expect(STASHED_REFERRAL_CODE_STORAGE_KEY).toBe(
        'pck.referral.stashed_code',
      );
    });

    it('does not collide with the post_payment namespace', () => {
      expect(STASHED_REFERRAL_CODE_STORAGE_KEY.startsWith('pck.')).toBe(true);
      expect(
        STASHED_REFERRAL_CODE_STORAGE_KEY.startsWith('pck.post_payment.'),
      ).toBe(false);
    });
  });

  describe('readStashedReferralCode', () => {
    it('returns null on first install (organic signup, nothing stashed)', async () => {
      expect(await readStashedReferralCode()).toBeNull();
    });

    it('round-trips a stashed code verbatim', async () => {
      await writeStashedReferralCode('Ab3xY-z9');
      expect(await readStashedReferralCode()).toBe('Ab3xY-z9');
    });
  });

  describe('writeStashedReferralCode — last-wins, no TTL', () => {
    it('overwrites a previously-stashed code (last-wins)', async () => {
      await writeStashedReferralCode('FIRSTcod');
      await writeStashedReferralCode('SECONDcd');
      expect(await readStashedReferralCode()).toBe('SECONDcd');
    });

    it('persists only the bare code string (no TTL envelope)', async () => {
      await writeStashedReferralCode('bareCode');
      // The raw backing value is exactly the code — no timestamp / JSON
      // wrapper that an expiry sweep could key off of.
      expect(backingStore.get(STASHED_REFERRAL_CODE_STORAGE_KEY)).toBe(
        'bareCode',
      );
    });
  });

  describe('clearStashedReferralCode — cleanup after attribution', () => {
    it('removes a previously-stashed code', async () => {
      await writeStashedReferralCode('toBeGone');
      await clearStashedReferralCode();
      expect(await readStashedReferralCode()).toBeNull();
    });

    it('is idempotent — clearing when nothing is stashed is a no-op', async () => {
      await clearStashedReferralCode();
      expect(await readStashedReferralCode()).toBeNull();
    });
  });
});
