/**
 * Phase 3.4 — post-payment event name constants + AsyncStorage boundary
 * invariant test (Seed AC 14, 16).
 *
 * The 4-season UI switcher and its associated analytics event have been
 * removed in the moat rework (single-voice direction). The remnant checks
 * here pin:
 *   - The remaining PostHog event name constants (post_payment_* events).
 *   - The AsyncStorage boundary file is still wording-layer-clean.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

import { POST_PAYMENT_CONTENT_ENGAGED_EVENT_NAME } from '../src/analytics/track-post-payment-content-engaged';
import { POST_PAYMENT_REVEALED_EVENT_NAME } from '../src/analytics/track-post-payment-revealed';
import { POST_PAYMENT_TAB_VIEWED_EVENT_NAME } from '../src/analytics/track-post-payment-tab-viewed';

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

  it('post_payment_content_engaged event name is unchanged', () => {
    expect(POST_PAYMENT_CONTENT_ENGAGED_EVENT_NAME).toBe(
      'post_payment_content_engaged',
    );
  });
});

describe('Phase 3.3 AsyncStorage boundary file is wording-layer-clean (Seed constraint E — zero writes from wording layer)', () => {
  it('AsyncStorage boundary file does not import the wording catalog', () => {
    const source = readRepoFile('apps/mobile/src/storage/post-payment-storage.ts');
    expect(source.includes('result-wording-catalog')).toBe(false);
  });

  it('AsyncStorage boundary file still defines the Phase 3.3 2-key set verbatim', () => {
    const source = readRepoFile('apps/mobile/src/storage/post-payment-storage.ts');
    expect(source.includes('pck.post_payment.last_tab')).toBe(true);
    expect(source.includes('pck.post_payment.diagnosis_reveal_seen')).toBe(true);
  });
});
