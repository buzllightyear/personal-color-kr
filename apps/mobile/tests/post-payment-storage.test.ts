/**
 * Unit test — `apps/mobile/src/storage/post-payment-storage.ts`
 * (Phase 3.3 Sub-AC 14 — AsyncStorage wrapper API + namespaced keys +
 * defensive narrowing).
 *
 * Mocks `@react-native-async-storage/async-storage` with an in-memory
 * key/value backing so the wrapper exercises its full read/write path
 * without pulling in the native module. The wrapper is the ONLY
 * source-tree module allowed to import that library — boundary
 * isolation is asserted in a sibling test
 * (`asyncstorage-boundary-isolation.test.ts`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory backing store for the AsyncStorage mock. Reset between tests
// to keep cases independent.
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
  DIAGNOSIS_REVEAL_SEEN_STORAGE_KEY,
  LAST_POST_PAYMENT_TAB_STORAGE_KEY,
  readDiagnosisRevealSeen,
  readLastPostPaymentTab,
  writeDiagnosisRevealSeen,
  writeLastPostPaymentTab,
} from '../src/storage/post-payment-storage';

describe('post-payment-storage wrapper (Phase 3.3 — Sub-AC 14)', () => {
  beforeEach(() => {
    backingStore.clear();
  });

  afterEach(() => {
    backingStore.clear();
  });

  describe('namespaced key constants', () => {
    it('pins the last_tab key to its wire format', () => {
      expect(LAST_POST_PAYMENT_TAB_STORAGE_KEY).toBe('pck.post_payment.last_tab');
    });

    it('pins the diagnosis_reveal_seen key to its wire format', () => {
      expect(DIAGNOSIS_REVEAL_SEEN_STORAGE_KEY).toBe(
        'pck.post_payment.diagnosis_reveal_seen',
      );
    });

    it('keeps both remaining keys distinct (no collision)', () => {
      const keys = new Set([
        LAST_POST_PAYMENT_TAB_STORAGE_KEY,
        DIAGNOSIS_REVEAL_SEEN_STORAGE_KEY,
      ]);
      expect(keys.size).toBe(2);
    });
  });

  describe('readLastPostPaymentTab / writeLastPostPaymentTab', () => {
    it('returns null on first install', async () => {
      expect(await readLastPostPaymentTab()).toBeNull();
    });

    it('round-trips all 4 TabKeys', async () => {
      const tabs = ['edit', 'diagnosis', 'guide', 'curation'] as const;
      for (const tab of tabs) {
        await writeLastPostPaymentTab(tab);
        expect(await readLastPostPaymentTab()).toBe(tab);
      }
    });

    it('returns null when a drifted (non-enum) value is read back', async () => {
      backingStore.set(LAST_POST_PAYMENT_TAB_STORAGE_KEY, 'magazine');
      expect(await readLastPostPaymentTab()).toBeNull();
    });
  });

  describe('readDiagnosisRevealSeen / writeDiagnosisRevealSeen', () => {
    it('returns false on first install (fail-loud-but-safe default)', async () => {
      expect(await readDiagnosisRevealSeen()).toBe(false);
    });

    it('round-trips true after marking seen', async () => {
      await writeDiagnosisRevealSeen(true);
      expect(await readDiagnosisRevealSeen()).toBe(true);
    });

    it('round-trips false after explicit reset', async () => {
      await writeDiagnosisRevealSeen(true);
      await writeDiagnosisRevealSeen(false);
      expect(await readDiagnosisRevealSeen()).toBe(false);
    });

    it('treats any non-"true" stored string as false (defensive)', async () => {
      backingStore.set(DIAGNOSIS_REVEAL_SEEN_STORAGE_KEY, '1');
      expect(await readDiagnosisRevealSeen()).toBe(false);
    });
  });
});
