/**
 * Unit test — `referral-gate-ctas.ts` Korean CTA constants (Sub-AC 26).
 *
 * The constants live in `apps/mobile/src/funnel/referral-gate-ctas.ts`
 * and supply every Korean CTA label the step-10 `referral_gate` screen
 * renders on its three soft-gate controls (Kakao share, copy link, skip).
 *
 * Coverage:
 *   1. `REFERRAL_GATE_SHARE_CTA_LABELS` is keyed by every
 *      `ReferralShareMethod` literal — no method is missing a Korean
 *      label.
 *   2. The Kakao + copy-link Korean labels are exactly the human-
 *      reviewed copy ("카카오톡으로 공유" / "링크 복사"). Pinning the
 *      strings here means any future localisation pass surfaces as a
 *      failing test before reaching production.
 *   3. The skip CTA label is the soft-gate "나중에 할게요" phrasing —
 *      symmetric to `social_evolution` and `payment_model` skip
 *      labels so the soft-gate rhythm stays consistent.
 *   4. `REFERRAL_GATE_SHARE_CTA_LABELS` is frozen (a runtime mutation
 *      throws in strict mode and silently no-ops elsewhere — the
 *      test asserts the frozen flag itself, not the throw, so it
 *      passes under both behaviours).
 *
 * No `react-native` mock is needed — the constants module is pure data
 * (zero RN imports) and runs in vitest's node environment as-is.
 */
import { describe, expect, it } from 'vitest';

import {
  REFERRAL_GATE_SHARE_CTA_LABELS,
  REFERRAL_GATE_SKIP_CTA_LABEL,
} from '../src/funnel/referral-gate-ctas';
import type { ReferralShareMethod } from '../src/analytics/track-referral-shared';

describe('referral-gate-ctas — Korean CTA constants (Sub-AC 26)', () => {
  it('REFERRAL_GATE_SHARE_CTA_LABELS exposes a Korean label for every ReferralShareMethod', () => {
    // Listing the literal union members explicitly here gives us a
    // compile-time guard: if `ReferralShareMethod` widens (e.g. a future
    // `sms` channel), the array assignment fails until the new method
    // is added here, which in turn forces the map to declare the new
    // label below.
    const expected: readonly ReferralShareMethod[] = ['kakao', 'copy_link'];
    for (const method of expected) {
      expect(REFERRAL_GATE_SHARE_CTA_LABELS[method]).toBeTruthy();
      expect(typeof REFERRAL_GATE_SHARE_CTA_LABELS[method]).toBe('string');
    }
    // No extra keys leak past the closed `ReferralShareMethod` domain.
    expect(Object.keys(REFERRAL_GATE_SHARE_CTA_LABELS).sort()).toEqual(
      [...expected].sort(),
    );
  });

  it('pins the human-reviewed Korean share-method labels', () => {
    // Pinning the literal strings catches an accidental copy regression
    // in either direction (rewrites + reverts both surface as a diff
    // in this assertion). The Korean text was Seed-approved at Phase
    // 2.4 kickoff and must not drift silently.
    expect(REFERRAL_GATE_SHARE_CTA_LABELS.kakao).toBe('카카오톡으로 공유');
    expect(REFERRAL_GATE_SHARE_CTA_LABELS.copy_link).toBe('링크 복사');
  });

  it('REFERRAL_GATE_SKIP_CTA_LABEL uses the soft-gate "나중에 할게요" phrasing', () => {
    // Symmetric to the step-11 (`social_evolution`) and step-12
    // (`payment_model`) skip labels — the post-result-engagement rhythm
    // must read consistently across the three Phase 2.4 screens.
    expect(REFERRAL_GATE_SKIP_CTA_LABEL).toBe('나중에 할게요');
  });

  it('freezes REFERRAL_GATE_SHARE_CTA_LABELS so consumers cannot mutate the shared snapshot', () => {
    // Defensive immutability matches the rest of the funnel contracts
    // (e.g. INITIAL_FUNNEL_REFERRAL / INITIAL_FUNNEL_PAYMENT in
    // src/contracts/funnel-state.ts). Asserting the flag — not a
    // mutation attempt — keeps the test deterministic across strict /
    // sloppy module evaluation modes.
    expect(Object.isFrozen(REFERRAL_GATE_SHARE_CTA_LABELS)).toBe(true);
  });
});
