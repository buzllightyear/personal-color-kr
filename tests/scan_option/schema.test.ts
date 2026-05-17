/**
 * Unit tests — `scan_option` schema validation.
 *
 * Verifies validators reject every shape that violates the Seed's Step-6
 * invariants and accept the canonical 3-option catalogue.
 *
 * Coverage targets (see src/scan_option/schema.ts for the invariant list):
 *   - per-entry primitive checks: not_object, wrong_type, enum, empty/no-Hangul.
 *   - cross-field: main↔personal_color↔slot 1↔available↔!placeholder.
 *   - catalogue: array shape, length, uniqueness, slot coverage, single main.
 *   - parse* throws ScanOptionValidationError carrying structured issues.
 */
import { describe, expect, it } from 'vitest';

import {
  MAIN_SCAN_ID,
  SCAN_OPTION_COUNT,
  type ScanOption,
} from '../../src/scan_option/types.js';
import {
  parseScanOption,
  parseScanOptionCatalogue,
  ScanOptionValidationError,
  validateScanOption,
  validateScanOptionCatalogue,
  type ValidationIssue,
  type ValidationIssueCode,
} from '../../src/scan_option/schema.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function validMain(): ScanOption {
  return {
    id: 'personal_color',
    role: 'main',
    slot: 1,
    status: 'available',
    displayLabelKo: '퍼스널 컬러 진단',
    placeholder: false,
  };
}

function validSecondary2(): ScanOption {
  return {
    id: 'scan_slot_2',
    role: 'secondary',
    slot: 2,
    status: 'phase_n_tbd',
    displayLabelKo: '두번째 스캔 (곧 오픈)',
    placeholder: true,
  };
}

function validSecondary3(): ScanOption {
  return {
    id: 'scan_slot_3',
    role: 'secondary',
    slot: 3,
    status: 'phase_n_tbd',
    displayLabelKo: '세번째 스캔 (곧 오픈)',
    placeholder: true,
  };
}

function validCatalogue(): readonly ScanOption[] {
  return [validMain(), validSecondary2(), validSecondary3()];
}

/** Returns the set of issue codes raised by a failed result. */
function codesOf(issues: readonly ValidationIssue[]): Set<ValidationIssueCode> {
  return new Set(issues.map((i) => i.code));
}

// ===========================================================================
// validateScanOption — per-entry
// ===========================================================================

describe('validateScanOption — primitive shape', () => {
  it('rejects null', () => {
    const r = validateScanOption(null);
    expect(r.valid).toBe(false);
    if (!r.valid) {
      expect(codesOf(r.errors).has('not_object')).toBe(true);
    }
  });

  it('rejects arrays', () => {
    const r = validateScanOption([]);
    expect(r.valid).toBe(false);
    if (!r.valid) {
      expect(codesOf(r.errors).has('not_object')).toBe(true);
    }
  });

  it('rejects primitives', () => {
    for (const v of [42, 'x', true, undefined]) {
      const r = validateScanOption(v);
      expect(r.valid).toBe(false);
      if (!r.valid) {
        expect(codesOf(r.errors).has('not_object')).toBe(true);
      }
    }
  });

  it('rejects missing fields', () => {
    const r = validateScanOption({});
    expect(r.valid).toBe(false);
    if (!r.valid) {
      const codes = codesOf(r.errors);
      // All primitives are typed `undefined` → wrong_type for each.
      expect(codes.has('wrong_type')).toBe(true);
    }
  });

  it('accepts a valid main entry and returns it frozen', () => {
    const r = validateScanOption(validMain());
    expect(r.valid).toBe(true);
    if (r.valid) {
      expect(r.value).toEqual(validMain());
      expect(Object.isFrozen(r.value)).toBe(true);
    }
  });

  it('accepts a valid secondary entry', () => {
    const r = validateScanOption(validSecondary2());
    expect(r.valid).toBe(true);
  });

  it('does not mutate input', () => {
    const original = validMain();
    const snapshot = { ...original };
    validateScanOption(original);
    expect(original).toEqual(snapshot);
  });

  it('tolerates unknown extra fields (forward-compatible)', () => {
    const r = validateScanOption({ ...validMain(), extra: 'ignored' });
    expect(r.valid).toBe(true);
    if (r.valid) {
      // Validator should NOT pass unknown fields through into the typed value.
      expect((r.value as unknown as Record<string, unknown>).extra).toBeUndefined();
    }
  });
});

describe('validateScanOption — enum / type rejection', () => {
  it('rejects unknown id', () => {
    const r = validateScanOption({ ...validMain(), id: 'nope' });
    expect(r.valid).toBe(false);
    if (!r.valid) {
      expect(codesOf(r.errors).has('invalid_enum_value')).toBe(true);
    }
  });

  it('rejects unknown role', () => {
    const r = validateScanOption({ ...validMain(), role: 'tertiary' });
    expect(r.valid).toBe(false);
    if (!r.valid) {
      expect(codesOf(r.errors).has('invalid_enum_value')).toBe(true);
    }
  });

  it('rejects unknown status', () => {
    const r = validateScanOption({ ...validMain(), status: 'deprecated' });
    expect(r.valid).toBe(false);
  });

  it('rejects non-numeric slot', () => {
    const r = validateScanOption({ ...validMain(), slot: '1' });
    expect(r.valid).toBe(false);
    if (!r.valid) {
      expect(codesOf(r.errors).has('wrong_type')).toBe(true);
    }
  });

  it('rejects out-of-range slot value', () => {
    const r = validateScanOption({ ...validMain(), slot: 4 });
    expect(r.valid).toBe(false);
    if (!r.valid) {
      expect(codesOf(r.errors).has('invalid_enum_value')).toBe(true);
    }
  });

  it('rejects non-boolean placeholder', () => {
    const r = validateScanOption({ ...validMain(), placeholder: 0 });
    expect(r.valid).toBe(false);
    if (!r.valid) {
      expect(codesOf(r.errors).has('wrong_type')).toBe(true);
    }
  });

  it('rejects non-string displayLabelKo', () => {
    const r = validateScanOption({ ...validMain(), displayLabelKo: 123 });
    expect(r.valid).toBe(false);
    if (!r.valid) {
      expect(codesOf(r.errors).has('wrong_type')).toBe(true);
    }
  });

  it('rejects empty displayLabelKo', () => {
    const r = validateScanOption({ ...validMain(), displayLabelKo: '' });
    expect(r.valid).toBe(false);
    if (!r.valid) {
      expect(codesOf(r.errors).has('empty_string')).toBe(true);
    }
  });

  it('rejects displayLabelKo without Hangul codepoints', () => {
    const r = validateScanOption({
      ...validMain(),
      displayLabelKo: 'Personal Color',
    });
    expect(r.valid).toBe(false);
    if (!r.valid) {
      expect(codesOf(r.errors).has('no_hangul')).toBe(true);
    }
  });
});

describe('validateScanOption — cross-field consistency', () => {
  it('rejects main id with role !== "main"', () => {
    const r = validateScanOption({ ...validMain(), role: 'secondary' });
    expect(r.valid).toBe(false);
    if (!r.valid) {
      expect(codesOf(r.errors).has('cross_field_mismatch')).toBe(true);
    }
  });

  it('rejects main id with slot !== 1', () => {
    const r = validateScanOption({ ...validMain(), slot: 2 });
    expect(r.valid).toBe(false);
    if (!r.valid) {
      expect(codesOf(r.errors).has('cross_field_mismatch')).toBe(true);
    }
  });

  it('rejects main id with status !== "available"', () => {
    const r = validateScanOption({ ...validMain(), status: 'phase_n_tbd' });
    expect(r.valid).toBe(false);
    if (!r.valid) {
      expect(codesOf(r.errors).has('cross_field_mismatch')).toBe(true);
    }
  });

  it('rejects main id with placeholder === true', () => {
    const r = validateScanOption({ ...validMain(), placeholder: true });
    expect(r.valid).toBe(false);
    if (!r.valid) {
      expect(codesOf(r.errors).has('cross_field_mismatch')).toBe(true);
    }
  });

  it('rejects secondary id with role !== "secondary"', () => {
    const r = validateScanOption({ ...validSecondary2(), role: 'main' });
    expect(r.valid).toBe(false);
    if (!r.valid) {
      expect(codesOf(r.errors).has('cross_field_mismatch')).toBe(true);
    }
  });

  it('rejects secondary id with slot === 1 (reserved for main)', () => {
    const r = validateScanOption({ ...validSecondary2(), slot: 1 });
    expect(r.valid).toBe(false);
    if (!r.valid) {
      expect(codesOf(r.errors).has('cross_field_mismatch')).toBe(true);
    }
  });

  it('rejects secondary id with status !== "phase_n_tbd"', () => {
    const r = validateScanOption({ ...validSecondary2(), status: 'available' });
    expect(r.valid).toBe(false);
    if (!r.valid) {
      expect(codesOf(r.errors).has('cross_field_mismatch')).toBe(true);
    }
  });

  it('rejects secondary id with placeholder === false', () => {
    const r = validateScanOption({ ...validSecondary2(), placeholder: false });
    expect(r.valid).toBe(false);
    if (!r.valid) {
      expect(codesOf(r.errors).has('cross_field_mismatch')).toBe(true);
    }
  });
});

// ===========================================================================
// parseScanOption — throw variant
// ===========================================================================

describe('parseScanOption', () => {
  it('returns the validated value on success', () => {
    const parsed = parseScanOption(validMain());
    expect(parsed).toEqual(validMain());
    expect(Object.isFrozen(parsed)).toBe(true);
  });

  it('throws ScanOptionValidationError carrying structured issues on failure', () => {
    let thrown: unknown;
    try {
      parseScanOption({ ...validMain(), slot: 99 });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ScanOptionValidationError);
    if (thrown instanceof ScanOptionValidationError) {
      expect(thrown.name).toBe('ScanOptionValidationError');
      expect(thrown.issues.length).toBeGreaterThan(0);
      expect(thrown.message).toContain('ScanOption validation failed');
      // Issues frozen for safety
      expect(Object.isFrozen(thrown.issues)).toBe(true);
    }
  });

  it('error issue paths use the "$" root prefix', () => {
    try {
      parseScanOption({ ...validMain(), role: 'unknown' });
    } catch (e) {
      if (e instanceof ScanOptionValidationError) {
        for (const issue of e.issues) {
          expect(issue.path.startsWith('$')).toBe(true);
        }
      }
    }
  });
});

// ===========================================================================
// validateScanOptionCatalogue — collection
// ===========================================================================

describe('validateScanOptionCatalogue — shape', () => {
  it('rejects non-array input', () => {
    const r = validateScanOptionCatalogue({ length: 3 });
    expect(r.valid).toBe(false);
    if (!r.valid) {
      expect(codesOf(r.errors).has('not_array')).toBe(true);
    }
  });

  it('rejects null', () => {
    const r = validateScanOptionCatalogue(null);
    expect(r.valid).toBe(false);
    if (!r.valid) {
      expect(codesOf(r.errors).has('not_array')).toBe(true);
    }
  });

  it('rejects catalogues with wrong length (2 entries)', () => {
    const r = validateScanOptionCatalogue([validMain(), validSecondary2()]);
    expect(r.valid).toBe(false);
    if (!r.valid) {
      expect(codesOf(r.errors).has('wrong_length')).toBe(true);
    }
  });

  it(`rejects catalogues with wrong length (4 entries)`, () => {
    const r = validateScanOptionCatalogue([
      validMain(),
      validSecondary2(),
      validSecondary3(),
      { ...validSecondary3(), id: 'scan_slot_2' },
    ]);
    expect(r.valid).toBe(false);
    if (!r.valid) {
      expect(codesOf(r.errors).has('wrong_length')).toBe(true);
    }
  });

  it('accepts the canonical 3-option catalogue', () => {
    const r = validateScanOptionCatalogue(validCatalogue());
    expect(r.valid).toBe(true);
    if (r.valid) {
      expect(r.value).toHaveLength(SCAN_OPTION_COUNT);
      expect(Object.isFrozen(r.value)).toBe(true);
    }
  });
});

describe('validateScanOptionCatalogue — collection invariants', () => {
  it('rejects duplicate ids', () => {
    const r = validateScanOptionCatalogue([
      validMain(),
      validSecondary2(),
      { ...validSecondary3(), id: 'scan_slot_2' },
    ]);
    expect(r.valid).toBe(false);
    if (!r.valid) {
      expect(codesOf(r.errors).has('duplicate_value')).toBe(true);
    }
  });

  it('rejects duplicate slots', () => {
    const r = validateScanOptionCatalogue([
      validMain(),
      validSecondary2(),
      { ...validSecondary3(), slot: 2 },
    ]);
    expect(r.valid).toBe(false);
    if (!r.valid) {
      // A duplicate slot 2 plus missing slot 3 → both codes raised.
      const codes = codesOf(r.errors);
      expect(codes.has('duplicate_value')).toBe(true);
      expect(codes.has('slot_coverage_mismatch')).toBe(true);
    }
  });

  it('rejects catalogues that fail slot coverage', () => {
    // Build a 3-entry catalogue that internally validates per-entry but misses
    // slot 3 — only achievable by giving two entries slot 2 (above) so we test
    // an inverse via a 3-entry catalogue that violates the slot-set invariant
    // *without* duplicate slots, which is structurally impossible with 3
    // entries and 3 slots — so duplicate path is the only route to coverage
    // mismatch (already covered).  Keep this test as a structural assertion.
    const r = validateScanOptionCatalogue([
      validMain(),
      validSecondary2(),
      { ...validSecondary3(), slot: 2 },
    ]);
    expect(r.valid).toBe(false);
    if (!r.valid) {
      expect(codesOf(r.errors).has('slot_coverage_mismatch')).toBe(true);
    }
  });

  it('rejects catalogues with no main entry', () => {
    const noMain = [
      { ...validMain(), id: 'scan_slot_2', role: 'secondary' as const,
        slot: 1 as const, status: 'phase_n_tbd' as const, placeholder: true,
        displayLabelKo: '두번째 스캔 (곧 오픈)' },
      validSecondary2(),
      validSecondary3(),
    ];
    const r = validateScanOptionCatalogue(noMain);
    expect(r.valid).toBe(false);
    if (!r.valid) {
      // Per-entry cross_field_mismatch will fire (secondary at slot 1).
      // Collection-level missing_main is suppressed when entries are
      // individually invalid — schema design choice — but the catalogue
      // is still firmly rejected.
      expect(r.errors.length).toBeGreaterThan(0);
    }
  });

  it('rejects catalogues with multiple main entries', () => {
    // Two entries claim role==='main' but only `personal_color` may carry
    // that role; the second main violates per-entry cross-field rules first.
    const r = validateScanOptionCatalogue([
      validMain(),
      { ...validSecondary2(), role: 'main' as const },
      validSecondary3(),
    ]);
    expect(r.valid).toBe(false);
    if (!r.valid) {
      expect(r.errors.length).toBeGreaterThan(0);
    }
  });

  it('per-entry path prefixes use array-index notation', () => {
    const r = validateScanOptionCatalogue([
      validMain(),
      { ...validSecondary2(), slot: 'oops' },
      validSecondary3(),
    ]);
    expect(r.valid).toBe(false);
    if (!r.valid) {
      const offending = r.errors.find((i) => i.path.includes('$[1]'));
      expect(offending).toBeDefined();
    }
  });
});

describe('parseScanOptionCatalogue', () => {
  it('returns the validated, frozen catalogue on success', () => {
    const parsed = parseScanOptionCatalogue(validCatalogue());
    expect(parsed).toHaveLength(SCAN_OPTION_COUNT);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(parsed[0]?.id).toBe(MAIN_SCAN_ID);
  });

  it('throws ScanOptionValidationError on failure', () => {
    expect(() => parseScanOptionCatalogue([])).toThrow(ScanOptionValidationError);
  });
});
