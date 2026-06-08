/**
 * Invariant test — Phase 3.3 Sub-AC 13 (event name disjointness).
 *
 * Asserts that the 3 post-payment PostHog event-name constants form a
 * set disjoint from the existing 12-step funnel event-name surface.
 * Drift surfaces as a compile-time-detectable test failure rather than
 * a silent collision in production analytics.
 *
 * Note: `tone_switched` was removed in the moat rework (single-voice
 * direction). The set now has 3 members.
 */
import { describe, expect, it } from 'vitest';

import { POST_PAYMENT_CONTENT_ENGAGED_EVENT_NAME } from '../src/analytics/track-post-payment-content-engaged';
import { POST_PAYMENT_REVEALED_EVENT_NAME } from '../src/analytics/track-post-payment-revealed';
import { POST_PAYMENT_TAB_VIEWED_EVENT_NAME } from '../src/analytics/track-post-payment-tab-viewed';

const POST_PAYMENT_EVENT_NAMES = new Set<string>([
  POST_PAYMENT_REVEALED_EVENT_NAME,
  POST_PAYMENT_TAB_VIEWED_EVENT_NAME,
  POST_PAYMENT_CONTENT_ENGAGED_EVENT_NAME,
]);

// 12-step funnel surface — hard-pinned. If a funnel event renames, this
// constant must be updated to match the new wire name. The test then
// catches collisions from either side of the surface.
const FUNNEL_EVENT_NAMES = new Set<string>([
  'funnel_step_entered',
  'referral_skipped',
  'referral_shared',
  'payment_skipped',
  'payment_completed',
  'paywall_error',
  'social_evolution_skipped',
]);

describe('post-payment event-name surface (Phase 3.3 Sub-AC 13)', () => {
  it('exposes exactly the 3 locked event names', () => {
    expect(POST_PAYMENT_EVENT_NAMES.size).toBe(3);
    expect(POST_PAYMENT_EVENT_NAMES).toContain('post_payment_revealed');
    expect(POST_PAYMENT_EVENT_NAMES).toContain('post_payment_tab_viewed');
    expect(POST_PAYMENT_EVENT_NAMES).toContain('post_payment_content_engaged');
  });

  it('forms a set disjoint from the funnel event-name surface', () => {
    const intersection = [...POST_PAYMENT_EVENT_NAMES].filter((name) =>
      FUNNEL_EVENT_NAMES.has(name),
    );
    expect(intersection).toEqual([]);
  });
});
