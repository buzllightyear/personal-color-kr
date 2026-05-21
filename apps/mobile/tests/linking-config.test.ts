/**
 * Unit tests — `apps/mobile/src/linking.config.ts`.
 *
 * Sub-AC 3.1 contract:
 *   "linking.config.ts 모듈이 12개 semantic-kebab 경로(welcome-hook,
 *    onboarding-priming, quiz-intro, fake-loader, selfie-capture,
 *    fake-scan-animation, result-reveal, social-evolution, magazine, 등)를
 *    screens 매핑으로 export하며, 각 경로 키와 path 문자열의 정합성을 검증하는
 *    단위 테스트 통과."
 *
 * What this suite locks down:
 *   1. `toKebabSlug` performs a deterministic snake_case → kebab-case
 *      transform and rejects empty input.
 *   2. `FUNNEL_KEBAB_SLUGS` has exactly one slug per `FunnelStepId` in
 *      `FUNNEL_STEPS_ORDERED`, in the same canonical order, with each
 *      value equal to `toKebabSlug(id)`.
 *   3. `FUNNEL_KEBAB_SLUGS_ORDERED` is the ordered values view of (2).
 *   4. `LINKING_CONFIG.screens['(funnel)'].screens` has exactly 12
 *      entries — one per FunnelStepId — and for every entry the screen
 *      key and the path string are IDENTICAL (the core parity invariant
 *      that the Sub-AC 3.1 acceptance criterion calls out explicitly:
 *      "각 경로 키와 path 문자열의 정합성").
 *   5. The kebab slug for each step ID maps to the expected v0.2 kebab
 *      identity (welcome-hook, onboarding-priming, fake-loader, ..., the
 *      slugs the Sub-AC 3.1 description enumerates).
 *   6. The magazine route is registered exactly once under
 *      `screens['magazine/[month]']` and points to the dynamic
 *      `magazine/:month` URL pattern.
 *   7. The frozen invariants — every layer of `LINKING_CONFIG` and
 *      `FUNNEL_KEBAB_SLUGS` is `Object.isFrozen` so a downstream
 *      consumer cannot mutate the source of truth.
 *
 * Why these assertions matter:
 *   The Sub-AC 3.1 verdict hinges on the screens block and the
 *   FUNNEL_STEPS_ORDERED v0.2 list staying in lock-step. A single
 *   manual edit that breaks key=path parity (e.g. `'welcome-hook':
 *   'welcomehook'`) would silently 404 every deep link to step 1 at
 *   runtime — exactly the class of regression this test prevents.
 */
import { describe, expect, it } from 'vitest';

import {
  FUNNEL_KEBAB_SLUGS,
  FUNNEL_KEBAB_SLUGS_ORDERED,
  LINKING_CONFIG,
  TOTAL_FUNNEL_KEBAB_ROUTES,
  toKebabSlug,
} from '../src/linking.config';
import {
  FUNNEL_STEPS_ORDERED,
  TOTAL_FUNNEL_STEPS,
  type FunnelStepId,
} from 'core-ts/funnel/types';

// ---------------------------------------------------------------------------
// toKebabSlug — pure transform
// ---------------------------------------------------------------------------

describe('toKebabSlug (snake_case → kebab-case)', () => {
  it('replaces every underscore with a hyphen', () => {
    expect(toKebabSlug('welcome_hook')).toBe('welcome-hook');
    expect(toKebabSlug('fake_scan_animation')).toBe('fake-scan-animation');
    expect(toKebabSlug('onboarding_priming')).toBe('onboarding-priming');
  });

  it('returns the input unchanged when it has no underscores', () => {
    expect(toKebabSlug('magazine')).toBe('magazine');
  });

  it('preserves case (no toLowerCase normalization)', () => {
    // Defensive: if a future Capitalised id leaks in, we want the test to
    // surface it rather than silently normalise it.
    expect(toKebabSlug('Welcome_Hook')).toBe('Welcome-Hook');
  });

  it('throws on empty input (fail-loud)', () => {
    expect(() => toKebabSlug('')).toThrow(/non-empty/);
  });
});

// ---------------------------------------------------------------------------
// FUNNEL_KEBAB_SLUGS — exhaustive, ordered, frozen
// ---------------------------------------------------------------------------

describe('FUNNEL_KEBAB_SLUGS map', () => {
  it('has exactly one entry per FunnelStepId in canonical order', () => {
    const stepIds = Object.keys(FUNNEL_KEBAB_SLUGS) as FunnelStepId[];
    expect(stepIds).toEqual([...FUNNEL_STEPS_ORDERED]);
    expect(stepIds).toHaveLength(TOTAL_FUNNEL_STEPS);
  });

  it('maps each FunnelStepId to its deterministic kebab-case form', () => {
    for (const id of FUNNEL_STEPS_ORDERED) {
      expect(FUNNEL_KEBAB_SLUGS[id]).toBe(toKebabSlug(id));
    }
  });

  it('produces the exact v0.2 semantic-kebab slugs called out by Sub-AC 3.1', () => {
    // Mirrors the literal list in the Sub-AC 3.1 description so any
    // drift surfaces here rather than at deep-link resolution time.
    expect(FUNNEL_KEBAB_SLUGS).toStrictEqual({
      welcome_hook: 'welcome-hook',
      value_props: 'value-props',
      onboarding_priming: 'onboarding-priming',
      rating_gate: 'rating-gate',
      fake_loader: 'fake-loader',
      scan_option_select: 'scan-option-select',
      diagnosis_input: 'diagnosis-input',
      fake_scan_animation: 'fake-scan-animation',
      result_reveal: 'result-reveal',
      referral_gate: 'referral-gate',
      social_evolution: 'social-evolution',
      payment_model: 'payment-model',
    });
  });

  it('is frozen so downstream consumers cannot mutate the source of truth', () => {
    expect(Object.isFrozen(FUNNEL_KEBAB_SLUGS)).toBe(true);
  });
});

describe('FUNNEL_KEBAB_SLUGS_ORDERED list', () => {
  it('is the ordered slug values of FUNNEL_KEBAB_SLUGS', () => {
    const expected = FUNNEL_STEPS_ORDERED.map((id) => FUNNEL_KEBAB_SLUGS[id]);
    expect([...FUNNEL_KEBAB_SLUGS_ORDERED]).toEqual(expected);
    expect(FUNNEL_KEBAB_SLUGS_ORDERED).toHaveLength(TOTAL_FUNNEL_STEPS);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(FUNNEL_KEBAB_SLUGS_ORDERED)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// LINKING_CONFIG — screens block with key === path parity
// ---------------------------------------------------------------------------

describe('LINKING_CONFIG.screens["(funnel)"].screens', () => {
  const funnelScreens = LINKING_CONFIG.screens['(funnel)'].screens;

  it('has exactly TOTAL_FUNNEL_STEPS entries (12)', () => {
    const keys = Object.keys(funnelScreens);
    expect(keys).toHaveLength(TOTAL_FUNNEL_STEPS);
    expect(TOTAL_FUNNEL_KEBAB_ROUTES).toBe(TOTAL_FUNNEL_STEPS);
  });

  it('lists every funnel kebab slug exactly once', () => {
    // Sorting eliminates ordering noise (the screens block is a map, not
    // an ordered tuple — order matters in FUNNEL_KEBAB_SLUGS_ORDERED but
    // not here).
    const keysSorted = Object.keys(funnelScreens).sort();
    const slugsSorted = [...FUNNEL_KEBAB_SLUGS_ORDERED].sort();
    expect(keysSorted).toEqual(slugsSorted);
  });

  it('asserts the key === path parity invariant for every entry', () => {
    // The core acceptance criterion from Sub-AC 3.1:
    // "각 경로 키와 path 문자열의 정합성을 검증".
    for (const [key, path] of Object.entries(funnelScreens)) {
      expect(path).toBe(key);
    }
  });

  it('contains the v0.2 semantic-kebab paths called out by the Sub-AC', () => {
    // Spot-check the kebab paths the Sub-AC description enumerates by
    // name. We use individual `toHaveProperty` calls (rather than a
    // single strict-equality on the whole map) because the strict-equal
    // form is already covered by the parity + completeness assertions
    // above; here we want a readable failure message that points at
    // the SPECIFIC missing slug.
    expect(funnelScreens).toHaveProperty('welcome-hook', 'welcome-hook');
    expect(funnelScreens).toHaveProperty('onboarding-priming', 'onboarding-priming');
    expect(funnelScreens).toHaveProperty('fake-loader', 'fake-loader');
    expect(funnelScreens).toHaveProperty('fake-scan-animation', 'fake-scan-animation');
    expect(funnelScreens).toHaveProperty('result-reveal', 'result-reveal');
    expect(funnelScreens).toHaveProperty('social-evolution', 'social-evolution');
  });

  it('is frozen', () => {
    expect(Object.isFrozen(funnelScreens)).toBe(true);
    expect(Object.isFrozen(LINKING_CONFIG.screens['(funnel)'])).toBe(true);
    expect(Object.isFrozen(LINKING_CONFIG.screens)).toBe(true);
    expect(Object.isFrozen(LINKING_CONFIG)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Magazine route — outside the funnel group, dynamic
// ---------------------------------------------------------------------------

describe('LINKING_CONFIG.screens["magazine/[month]"]', () => {
  it('points to the dynamic magazine/:month URL pattern', () => {
    expect(LINKING_CONFIG.screens['magazine/[month]']).toBe('magazine/:month');
  });

  it('is registered outside the (funnel) screens block', () => {
    // Guard against an accidental collapse where the magazine path
    // ends up nested inside `(funnel).screens` (which would expose it
    // as a funnel step rather than an independent route).
    expect(LINKING_CONFIG.screens['(funnel)'].screens).not.toHaveProperty(
      'magazine/[month]',
    );
    expect(LINKING_CONFIG.screens['(funnel)'].screens).not.toHaveProperty(
      'magazine',
    );
  });

  it('the magazine path is not mistaken for a funnel kebab slug', () => {
    // Defends against a future edit that accidentally registers a
    // `magazine` step in core-ts; the test would surface here as well
    // as in the FUNNEL_KEBAB_SLUGS exhaustiveness assertion.
    expect(FUNNEL_KEBAB_SLUGS_ORDERED).not.toContain('magazine');
  });
});

// ---------------------------------------------------------------------------
// (post-payment) absence — Phase 3.3 Sub-AC 1.1 / Exit Condition
// `deep_link_invariant`.
//
// The post-payment surface (diagnosis-reveal + the 4-tab content group at
// `app/(post-payment)/(tabs)/`) is gated behind a completed payment + a
// produced diagnosis. Allowing an external deep-link entry into any
// `(post-payment)` route would bypass the funnel state machine, the
// Superwall paywall trigger, and the StoreKit purchase verification — which
// is exactly the security invariant the Seed locks down with
// `routing_correctness` + `security_compliance`.
//
// Compile-time defence already lives in `FunnelLinkingConfig`'s `screens`
// interface (only `'(funnel)'` and `'magazine/[month]'` are typed). This
// runtime invariant is a defence-in-depth assertion against a future
// contributor widening the interface or sneaking a `(post-payment)` entry
// into the screens block. A regression here surfaces the leak in CI before
// it ships rather than at deep-link resolution time on production builds.
// ---------------------------------------------------------------------------

describe('LINKING_CONFIG.screens["(post-payment)"] — security invariant', () => {
  it('does NOT contain a `(post-payment)` entry under screens', () => {
    // The post-payment group must never be addressable via an external
    // deep link. The absence of the key IS the contract.
    expect(LINKING_CONFIG.screens).not.toHaveProperty('(post-payment)');
  });

  it('does NOT contain any post-payment screen names (diagnosis-reveal, tabs)', () => {
    // Defence against an accidentally-hoisted child of the (post-payment)
    // group ending up flat in the top-level screens block. None of these
    // names should appear anywhere in the screens map.
    const screensKeys = Object.keys(LINKING_CONFIG.screens);
    expect(screensKeys).not.toContain('(post-payment)');
    expect(screensKeys).not.toContain('diagnosis-reveal');
    expect(screensKeys).not.toContain('(tabs)');
    expect(screensKeys).not.toContain('post-payment');
  });

  it('exactly enumerates the allowed top-level screen keys ((funnel) + magazine/[month])', () => {
    // Strict allowlist: the only two top-level keys are `(funnel)` and
    // `magazine/[month]`. Any future addition has to deliberately update
    // this assertion — making the security-relevant surface change a
    // pull-request-level conversation rather than a silent commit.
    const screensKeys = Object.keys(LINKING_CONFIG.screens).sort();
    expect(screensKeys).toEqual(['(funnel)', 'magazine/[month]']);
  });
});
