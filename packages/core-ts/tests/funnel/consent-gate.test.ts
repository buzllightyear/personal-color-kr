/**
 * Unit tests — consent-gate.ts (Sub-AC 3-2).
 *
 * Contract under test:
 *   checkConsentStatus(stepId, checkedItems) → ConsentCheckStatus
 *   isConsentGatePassed(stepId, checkedItems) → boolean
 *   getUncheckedRequired(stepId, checkedItems) → readonly ConsentItemId[]
 *
 * ## Three mandatory AC categories
 *
 *   A. 전체 동의 (all consented)
 *      A1. All required items checked → 'all_consented'
 *      A2. All required items + optional items checked → 'all_consented'
 *      A3. Steps with no required items always return 'all_consented'
 *      A4. All 12 funnel steps covered (no step throws)
 *
 *   B. 부분 동의 (partially consented)
 *      B1. One of three required items checked → 'partially_consented'
 *      B2. Two of three required items checked → 'partially_consented'
 *      B3. Only optional item checked (zero required) → 'not_consented'
 *         (marketing_consent alone does NOT count as partial — it is not required)
 *
 *   C. 미동의 (not consented)
 *      C1. Empty checked list → 'not_consented'
 *      C2. Empty Set → 'not_consented'
 *      C3. Only optional (non-required) items checked → 'not_consented'
 *
 * ## Additionally
 *
 *   D. isConsentGatePassed — boolean convenience wrapper
 *      D1. Returns true for 'all_consented' only
 *      D2. Returns false for 'partially_consented'
 *      D3. Returns false for 'not_consented'
 *
 *   E. getUncheckedRequired — companion helper
 *      E1. Returns names of unchecked required items
 *      E2. Returns empty array when all required items are checked
 *      E3. Returns full required list when nothing is checked
 *      E4. Returned array is frozen (immutable)
 *
 *   F. Input variants
 *      F1. Accepts arrays as checkedItems
 *      F2. Accepts Set as checkedItems
 *      F3. Accepts readonly arrays as checkedItems
 *
 *   G. Purity & immutability
 *      G1. Same inputs produce same output
 *      G2. Checked items iterable is not mutated
 *
 *   H. Constants sanity
 *      H1. REQUIRED_CONSENT_ITEM_IDS contains the three mandatory items
 *      H2. ALL_CONSENT_ITEM_IDS contains all four items
 */

import { describe, expect, it } from 'vitest';

import { FUNNEL_STEPS_ORDERED, type FunnelStepId } from '../../src/funnel/types.js';
import {
  ALL_CONSENT_ITEM_IDS,
  REQUIRED_CONSENT_ITEM_IDS,
  checkConsentStatus,
  getUncheckedRequired,
  isConsentGatePassed,
  type ConsentItemId,
} from '../../src/funnel/consent-gate.js';

// ---------------------------------------------------------------------------
// A. 전체 동의 (all consented)
// ---------------------------------------------------------------------------

describe('checkConsentStatus — 전체 동의 (all consented)', () => {
  describe('welcome_hook (step 1): terms_of_service + privacy_policy + age_verification required', () => {
    it('A1: returns all_consented when all three required items are checked', () => {
      expect(
        checkConsentStatus('welcome_hook', [
          'terms_of_service',
          'privacy_policy',
          'age_verification',
        ]),
      ).toBe('all_consented');
    });

    it('A2: returns all_consented when all required + optional marketing_consent are checked', () => {
      expect(
        checkConsentStatus('welcome_hook', [
          'terms_of_service',
          'privacy_policy',
          'age_verification',
          'marketing_consent',
        ]),
      ).toBe('all_consented');
    });

    it('A2b: order of checked items does not matter (privacy_policy first)', () => {
      expect(
        checkConsentStatus('welcome_hook', [
          'privacy_policy',
          'age_verification',
          'terms_of_service',
        ]),
      ).toBe('all_consented');
    });
  });

  describe('steps with no required consent items (A3 — always all_consented)', () => {
    const NO_CONSENT_STEPS: FunnelStepId[] = [
      'value_props',
      'onboarding_priming',
      'rating_gate',
      'fake_loader',
      'scan_option_select',
      'diagnosis_input',
      'fake_scan_animation',
      'result_reveal',
      'referral_gate',
      'social_evolution',
      'payment_model',
    ];

    it.each(NO_CONSENT_STEPS)(
      'A3: %s returns all_consented regardless of checkedItems',
      (stepId) => {
        // Empty checked list
        expect(checkConsentStatus(stepId, [])).toBe('all_consented');
        // Non-empty checked list
        expect(checkConsentStatus(stepId, ['terms_of_service'])).toBe('all_consented');
      },
    );
  });

  it('A4: all 12 funnel steps are handled without throwing', () => {
    for (const stepId of FUNNEL_STEPS_ORDERED) {
      expect(() => checkConsentStatus(stepId, [])).not.toThrow();
    }
    expect(FUNNEL_STEPS_ORDERED).toHaveLength(12);
  });
});

// ---------------------------------------------------------------------------
// B. 부분 동의 (partially consented)
// ---------------------------------------------------------------------------

describe('checkConsentStatus — 부분 동의 (partially consented)', () => {
  it('B1a: one of three required items checked (terms_of_service only) → partially_consented', () => {
    expect(checkConsentStatus('welcome_hook', ['terms_of_service'])).toBe(
      'partially_consented',
    );
  });

  it('B1b: one of three required items checked (privacy_policy only) → partially_consented', () => {
    expect(checkConsentStatus('welcome_hook', ['privacy_policy'])).toBe(
      'partially_consented',
    );
  });

  it('B1c: one of three required items checked (age_verification only) → partially_consented', () => {
    expect(checkConsentStatus('welcome_hook', ['age_verification'])).toBe(
      'partially_consented',
    );
  });

  it('B2a: two of three required items checked (terms + privacy) → partially_consented', () => {
    expect(
      checkConsentStatus('welcome_hook', ['terms_of_service', 'privacy_policy']),
    ).toBe('partially_consented');
  });

  it('B2b: two of three required items checked (privacy + age) → partially_consented', () => {
    expect(
      checkConsentStatus('welcome_hook', ['privacy_policy', 'age_verification']),
    ).toBe('partially_consented');
  });

  it('B2c: two of three required items checked (terms + age) → partially_consented', () => {
    expect(
      checkConsentStatus('welcome_hook', ['terms_of_service', 'age_verification']),
    ).toBe('partially_consented');
  });

  it('B2d: two required + optional (marketing) checked → partially_consented', () => {
    expect(
      checkConsentStatus('welcome_hook', [
        'terms_of_service',
        'privacy_policy',
        'marketing_consent',
      ]),
    ).toBe('partially_consented');
  });

  it('B3: only optional marketing_consent checked, zero required → not_consented (not partial)', () => {
    // marketing_consent is NOT a required item — checking it alone contributes
    // zero required items, so the result is not_consented, not partially_consented.
    expect(checkConsentStatus('welcome_hook', ['marketing_consent'])).toBe(
      'not_consented',
    );
  });
});

// ---------------------------------------------------------------------------
// C. 미동의 (not consented)
// ---------------------------------------------------------------------------

describe('checkConsentStatus — 미동의 (not consented)', () => {
  it('C1: empty array → not_consented', () => {
    expect(checkConsentStatus('welcome_hook', [])).toBe('not_consented');
  });

  it('C2: empty Set → not_consented', () => {
    expect(checkConsentStatus('welcome_hook', new Set<ConsentItemId>())).toBe(
      'not_consented',
    );
  });

  it('C3a: only optional item (marketing_consent) checked → not_consented', () => {
    expect(checkConsentStatus('welcome_hook', ['marketing_consent'])).toBe(
      'not_consented',
    );
  });

  it('C3b: Set with only optional item checked → not_consented', () => {
    expect(
      checkConsentStatus('welcome_hook', new Set<ConsentItemId>(['marketing_consent'])),
    ).toBe('not_consented');
  });
});

// ---------------------------------------------------------------------------
// D. isConsentGatePassed — boolean convenience wrapper
// ---------------------------------------------------------------------------

describe('isConsentGatePassed', () => {
  it('D1: returns true when all required items are checked (all_consented)', () => {
    expect(
      isConsentGatePassed('welcome_hook', [
        'terms_of_service',
        'privacy_policy',
        'age_verification',
      ]),
    ).toBe(true);
  });

  it('D1b: returns true for steps with no required consent (always passes)', () => {
    expect(isConsentGatePassed('payment_model', [])).toBe(true);
    expect(isConsentGatePassed('diagnosis_input', [])).toBe(true);
  });

  it('D2: returns false for partially_consented', () => {
    expect(isConsentGatePassed('welcome_hook', ['terms_of_service'])).toBe(false);
  });

  it('D2b: returns false when two of three required items are checked', () => {
    expect(
      isConsentGatePassed('welcome_hook', ['terms_of_service', 'privacy_policy']),
    ).toBe(false);
  });

  it('D3: returns false for not_consented (empty list)', () => {
    expect(isConsentGatePassed('welcome_hook', [])).toBe(false);
  });

  it('D3b: returns false for not_consented (only optional item)', () => {
    expect(isConsentGatePassed('welcome_hook', ['marketing_consent'])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// E. getUncheckedRequired — companion helper
// ---------------------------------------------------------------------------

describe('getUncheckedRequired', () => {
  it('E1a: returns the single unchecked required item name', () => {
    const unchecked = getUncheckedRequired('welcome_hook', [
      'terms_of_service',
      'privacy_policy',
      // age_verification missing
    ]);
    expect(unchecked).toEqual(['age_verification']);
  });

  it('E1b: returns two unchecked required item names when two are missing', () => {
    const unchecked = getUncheckedRequired('welcome_hook', ['terms_of_service']);
    expect(unchecked).toHaveLength(2);
    expect(unchecked).toContain('privacy_policy');
    expect(unchecked).toContain('age_verification');
  });

  it('E1c: optional items are never included in unchecked required list', () => {
    const unchecked = getUncheckedRequired('welcome_hook', ['marketing_consent']);
    // All three required items are unchecked; marketing_consent is not in the required list
    expect(unchecked).toHaveLength(3);
    expect(unchecked).not.toContain('marketing_consent');
  });

  it('E2: returns empty array when all required items are satisfied', () => {
    const unchecked = getUncheckedRequired('welcome_hook', [
      'terms_of_service',
      'privacy_policy',
      'age_verification',
    ]);
    expect(unchecked).toHaveLength(0);
  });

  it('E2b: returns empty array for steps with no required consent', () => {
    expect(getUncheckedRequired('payment_model', [])).toHaveLength(0);
    expect(getUncheckedRequired('rating_gate', [])).toHaveLength(0);
  });

  it('E3: returns all three required items when nothing is checked', () => {
    const unchecked = getUncheckedRequired('welcome_hook', []);
    expect(unchecked).toHaveLength(3);
    expect(unchecked).toContain('terms_of_service');
    expect(unchecked).toContain('privacy_policy');
    expect(unchecked).toContain('age_verification');
  });

  it('E4: returned array is frozen (immutable)', () => {
    const unchecked = getUncheckedRequired('welcome_hook', []);
    expect(Object.isFrozen(unchecked)).toBe(true);
  });

  it('E4b: frozen empty array is returned for steps with no required items', () => {
    const unchecked = getUncheckedRequired('diagnosis_input', []);
    expect(Object.isFrozen(unchecked)).toBe(true);
    expect(unchecked).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// F. Input variants — checkedItems accepts arrays, Sets, readonly arrays
// ---------------------------------------------------------------------------

describe('checkConsentStatus — input variants', () => {
  const ALL_REQUIRED: ConsentItemId[] = [
    'terms_of_service',
    'privacy_policy',
    'age_verification',
  ];

  it('F1: accepts a mutable array', () => {
    expect(checkConsentStatus('welcome_hook', ALL_REQUIRED)).toBe('all_consented');
  });

  it('F2: accepts a Set', () => {
    expect(
      checkConsentStatus('welcome_hook', new Set<ConsentItemId>(ALL_REQUIRED)),
    ).toBe('all_consented');
  });

  it('F3: accepts a readonly array (const assertion)', () => {
    const readonlyItems = [
      'terms_of_service',
      'privacy_policy',
      'age_verification',
    ] as const satisfies readonly ConsentItemId[];
    expect(checkConsentStatus('welcome_hook', readonlyItems)).toBe('all_consented');
  });

  it('F: partial Set (one item) → partially_consented', () => {
    expect(
      checkConsentStatus('welcome_hook', new Set<ConsentItemId>(['privacy_policy'])),
    ).toBe('partially_consented');
  });
});

// ---------------------------------------------------------------------------
// G. Purity & immutability
// ---------------------------------------------------------------------------

describe('checkConsentStatus — purity', () => {
  it('G1a: calling twice with identical inputs returns the same result (all_consented)', () => {
    const items: ConsentItemId[] = [
      'terms_of_service',
      'privacy_policy',
      'age_verification',
    ];
    expect(checkConsentStatus('welcome_hook', items)).toBe(
      checkConsentStatus('welcome_hook', items),
    );
  });

  it('G1b: calling twice with identical inputs returns the same result (not_consented)', () => {
    const items: ConsentItemId[] = [];
    expect(checkConsentStatus('welcome_hook', items)).toBe(
      checkConsentStatus('welcome_hook', items),
    );
  });

  it('G2: does not mutate the checkedItems array', () => {
    const items: ConsentItemId[] = ['terms_of_service'];
    const copy = [...items];

    checkConsentStatus('welcome_hook', items);

    expect(items).toEqual(copy);
  });
});

// ---------------------------------------------------------------------------
// H. Constants sanity checks
// ---------------------------------------------------------------------------

describe('REQUIRED_CONSENT_ITEM_IDS', () => {
  it('H1: contains exactly the three mandatory Korean market consent items', () => {
    expect([...REQUIRED_CONSENT_ITEM_IDS]).toEqual([
      'terms_of_service',
      'privacy_policy',
      'age_verification',
    ]);
  });

  it('H1b: does NOT include the optional marketing_consent item', () => {
    expect(REQUIRED_CONSENT_ITEM_IDS).not.toContain('marketing_consent');
  });
});

describe('ALL_CONSENT_ITEM_IDS', () => {
  it('H2: contains all four consent items (three required + one optional)', () => {
    expect(ALL_CONSENT_ITEM_IDS).toHaveLength(4);
    expect(ALL_CONSENT_ITEM_IDS).toContain('terms_of_service');
    expect(ALL_CONSENT_ITEM_IDS).toContain('privacy_policy');
    expect(ALL_CONSENT_ITEM_IDS).toContain('age_verification');
    expect(ALL_CONSENT_ITEM_IDS).toContain('marketing_consent');
  });
});

// ---------------------------------------------------------------------------
// Cross-validation: checkConsentStatus ↔ isConsentGatePassed consistency
// ---------------------------------------------------------------------------

describe('checkConsentStatus ↔ isConsentGatePassed consistency', () => {
  const CASES: [FunnelStepId, ConsentItemId[]][] = [
    ['welcome_hook', []],
    ['welcome_hook', ['terms_of_service']],
    ['welcome_hook', ['terms_of_service', 'privacy_policy']],
    ['welcome_hook', ['terms_of_service', 'privacy_policy', 'age_verification']],
    ['welcome_hook', ['marketing_consent']],
    ['payment_model', []],
    ['diagnosis_input', []],
  ];

  it.each(CASES)(
    'isConsentGatePassed(%s, %j) === (checkConsentStatus === all_consented)',
    (stepId, items) => {
      const status = checkConsentStatus(stepId, items);
      const passed = isConsentGatePassed(stepId, items);
      expect(passed).toBe(status === 'all_consented');
    },
  );
});
