/**
 * Unit test — `social-evolution-ctas.ts` Korean CTA constants (Sub-AC 26).
 *
 * The constants live in `apps/mobile/src/funnel/social-evolution-ctas.ts`
 * and supply every Korean CTA label the step-11 `social_evolution`
 * screen renders across its two branches:
 *
 *   - shared=true  (user shared at `referral_gate`) → "다음으로" forward CTA.
 *   - shared=false (user skipped)                   → "친구에게 공유하기"
 *     back-to-share CTA + "나중에 할게요" quiet skip.
 *
 * Coverage:
 *   1. The shared=true forward CTA label is exactly "다음으로".
 *   2. The shared=false back-to-share CTA label is exactly
 *      "친구에게 공유하기" — `social_evolution` MUST NOT carry any of
 *      its own share controls (per Seed: "no duplicate share
 *      functionality on social_evolution"), so this CTA only describes
 *      the navigation intent back to `referral_gate`.
 *   3. The shared=false skip CTA label is the soft-gate "나중에 할게요"
 *      phrasing — symmetric to the sibling step-10 / step-12 skip
 *      labels so the rhythm reads consistent.
 *
 * No `react-native` mock is needed — the constants module is pure data
 * (zero RN imports) and runs in vitest's node environment as-is.
 */
import { describe, expect, it } from 'vitest';

import {
  SOCIAL_EVOLUTION_CONTINUE_CTA_LABEL,
  SOCIAL_EVOLUTION_SHARE_AGAIN_CTA_LABEL,
  SOCIAL_EVOLUTION_SKIP_CTA_LABEL,
} from '../src/funnel/social-evolution-ctas';

describe('social-evolution-ctas — Korean CTA constants (Sub-AC 26)', () => {
  it('SOCIAL_EVOLUTION_CONTINUE_CTA_LABEL is the shared=true forward CTA "다음으로"', () => {
    // The route handler advances to `payment-model` via `router.push`
    // (push, not replace) when this CTA fires — the label must read
    // forward-progress, not soft-gate. The exact "다음으로" string is
    // Seed-approved and must not drift.
    expect(SOCIAL_EVOLUTION_CONTINUE_CTA_LABEL).toBe('다음으로');
  });

  it('SOCIAL_EVOLUTION_SHARE_AGAIN_CTA_LABEL is the shared=false back-to-share CTA "친구에게 공유하기"', () => {
    // This CTA navigates back to `referral_gate` (the single source of
    // truth for share functionality). The Korean copy must imply
    // "go share with a friend" — NOT "share now" — because no share
    // surface exists on `social_evolution` itself.
    expect(SOCIAL_EVOLUTION_SHARE_AGAIN_CTA_LABEL).toBe('친구에게 공유하기');
  });

  it('SOCIAL_EVOLUTION_SKIP_CTA_LABEL uses the soft-gate "나중에 할게요" phrasing', () => {
    // Every Phase 2.4 post-result screen carries an identical skip
    // label so the soft-gate rhythm reads consistent across steps
    // 10 / 11 / 12 (per Seed: "All 3 screens are soft gates with
    // skip options").
    expect(SOCIAL_EVOLUTION_SKIP_CTA_LABEL).toBe('나중에 할게요');
  });

  it('exposes three distinct CTA labels (no string collision between branches)', () => {
    // Belt-and-braces guard against an accidental copy-paste regression
    // where two labels resolve to the same string — the screen's
    // branch UI relies on every CTA having a recognisable distinct
    // label for QA + a11y.
    const labels = new Set([
      SOCIAL_EVOLUTION_CONTINUE_CTA_LABEL,
      SOCIAL_EVOLUTION_SHARE_AGAIN_CTA_LABEL,
      SOCIAL_EVOLUTION_SKIP_CTA_LABEL,
    ]);
    expect(labels.size).toBe(3);
  });
});
