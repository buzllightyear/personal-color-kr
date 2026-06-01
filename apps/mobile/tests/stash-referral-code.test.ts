/**
 * Unit test — `apps/mobile/src/stash-referral-code.ts`
 * (Phase 4.5 — parse-and-stash glue for the deep-link referral code).
 *
 * The unit under test is dependency-injected on its write side, so these
 * tests exercise the parse → decide → stash decision with an in-memory
 * recording writer — no React, no expo-linking, no AsyncStorage backend.
 *
 * Asserts:
 *   - a `/r/:code` referral deep link stashes its code and returns it;
 *   - the `.invalid` universal-link host form stashes identically;
 *   - non-referral OK paths (welcome-hook, share token, magazine) do NOT
 *     stash and return null;
 *   - blocked URLs (internal-only, unknown scheme, malformed) do NOT stash;
 *   - last-wins: two referral links stash in order, last value wins.
 */
import { describe, expect, it } from 'vitest';

import { CUSTOM_URL_SCHEME, UNIVERSAL_LINK_DOMAINS } from '../src/deep-link-paths';
import { stashReferralCodeFromDeepLink } from '../src/stash-referral-code';

const SCHEME = `${CUSTOM_URL_SCHEME}://`;

/**
 * Build a recording writer so a test can assert both the value written and
 * the ordering of multiple writes (the last-wins invariant).
 */
function makeRecordingWriter(): {
  readonly writes: string[];
  readonly write: (code: string) => Promise<void>;
} {
  const writes: string[] = [];
  return {
    writes,
    write: async (code: string): Promise<void> => {
      writes.push(code);
    },
  };
}

describe('stashReferralCodeFromDeepLink (Phase 4.5)', () => {
  describe('referral path — /r/:code', () => {
    it('stashes the code and returns it (custom scheme)', async () => {
      const { writes, write } = makeRecordingWriter();
      const result = await stashReferralCodeFromDeepLink(
        `${SCHEME}r/Ab3xY-z9`,
        write,
      );
      expect(result).toBe('Ab3xY-z9');
      expect(writes).toEqual(['Ab3xY-z9']);
    });

    it('stashes identically via the .invalid universal-link host', async () => {
      const host = UNIVERSAL_LINK_DOMAINS[0] as string;
      const { writes, write } = makeRecordingWriter();
      const result = await stashReferralCodeFromDeepLink(
        `https://${host}/r/codeABCD`,
        write,
      );
      expect(result).toBe('codeABCD');
      expect(writes).toEqual(['codeABCD']);
    });
  });

  describe('non-referral OK paths do not stash', () => {
    it.each([
      ['welcome-hook campaign', `${SCHEME}welcome-hook?utm_source=email`],
      ['share token', `${SCHEME}s/shareToken123`],
      ['magazine', `${SCHEME}magazine/2026-06`],
      ['direct result-reveal', `${SCHEME}result-reveal`],
    ])('%s returns null and never writes', async (_label, url) => {
      const { writes, write } = makeRecordingWriter();
      const result = await stashReferralCodeFromDeepLink(url, write);
      expect(result).toBeNull();
      expect(writes).toEqual([]);
    });
  });

  describe('blocked URLs do not stash', () => {
    it.each([
      ['internal-only funnel slug', `${SCHEME}rating-gate`],
      ['unknown scheme', 'https://evil.example.com/r/codeABCD'],
      ['malformed url', ''],
      ['empty code segment', `${SCHEME}r/`],
    ])('%s returns null and never writes', async (_label, url) => {
      const { writes, write } = makeRecordingWriter();
      const result = await stashReferralCodeFromDeepLink(url, write);
      expect(result).toBeNull();
      expect(writes).toEqual([]);
    });
  });

  describe('last-wins across multiple referral links', () => {
    it('stashes in order so the most recent code wins', async () => {
      const { writes, write } = makeRecordingWriter();
      await stashReferralCodeFromDeepLink(`${SCHEME}r/FIRSTcod`, write);
      await stashReferralCodeFromDeepLink(`${SCHEME}r/SECONDcd`, write);
      expect(writes).toEqual(['FIRSTcod', 'SECONDcd']);
      expect(writes[writes.length - 1]).toBe('SECONDcd');
    });
  });
});
