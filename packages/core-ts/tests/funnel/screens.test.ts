/**
 * Unit tests — per-step screen renderer for the 12-step Korean-variant funnel.
 *
 * Verifies:
 *   - `FUNNEL_SCREENS` is exhaustive over `FunnelStepId` (all 12 steps mapped).
 *   - Each screen's `stepNumber` matches the canonical 1..12 position.
 *   - Steps 10/11/12 are tagged `kr_variant`; steps 1-9 are not.
 *   - `renderStep` is total and returns frozen, identity-stable instances.
 *   - Step-specific invariants (rating dismissable, anchor price, 1 referral,
 *     5s loader, locked result, 37-day trial breakdown) hold.
 *   - Per-step rendering snapshots — locks down Korean copy so accidental
 *     wording drift trips CI.
 */
import { describe, expect, it } from 'vitest';

import {
  FUNNEL_STEPS_ORDERED,
  TOTAL_FUNNEL_STEPS,
  type FunnelStepId,
} from '../../src/funnel/types.js';
import {
  FUNNEL_SCREENS,
  renderAllSteps,
  renderStep,
  type FunnelCta,
  type FunnelScreen,
} from '../../src/funnel/screens.js';

// ---------------------------------------------------------------------------
// Exhaustiveness & structural invariants
// ---------------------------------------------------------------------------

describe('FUNNEL_SCREENS — exhaustiveness over FunnelStepId', () => {
  it('contains exactly one entry per canonical step id (12 total)', () => {
    const keys = Object.keys(FUNNEL_SCREENS).sort();
    const expected = [...FUNNEL_STEPS_ORDERED].sort();
    expect(keys).toEqual(expected);
    expect(keys).toHaveLength(TOTAL_FUNNEL_STEPS);
  });

  it('is frozen at the top level and per-entry', () => {
    expect(Object.isFrozen(FUNNEL_SCREENS)).toBe(true);
    for (const id of FUNNEL_STEPS_ORDERED) {
      const screen = FUNNEL_SCREENS[id];
      expect(Object.isFrozen(screen)).toBe(true);
      expect(Object.isFrozen(screen.ctas)).toBe(true);
      expect(Object.isFrozen(screen.metadata)).toBe(true);
      for (const cta of screen.ctas) {
        expect(Object.isFrozen(cta)).toBe(true);
      }
    }
  });

  it('every entry has stepId matching its key and stepNumber matching its canonical index + 1', () => {
    FUNNEL_STEPS_ORDERED.forEach((id, idx) => {
      const screen = FUNNEL_SCREENS[id];
      expect(screen.stepId).toBe(id);
      expect(screen.stepNumber).toBe(idx + 1);
    });
  });

  it('every entry has non-empty Korean headline and subhead', () => {
    for (const id of FUNNEL_STEPS_ORDERED) {
      const s = FUNNEL_SCREENS[id];
      expect(s.headline.length).toBeGreaterThan(0);
      expect(s.subhead.length).toBeGreaterThan(0);
      // Heuristic: contains at least one Hangul codepoint
      // (Korean syllables U+AC00..U+D7A3).
      expect(/[가-힣]/.test(s.headline)).toBe(true);
      expect(/[가-힣]/.test(s.subhead)).toBe(true);
    }
  });

  it('every entry has at least one CTA with a non-empty label', () => {
    for (const id of FUNNEL_STEPS_ORDERED) {
      const s = FUNNEL_SCREENS[id];
      expect(s.ctas.length).toBeGreaterThanOrEqual(1);
      for (const cta of s.ctas) {
        expect(cta.label.length).toBeGreaterThan(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// renderStep public API
// ---------------------------------------------------------------------------

describe('renderStep', () => {
  it('is total over FunnelStepId and returns the same identity each call', () => {
    for (const id of FUNNEL_STEPS_ORDERED) {
      const first = renderStep(id);
      const second = renderStep(id);
      expect(first).toBe(second); // identity stability (frozen singleton)
      expect(first.stepId).toBe(id);
    }
  });

  it('returns frozen instances (callers cannot mutate)', () => {
    const s = renderStep('welcome_hook');
    expect(Object.isFrozen(s)).toBe(true);
    expect(() => {
      // @ts-expect-error — runtime mutation must throw in strict mode.
      s.headline = 'mutated';
    }).toThrow();
  });
});

describe('renderAllSteps', () => {
  it('returns all 12 screens in canonical funnel order', () => {
    const all = renderAllSteps();
    expect(all).toHaveLength(TOTAL_FUNNEL_STEPS);
    all.forEach((screen, idx) => {
      expect(screen.stepId).toBe(FUNNEL_STEPS_ORDERED[idx]);
      expect(screen.stepNumber).toBe(idx + 1);
    });
  });

  it('returns a frozen array', () => {
    const all = renderAllSteps();
    expect(Object.isFrozen(all)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Korean variant tagging (Steps 10/11/12 only — Seed glamup_funnel_fidelity)
// ---------------------------------------------------------------------------

describe('Korean variant tagging', () => {
  const KR_VARIANT_STEPS: readonly FunnelStepId[] = [
    'referral_gate', // 10
    'social_evolution', // 11
    'payment_model', // 12
  ];
  const STANDARD_STEPS: readonly FunnelStepId[] = FUNNEL_STEPS_ORDERED.filter(
    (id) => !KR_VARIANT_STEPS.includes(id),
  );

  it('tags exactly steps 10/11/12 with variantTag="kr_variant"', () => {
    for (const id of KR_VARIANT_STEPS) {
      expect(FUNNEL_SCREENS[id].variantTag).toBe('kr_variant');
    }
  });

  it('leaves steps 1-9 untagged (variantTag === null)', () => {
    for (const id of STANDARD_STEPS) {
      expect(FUNNEL_SCREENS[id].variantTag).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Step-specific invariants
// ---------------------------------------------------------------------------

describe('Step 4 — rating_gate (iOS native dialog, dismissable)', () => {
  const s = FUNNEL_SCREENS.rating_gate;

  it('exposes a primary submit CTA and a dismiss-variant skip CTA', () => {
    const submit = s.ctas.find((c: FunnelCta) => c.action === 'submit_rating');
    const skip = s.ctas.find((c: FunnelCta) => c.action === 'skip');
    expect(submit?.variant).toBe('primary');
    expect(skip?.variant).toBe('dismiss');
  });

  it('flags metadata as iOS native + dismissable', () => {
    expect(s.metadata.dialogType).toBe('ios_native');
    expect(s.metadata.dismissable).toBe(true);
  });
});

describe('Step 5 — fake_loader (v0.2: 가짜 5초 텍스트 로더, 구 step 8에서 이동)', () => {
  const s = FUNNEL_SCREENS.fake_loader;

  it('runs for exactly 5000 ms and auto-advances', () => {
    expect(s.metadata.durationMs).toBe(5_000);
    expect(s.metadata.autoAdvance).toBe(true);
  });

  it('declares 24 analysis points (matches step 8 fake_scan_animation)', () => {
    expect(s.metadata.analysisPoints).toBe(24);
  });

  it('tags v0.2 step-8→step-5 migration via metadata.movedFromStep', () => {
    expect(s.metadata.movedFromStep).toBe(8);
  });
});

describe('Step 6 — scan_option_select (3 options, personal_color primary)', () => {
  const s = FUNNEL_SCREENS.scan_option_select;

  it('has exactly 3 CTAs and the primary one is the personal-color scan', () => {
    expect(s.ctas).toHaveLength(3);
    expect(s.ctas[0]?.action).toBe('select_scan_personal_color');
    expect(s.ctas[0]?.variant).toBe('primary');
  });

  it('records the main scan + Phase-N secondary slots in metadata', () => {
    expect(s.metadata.mainScan).toBe('personal_color');
    expect(s.metadata.optionCount).toBe(3);
    expect(Array.isArray(s.metadata.secondaryScans)).toBe(true);
    expect((s.metadata.secondaryScans as unknown[]).length).toBe(2);
  });
});

describe('Step 8 — fake_scan_animation (v0.2 신설: 시각 24-point 스캔 애니메이션)', () => {
  const s = FUNNEL_SCREENS.fake_scan_animation;

  it('runs for exactly 5000 ms and auto-advances', () => {
    expect(s.metadata.durationMs).toBe(5_000);
    expect(s.metadata.autoAdvance).toBe(true);
  });

  it('declares the visual face-scan animation mechanism', () => {
    expect(s.metadata.animationMechanism).toBe('face_scan_overlay');
    expect(s.metadata.analysisPoints).toBe(24);
  });

  it('declares the complementary text-loader at step 5 (dual sunk-cost mechanism)', () => {
    expect(s.metadata.complementsTextLoaderAtStep).toBe(5);
  });
});

describe('Step 3 — onboarding_priming (v0.2 신설: 일관성 lever priming)', () => {
  const s = FUNNEL_SCREENS.onboarding_priming;

  it('asks 2 onboarding questions for self-declaration priming', () => {
    expect(s.metadata.onboardingQuestionCount).toBe(2);
    expect(s.metadata.primingMechanism).toBe('consistency_lever');
  });

  it('replaces social_proof_intro (v0.1 step 3)', () => {
    expect(s.metadata.replaces).toBe('social_proof_intro_v0_1');
  });
});

describe('Step 9 — result_reveal (잠금 tease)', () => {
  const s = FUNNEL_SCREENS.result_reveal;

  it('is flagged as locked with hidden assets', () => {
    expect(s.metadata.locked).toBe(true);
    expect(s.metadata.lockedAssets).toEqual([
      'full_category_card',
      'guide_text',
      'first_curation',
    ]);
  });
});

describe('Step 10 — referral_gate (KR variant: 1명 추천만)', () => {
  const s = FUNNEL_SCREENS.referral_gate;

  it('requires exactly 1 referral and replaces the standard 50% off gate', () => {
    expect(s.metadata.requiredReferrals).toBe(1);
    expect(s.metadata.replaces).toBe('standard_50pct_off_gate');
  });

  it('exposes a single share CTA', () => {
    expect(s.ctas).toHaveLength(1);
    expect(s.ctas[0]?.action).toBe('share_referral');
  });
});

describe('Step 11 — social_evolution (KR variant, v0.2: UGC + 인플루언서 + social_proof 흡수)', () => {
  const s = FUNNEL_SCREENS.social_evolution;

  it('replaces fake Figma reviews with real UGC + influencer + aggregate proof', () => {
    expect(s.metadata.replaces).toBe('standard_fake_figma_reviews');
    expect(s.metadata.proofSources).toEqual([
      'user_generated_content',
      'influencer_quotes',
      'aggregate_user_count',
    ]);
  });

  it('absorbs the v0.1 social_proof_intro 12만+ user count', () => {
    expect(s.metadata.userCountClaim).toBe(120_000);
    expect(s.metadata.absorbs).toBe('social_proof_intro_v0_1');
  });
});

describe('Step 12 — payment_model (KR variant: $12/월, $59/연, 37일 무료체험)', () => {
  const s = FUNNEL_SCREENS.payment_model;

  it('encodes Seed-canonical pricing ($12 monthly, $59 annual)', () => {
    expect(s.metadata.monthlyUsd).toBe(12);
    expect(s.metadata.annualUsd).toBe(59);
  });

  it('encodes the 37-day annual trial as 7 base + 30 bonus = 37', () => {
    expect(s.metadata.freeTrialDays).toBe(37);
    expect(s.metadata.trialBreakdown).toEqual({
      baseTrialDays: 7,
      annualBonusDays: 30,
    });
  });

  it('offers both annual (primary) and monthly (secondary) CTAs', () => {
    const annual = s.ctas.find((c: FunnelCta) => c.action === 'select_annual');
    const monthly = s.ctas.find((c: FunnelCta) => c.action === 'select_monthly');
    expect(annual?.variant).toBe('primary');
    expect(monthly?.variant).toBe('secondary');
  });
});

// ---------------------------------------------------------------------------
// Per-step rendering snapshots — locks down Korean copy + CTA configuration
// ---------------------------------------------------------------------------

describe('per-step rendering snapshots (one per funnel step)', () => {
  // Helper: project a stable plain-object representation for snapshotting.
  // We strip any non-serialisable bits and sort metadata keys for determinism.
  function project(screen: FunnelScreen): Record<string, unknown> {
    const sortedMeta = Object.keys(screen.metadata)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = (screen.metadata as Record<string, unknown>)[k];
        return acc;
      }, {});
    return {
      stepId: screen.stepId,
      stepNumber: screen.stepNumber,
      headline: screen.headline,
      subhead: screen.subhead,
      bodyCopy: screen.bodyCopy,
      ctas: screen.ctas.map((c) => ({ ...c })),
      variantTag: screen.variantTag,
      metadata: sortedMeta,
    };
  }

  for (const id of FUNNEL_STEPS_ORDERED) {
    it(`renders step "${id}" with the expected Korean-variant configuration`, () => {
      expect(project(renderStep(id))).toMatchSnapshot();
    });
  }

  it('matches the full FUNNEL_SCREENS structural snapshot', () => {
    const all = renderAllSteps().map(project);
    expect(all).toMatchSnapshot();
  });
});
