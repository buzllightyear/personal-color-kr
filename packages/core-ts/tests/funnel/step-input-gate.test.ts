/**
 * Unit tests — step-input-gate.ts (Sub-AC 3-1).
 *
 * Contract under test:
 *   isStepInputSatisfied(stepId, inputs) → boolean
 *   getMissingFields(stepId, inputs)     → readonly string[]
 *
 * Coverage matrix — three mandatory AC categories:
 *
 *   A. 필드 누락 (missing field)
 *      A1. All required fields absent → false
 *      A2. Partially supplied (one of two required fields absent) → false
 *      A3. Required field explicitly `null` → false
 *      A4. Required field explicitly `undefined` → false
 *      A5. Required field is empty string → false (selfieUri)
 *
 *   B. 전체 충족 (all fields satisfied)
 *      B1. All required fields present with valid values → true
 *      B2. Extra/irrelevant fields ignored → true
 *      B3. Steps with no required fields always satisfied → true
 *      B4. All 12 funnel steps covered (no step missing from the map)
 *
 *   C. 타입 불일치 (type mismatch)
 *      C1. Required string field is a number → false
 *      C2. Required string field is an object → false
 *      C3. Required string field is a boolean → false
 *      C4. Required string field is an array → false
 *      C5. Required string field is a valid string but wrong domain value → false
 *
 * Additionally:
 *   D. getMissingFields — companion helper
 *      D1. Returns names of unsatisfied fields
 *      D2. Returns empty array when all satisfied
 *      D3. Returns multiple names when multiple fields missing
 *   E. Purity — same input produces same output
 *   F. Immutability — inputs object not mutated
 */

import { describe, expect, it } from 'vitest';

import { FUNNEL_STEPS_ORDERED, type FunnelStepId } from '../../src/funnel/types.js';
import {
  PRIOR_DIAGNOSIS_VALUES,
  SELFIE_EDIT_STYLE_VALUES,
  getMissingFields,
  isStepInputSatisfied,
} from '../../src/funnel/step-input-gate.js';

// ---------------------------------------------------------------------------
// A. 필드 누락 (missing field)
// ---------------------------------------------------------------------------

describe('isStepInputSatisfied — 필드 누락 (missing field)', () => {
  describe('onboarding_priming (step 3): both selfieEditStyle + priorDiagnosis required', () => {
    it('A1: returns false when both required fields are absent (empty inputs)', () => {
      expect(isStepInputSatisfied('onboarding_priming', {})).toBe(false);
    });

    it('A2a: returns false when only selfieEditStyle is supplied (priorDiagnosis absent)', () => {
      expect(
        isStepInputSatisfied('onboarding_priming', { selfieEditStyle: 'natural' }),
      ).toBe(false);
    });

    it('A2b: returns false when only priorDiagnosis is supplied (selfieEditStyle absent)', () => {
      expect(
        isStepInputSatisfied('onboarding_priming', { priorDiagnosis: 'never' }),
      ).toBe(false);
    });

    it('A3a: returns false when selfieEditStyle is null', () => {
      expect(
        isStepInputSatisfied('onboarding_priming', {
          selfieEditStyle: null,
          priorDiagnosis: 'never',
        }),
      ).toBe(false);
    });

    it('A3b: returns false when priorDiagnosis is null', () => {
      expect(
        isStepInputSatisfied('onboarding_priming', {
          selfieEditStyle: 'natural',
          priorDiagnosis: null,
        }),
      ).toBe(false);
    });

    it('A4a: returns false when selfieEditStyle is undefined', () => {
      const inputs: Record<string, unknown> = { priorDiagnosis: 'never' };
      // No selfieEditStyle key at all — same as undefined
      expect(isStepInputSatisfied('onboarding_priming', inputs)).toBe(false);
    });

    it('A4b: returns false when priorDiagnosis is undefined', () => {
      const inputs: Record<string, unknown> = { selfieEditStyle: 'natural' };
      expect(isStepInputSatisfied('onboarding_priming', inputs)).toBe(false);
    });
  });

  describe('diagnosis_input (step 7): selfieUri required', () => {
    it('A1: returns false when selfieUri is absent (empty inputs)', () => {
      expect(isStepInputSatisfied('diagnosis_input', {})).toBe(false);
    });

    it('A3: returns false when selfieUri is null', () => {
      expect(isStepInputSatisfied('diagnosis_input', { selfieUri: null })).toBe(false);
    });

    it('A4: returns false when selfieUri is undefined (key present but undefined)', () => {
      const inputs: Record<string, unknown> = { selfieUri: undefined };
      expect(isStepInputSatisfied('diagnosis_input', inputs)).toBe(false);
    });

    it('A5: returns false when selfieUri is an empty string', () => {
      expect(isStepInputSatisfied('diagnosis_input', { selfieUri: '' })).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// B. 전체 충족 (all fields satisfied)
// ---------------------------------------------------------------------------

describe('isStepInputSatisfied — 전체 충족 (all fields satisfied)', () => {
  describe('onboarding_priming (step 3)', () => {
    it.each(
      SELFIE_EDIT_STYLE_VALUES.flatMap((style) =>
        PRIOR_DIAGNOSIS_VALUES.map((diag) => ({ style, diag })),
      ),
    )(
      'B1: returns true for selfieEditStyle=$style + priorDiagnosis=$diag',
      ({ style, diag }) => {
        expect(
          isStepInputSatisfied('onboarding_priming', {
            selfieEditStyle: style,
            priorDiagnosis: diag,
          }),
        ).toBe(true);
      },
    );

    it('B2: extra/irrelevant fields are silently ignored', () => {
      expect(
        isStepInputSatisfied('onboarding_priming', {
          selfieEditStyle: 'subtle',
          priorDiagnosis: 'self_test',
          // irrelevant field that this step does not require
          selfieUri: 'file:///irrelevant.jpg',
        }),
      ).toBe(true);
    });
  });

  describe('diagnosis_input (step 7)', () => {
    it('B1a: returns true for a typical file URI', () => {
      expect(
        isStepInputSatisfied('diagnosis_input', {
          selfieUri: 'file:///var/mobile/selfie.jpg',
        }),
      ).toBe(true);
    });

    it('B1b: returns true for a stub URI (Phase 2.3 placeholder)', () => {
      expect(
        isStepInputSatisfied('diagnosis_input', {
          selfieUri: 'stub://selfie/1700000000000',
        }),
      ).toBe(true);
    });

    it('B1c: returns true for any non-empty string URI', () => {
      expect(isStepInputSatisfied('diagnosis_input', { selfieUri: 'x' })).toBe(true);
    });
  });

  describe('steps with no required fields (B3 — always satisfied)', () => {
    const NO_INPUT_STEPS: FunnelStepId[] = [
      'welcome_hook',
      'value_props',
      'rating_gate',
      'fake_loader',
      'scan_option_select',
      'fake_scan_animation',
      'result_reveal',
      'referral_gate',
      'social_evolution',
      'payment_model',
    ];

    it.each(NO_INPUT_STEPS)(
      'B3: %s returns true regardless of what inputs are passed',
      (stepId) => {
        // Empty inputs
        expect(isStepInputSatisfied(stepId, {})).toBe(true);
        // Non-empty inputs (extra fields ignored)
        expect(
          isStepInputSatisfied(stepId, {
            selfieEditStyle: null,
            priorDiagnosis: null,
            selfieUri: null,
          }),
        ).toBe(true);
      },
    );
  });

  it('B4: all 12 funnel steps are covered by the gate function (no step throws)', () => {
    // Verify that the gate function accepts every canonical FunnelStepId
    // without throwing — this ensures the STEP_REQUIREMENTS map is exhaustive.
    for (const stepId of FUNNEL_STEPS_ORDERED) {
      expect(() => isStepInputSatisfied(stepId, {})).not.toThrow();
    }
    expect(FUNNEL_STEPS_ORDERED).toHaveLength(12);
  });
});

// ---------------------------------------------------------------------------
// C. 타입 불일치 (type mismatch)
// ---------------------------------------------------------------------------

describe('isStepInputSatisfied — 타입 불일치 (type mismatch)', () => {
  describe('onboarding_priming / selfieEditStyle', () => {
    it('C1: number instead of string → false', () => {
      expect(
        isStepInputSatisfied('onboarding_priming', {
          selfieEditStyle: 42 as unknown as string,
          priorDiagnosis: 'never',
        }),
      ).toBe(false);
    });

    it('C2: plain object instead of string → false', () => {
      expect(
        isStepInputSatisfied('onboarding_priming', {
          selfieEditStyle: { value: 'natural' } as unknown,
          priorDiagnosis: 'never',
        }),
      ).toBe(false);
    });

    it('C3: boolean instead of string → false', () => {
      expect(
        isStepInputSatisfied('onboarding_priming', {
          selfieEditStyle: true as unknown,
          priorDiagnosis: 'never',
        }),
      ).toBe(false);
    });

    it('C4: array instead of string → false', () => {
      expect(
        isStepInputSatisfied('onboarding_priming', {
          selfieEditStyle: ['natural'] as unknown,
          priorDiagnosis: 'never',
        }),
      ).toBe(false);
    });

    it('C5: string but outside valid domain (wrong literal) → false', () => {
      expect(
        isStepInputSatisfied('onboarding_priming', {
          selfieEditStyle: 'heavy_filter' as unknown, // not in SelfieEditStyle
          priorDiagnosis: 'never',
        }),
      ).toBe(false);
    });
  });

  describe('onboarding_priming / priorDiagnosis', () => {
    it('C1: number instead of string → false', () => {
      expect(
        isStepInputSatisfied('onboarding_priming', {
          selfieEditStyle: 'natural',
          priorDiagnosis: 0 as unknown,
        }),
      ).toBe(false);
    });

    it('C2: plain object instead of string → false', () => {
      expect(
        isStepInputSatisfied('onboarding_priming', {
          selfieEditStyle: 'natural',
          priorDiagnosis: {} as unknown,
        }),
      ).toBe(false);
    });

    it('C3: boolean instead of string → false', () => {
      expect(
        isStepInputSatisfied('onboarding_priming', {
          selfieEditStyle: 'natural',
          priorDiagnosis: false as unknown,
        }),
      ).toBe(false);
    });

    it('C5: string but outside valid domain → false', () => {
      expect(
        isStepInputSatisfied('onboarding_priming', {
          selfieEditStyle: 'natural',
          priorDiagnosis: 'semi_professional' as unknown, // not in PriorDiagnosis
        }),
      ).toBe(false);
    });
  });

  describe('diagnosis_input / selfieUri', () => {
    it('C1: number instead of string → false', () => {
      expect(
        isStepInputSatisfied('diagnosis_input', {
          selfieUri: 12345 as unknown,
        }),
      ).toBe(false);
    });

    it('C2: plain object instead of string → false', () => {
      expect(
        isStepInputSatisfied('diagnosis_input', {
          selfieUri: { uri: 'file:///selfie.jpg' } as unknown,
        }),
      ).toBe(false);
    });

    it('C3: boolean instead of string → false', () => {
      expect(
        isStepInputSatisfied('diagnosis_input', {
          selfieUri: true as unknown,
        }),
      ).toBe(false);
    });

    it('C4: array instead of string → false', () => {
      expect(
        isStepInputSatisfied('diagnosis_input', {
          selfieUri: ['file:///selfie.jpg'] as unknown,
        }),
      ).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// D. getMissingFields — companion helper
// ---------------------------------------------------------------------------

describe('getMissingFields', () => {
  it('D1: returns the name of the single unsatisfied field', () => {
    const missing = getMissingFields('onboarding_priming', {
      selfieEditStyle: 'subtle', // present + valid
      // priorDiagnosis absent
    });
    expect(missing).toEqual(['priorDiagnosis']);
  });

  it('D1b: returns the name of the unsatisfied selfieUri field', () => {
    const missing = getMissingFields('diagnosis_input', { selfieUri: null });
    expect(missing).toEqual(['selfieUri']);
  });

  it('D2: returns empty array when all required fields are satisfied', () => {
    const missing = getMissingFields('onboarding_priming', {
      selfieEditStyle: 'expressive',
      priorDiagnosis: 'professional',
    });
    expect(missing).toHaveLength(0);
  });

  it('D2b: returns empty array for steps with no required fields', () => {
    const missing = getMissingFields('welcome_hook', {});
    expect(missing).toHaveLength(0);
  });

  it('D3: returns multiple names when multiple fields are missing', () => {
    const missing = getMissingFields('onboarding_priming', {});
    // Both fields absent → both names returned
    expect(missing).toHaveLength(2);
    expect(missing).toContain('selfieEditStyle');
    expect(missing).toContain('priorDiagnosis');
  });

  it('D3b: returns all missing names for type-mismatched fields', () => {
    const missing = getMissingFields('onboarding_priming', {
      selfieEditStyle: 99 as unknown, // type mismatch
      priorDiagnosis: 99 as unknown, // type mismatch
    });
    expect(missing).toHaveLength(2);
    expect(missing).toContain('selfieEditStyle');
    expect(missing).toContain('priorDiagnosis');
  });

  it('D: return value is immutable (frozen array)', () => {
    const missing = getMissingFields('onboarding_priming', {});
    // Attempting to push onto the frozen array should throw in strict mode
    expect(Object.isFrozen(missing)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// E. Purity — same input produces same output
// ---------------------------------------------------------------------------

describe('isStepInputSatisfied — purity', () => {
  it('E1: calling twice with identical inputs returns the same value', () => {
    const inputs = { selfieEditStyle: 'natural', priorDiagnosis: 'never' } as const;
    const first = isStepInputSatisfied('onboarding_priming', inputs);
    const second = isStepInputSatisfied('onboarding_priming', inputs);
    expect(first).toBe(second);
  });

  it('E2: calling on different steps with same inputs is independent', () => {
    const inputs = {
      selfieEditStyle: 'natural',
      priorDiagnosis: 'never',
      selfieUri: null,
    };
    // onboarding_priming: selfieUri not required → true (both other fields valid)
    expect(isStepInputSatisfied('onboarding_priming', inputs)).toBe(true);
    // diagnosis_input: selfieUri = null → false
    expect(isStepInputSatisfied('diagnosis_input', inputs)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// F. Immutability — inputs object is not mutated
// ---------------------------------------------------------------------------

describe('isStepInputSatisfied — immutability', () => {
  it('F1: does not mutate the inputs object', () => {
    const inputs = {
      selfieEditStyle: 'natural',
      priorDiagnosis: 'never',
    } as const;
    const inputsCopy = { ...inputs };

    isStepInputSatisfied('onboarding_priming', inputs);

    // The function must not have changed any property on the inputs object
    expect(inputs).toEqual(inputsCopy);
  });
});

// ---------------------------------------------------------------------------
// Domain constant sanity checks
// ---------------------------------------------------------------------------

describe('SELFIE_EDIT_STYLE_VALUES', () => {
  it('contains exactly the three declared editing styles', () => {
    expect([...SELFIE_EDIT_STYLE_VALUES]).toEqual(['natural', 'subtle', 'expressive']);
  });
});

describe('PRIOR_DIAGNOSIS_VALUES', () => {
  it('contains exactly the three declared prior-diagnosis states', () => {
    expect([...PRIOR_DIAGNOSIS_VALUES]).toEqual(['never', 'self_test', 'professional']);
  });
});
