/**
 * Phase 3.4 — Phase 3.3 frozen-surfaces invariant test (Seed AC 14, 16
 * + exit condition `phase3_3_surfaces_frozen`).
 *
 * Asserts that the Phase 3.3 surfaces the Phase 3.4 seed pins as frozen
 * remain untouched (or at least byte-identical at the contract layer):
 *
 *   - The 4 PostHog event name constants resolve verbatim to their
 *     Phase 3.3 strings (no rename, no payload-extension creep).
 *   - The ToneStateProvider source file does NOT import the wording
 *     catalog (the wording layer is consumer-only, never an editor of
 *     the provider).
 *   - ToneSwitcher chip labels (봄웜 / 여름쿨 / 가을웜 / 겨울쿨) are
 *     still present in the component file (no surprise rename).
 *   - AsyncStorage boundary file does NOT import the wording catalog.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

import { POST_PAYMENT_CONTENT_ENGAGED_EVENT_NAME } from '../src/analytics/track-post-payment-content-engaged';
import { POST_PAYMENT_REVEALED_EVENT_NAME } from '../src/analytics/track-post-payment-revealed';
import { POST_PAYMENT_TAB_VIEWED_EVENT_NAME } from '../src/analytics/track-post-payment-tab-viewed';
import { TONE_SWITCHED_EVENT_NAME } from '../src/analytics/track-tone-switched';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.resolve(REPO_ROOT, relativePath), 'utf8');
}

describe('Phase 3.3 PostHog event name constants are frozen (Phase 3.4 Seed AC 14)', () => {
  it('post_payment_revealed event name is unchanged', () => {
    expect(POST_PAYMENT_REVEALED_EVENT_NAME).toBe('post_payment_revealed');
  });

  it('post_payment_tab_viewed event name is unchanged', () => {
    expect(POST_PAYMENT_TAB_VIEWED_EVENT_NAME).toBe('post_payment_tab_viewed');
  });

  it('tone_switched event name is unchanged', () => {
    expect(TONE_SWITCHED_EVENT_NAME).toBe('tone_switched');
  });

  it('post_payment_content_engaged event name is unchanged', () => {
    expect(POST_PAYMENT_CONTENT_ENGAGED_EVENT_NAME).toBe(
      'post_payment_content_engaged',
    );
  });
});

describe('Phase 3.3 ToneStateProvider source file is wording-layer-clean (Seed AC 16)', () => {
  it('ToneStateProvider does not import from the wording catalog', () => {
    const source = readRepoFile('apps/mobile/src/providers/ToneStateProvider.tsx');
    expect(source.includes('result-wording-catalog')).toBe(false);
  });

  it('ToneStateProvider still exports useToneState and ToneStateProvider', () => {
    const source = readRepoFile('apps/mobile/src/providers/ToneStateProvider.tsx');
    expect(source.includes('export function ToneStateProvider')).toBe(true);
    expect(source.includes('export function useToneState')).toBe(true);
  });

  it('ToneStateProvider still exposes the { current, source, setTone } shape', () => {
    const source = readRepoFile('apps/mobile/src/providers/ToneStateProvider.tsx');
    expect(source.includes('readonly current: Season')).toBe(true);
    expect(source.includes('readonly source: ToneSource')).toBe(true);
    expect(source.includes('readonly setTone: (next: Season) => void')).toBe(true);
  });
});

describe('Phase 3.3 ToneSwitcher chip labels are unchanged (Phase 3.4 wording layer must not touch the switcher)', () => {
  it('ToneSwitcher still renders the 4 canonical Korean chip labels', () => {
    const source = readRepoFile('apps/mobile/src/components/ToneSwitcher.tsx');
    expect(source.includes('봄웜')).toBe(true);
    expect(source.includes('여름쿨')).toBe(true);
    expect(source.includes('가을웜')).toBe(true);
    expect(source.includes('겨울쿨')).toBe(true);
  });

  it('ToneSwitcher does not import the wording catalog', () => {
    const source = readRepoFile('apps/mobile/src/components/ToneSwitcher.tsx');
    expect(source.includes('result-wording-catalog')).toBe(false);
  });
});

describe('Phase 3.3 AsyncStorage boundary file is wording-layer-clean (Seed constraint E — zero writes from wording layer)', () => {
  it('AsyncStorage boundary file does not import the wording catalog', () => {
    const source = readRepoFile('apps/mobile/src/storage/post-payment-storage.ts');
    expect(source.includes('result-wording-catalog')).toBe(false);
  });

  it('AsyncStorage boundary file still defines the Phase 3.3 3-key set verbatim', () => {
    const source = readRepoFile('apps/mobile/src/storage/post-payment-storage.ts');
    expect(source.includes('pck.post_payment.last_tone')).toBe(true);
    expect(source.includes('pck.post_payment.last_tab')).toBe(true);
    expect(source.includes('pck.post_payment.diagnosis_reveal_seen')).toBe(true);
  });
});
