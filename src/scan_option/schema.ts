/**
 * Schema validation for `ScanOption` and the 3-option catalogue.
 *
 * Pure-functional validators — no external runtime dependency on Zod or
 * any other schema lib (keeps `package.json` minimal).  Validation returns
 * a discriminated `ValidationResult<T>`:
 *
 *   - `{ valid: true,  value: T,        errors: [] }`
 *   - `{ valid: false, value: null,     errors: ValidationIssue[] }`
 *
 * `parseScanOption` / `parseScanOptionCatalogue` are the throw-on-failure
 * wrappers (analogous to Zod's `.parse`) — they raise `ScanOptionValidationError`.
 *
 * Invariants enforced (mirrors comments in `./types.ts`):
 *
 *   Per-entry:
 *     1. Top-level value is a non-array, non-null plain object.
 *     2. `id`              ∈ SCAN_OPTION_IDS
 *     3. `role`            ∈ SCAN_OPTION_ROLES
 *     4. `slot`            ∈ SCAN_OPTION_SLOTS
 *     5. `status`          ∈ SCAN_OPTION_STATUSES
 *     6. `displayLabelKo`  is a non-empty string with ≥ 1 Hangul codepoint.
 *     7. `placeholder`     is a boolean.
 *     8. Cross-field consistency:
 *          - id === 'personal_color'  ⇒ role==='main', slot===1,
 *                                       status==='available', placeholder===false.
 *          - id !== 'personal_color'  ⇒ role==='secondary', slot∈{2,3},
 *                                       status==='phase_n_tbd', placeholder===true.
 *
 *   Catalogue-level:
 *     9.  Top-level value is an array of length === SCAN_OPTION_COUNT (3).
 *     10. Each entry validates per the per-entry rules above.
 *     11. Exactly one entry has role === 'main' AND id === MAIN_SCAN_ID.
 *     12. Each of `id`, `slot` is unique across all entries.
 *     13. Slots cover the set {1, 2, 3} exactly once each.
 */
import {
  MAIN_SCAN_ID,
  SCAN_OPTION_COUNT,
  SCAN_OPTION_IDS,
  SCAN_OPTION_ROLES,
  SCAN_OPTION_SLOTS,
  SCAN_OPTION_STATUSES,
  type ScanOption,
  type ScanOptionId,
  type ScanOptionRole,
  type ScanOptionSlot,
  type ScanOptionStatus,
} from './types.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A single, structured validation issue.  `path` is dot/bracket notation. */
export interface ValidationIssue {
  readonly path: string;
  readonly code: ValidationIssueCode;
  readonly message: string;
}

export type ValidationIssueCode =
  | 'not_object'
  | 'not_array'
  | 'wrong_length'
  | 'missing_field'
  | 'wrong_type'
  | 'invalid_enum_value'
  | 'empty_string'
  | 'no_hangul'
  | 'cross_field_mismatch'
  | 'duplicate_value'
  | 'missing_main'
  | 'multiple_mains'
  | 'slot_coverage_mismatch';

/** Successful validation result — `value` is the validated, typed payload. */
export interface ValidationSuccess<T> {
  readonly valid: true;
  readonly value: T;
  readonly errors: readonly [];
}

/** Failed validation result — `errors` is non-empty, `value` is null. */
export interface ValidationFailure {
  readonly valid: false;
  readonly value: null;
  readonly errors: readonly ValidationIssue[];
}

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

/** Thrown by `parseScanOption` / `parseScanOptionCatalogue` on failure. */
export class ScanOptionValidationError extends Error {
  public override readonly name = 'ScanOptionValidationError';
  public readonly issues: readonly ValidationIssue[];

  constructor(issues: readonly ValidationIssue[]) {
    super(
      `ScanOption validation failed with ${issues.length} issue(s):\n` +
        issues.map((i) => `  - [${i.code}] ${i.path}: ${i.message}`).join('\n'),
    );
    this.issues = Object.freeze([...issues]);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Heuristic: contains at least one Hangul syllable codepoint. */
function containsHangul(text: string): boolean {
  return /[가-힣]/.test(text);
}

function ok<T>(value: T): ValidationSuccess<T> {
  return { valid: true, value, errors: [] as const };
}

function fail(issues: readonly ValidationIssue[]): ValidationFailure {
  return { valid: false, value: null, errors: Object.freeze([...issues]) };
}

function issue(
  path: string,
  code: ValidationIssueCode,
  message: string,
): ValidationIssue {
  return Object.freeze({ path, code, message });
}

function enumCheck<T extends string>(
  pathPrefix: string,
  field: string,
  value: unknown,
  allowed: readonly T[],
  collected: ValidationIssue[],
): value is T {
  if (typeof value !== 'string') {
    collected.push(
      issue(
        `${pathPrefix}.${field}`,
        'wrong_type',
        `expected string, got ${typeof value}`,
      ),
    );
    return false;
  }
  if (!(allowed as readonly string[]).includes(value)) {
    collected.push(
      issue(
        `${pathPrefix}.${field}`,
        'invalid_enum_value',
        `"${value}" is not one of [${allowed.join(', ')}]`,
      ),
    );
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Per-entry validator
// ---------------------------------------------------------------------------

/**
 * Validate a single `ScanOption`-shaped value.
 * Use `parseScanOption` for the throw-on-failure variant.
 */
export function validateScanOption(
  input: unknown,
  pathPrefix = '$',
): ValidationResult<ScanOption> {
  const errors: ValidationIssue[] = [];

  if (!isPlainObject(input)) {
    errors.push(
      issue(
        pathPrefix,
        'not_object',
        'value must be a non-null, non-array object',
      ),
    );
    return fail(errors);
  }

  // ----- enum / type checks --------------------------------------------------
  const idOk = enumCheck<ScanOptionId>(
    pathPrefix,
    'id',
    input.id,
    SCAN_OPTION_IDS,
    errors,
  );
  const roleOk = enumCheck<ScanOptionRole>(
    pathPrefix,
    'role',
    input.role,
    SCAN_OPTION_ROLES,
    errors,
  );
  const statusOk = enumCheck<ScanOptionStatus>(
    pathPrefix,
    'status',
    input.status,
    SCAN_OPTION_STATUSES,
    errors,
  );

  // slot: numeric, restricted to SCAN_OPTION_SLOTS (1|2|3)
  let slotOk = false;
  if (typeof input.slot !== 'number') {
    errors.push(
      issue(
        `${pathPrefix}.slot`,
        'wrong_type',
        `expected number, got ${typeof input.slot}`,
      ),
    );
  } else if (
    !(SCAN_OPTION_SLOTS as readonly number[]).includes(input.slot)
  ) {
    errors.push(
      issue(
        `${pathPrefix}.slot`,
        'invalid_enum_value',
        `${input.slot} is not one of [${SCAN_OPTION_SLOTS.join(', ')}]`,
      ),
    );
  } else {
    slotOk = true;
  }

  // displayLabelKo: non-empty string with ≥ 1 Hangul codepoint
  let labelOk = false;
  if (typeof input.displayLabelKo !== 'string') {
    errors.push(
      issue(
        `${pathPrefix}.displayLabelKo`,
        'wrong_type',
        `expected string, got ${typeof input.displayLabelKo}`,
      ),
    );
  } else if (input.displayLabelKo.length === 0) {
    errors.push(
      issue(
        `${pathPrefix}.displayLabelKo`,
        'empty_string',
        'displayLabelKo must be non-empty',
      ),
    );
  } else if (!containsHangul(input.displayLabelKo)) {
    errors.push(
      issue(
        `${pathPrefix}.displayLabelKo`,
        'no_hangul',
        'displayLabelKo must contain at least one Hangul (가-힣) codepoint',
      ),
    );
  } else {
    labelOk = true;
  }

  // placeholder: boolean
  let placeholderOk = false;
  if (typeof input.placeholder !== 'boolean') {
    errors.push(
      issue(
        `${pathPrefix}.placeholder`,
        'wrong_type',
        `expected boolean, got ${typeof input.placeholder}`,
      ),
    );
  } else {
    placeholderOk = true;
  }

  // ----- cross-field consistency --------------------------------------------
  // Only meaningful if all the building blocks have correct primitive shape.
  if (idOk && roleOk && slotOk && statusOk && placeholderOk) {
    const id = input.id as ScanOptionId;
    const role = input.role as ScanOptionRole;
    const slot = input.slot as ScanOptionSlot;
    const status = input.status as ScanOptionStatus;
    const placeholder = input.placeholder as boolean;

    if (id === MAIN_SCAN_ID) {
      if (role !== 'main') {
        errors.push(
          issue(
            `${pathPrefix}.role`,
            'cross_field_mismatch',
            `id="${MAIN_SCAN_ID}" requires role="main", got "${role}"`,
          ),
        );
      }
      if (slot !== 1) {
        errors.push(
          issue(
            `${pathPrefix}.slot`,
            'cross_field_mismatch',
            `id="${MAIN_SCAN_ID}" requires slot=1, got ${slot}`,
          ),
        );
      }
      if (status !== 'available') {
        errors.push(
          issue(
            `${pathPrefix}.status`,
            'cross_field_mismatch',
            `id="${MAIN_SCAN_ID}" requires status="available", got "${status}"`,
          ),
        );
      }
      if (placeholder !== false) {
        errors.push(
          issue(
            `${pathPrefix}.placeholder`,
            'cross_field_mismatch',
            `id="${MAIN_SCAN_ID}" requires placeholder=false, got ${String(placeholder)}`,
          ),
        );
      }
    } else {
      // Secondary placeholder slots.
      if (role !== 'secondary') {
        errors.push(
          issue(
            `${pathPrefix}.role`,
            'cross_field_mismatch',
            `id="${id}" requires role="secondary", got "${role}"`,
          ),
        );
      }
      if (slot === 1) {
        errors.push(
          issue(
            `${pathPrefix}.slot`,
            'cross_field_mismatch',
            `slot=1 is reserved for the main scan ("${MAIN_SCAN_ID}"), not "${id}"`,
          ),
        );
      }
      if (status !== 'phase_n_tbd') {
        errors.push(
          issue(
            `${pathPrefix}.status`,
            'cross_field_mismatch',
            `secondary id="${id}" requires status="phase_n_tbd", got "${status}"`,
          ),
        );
      }
      if (placeholder !== true) {
        errors.push(
          issue(
            `${pathPrefix}.placeholder`,
            'cross_field_mismatch',
            `secondary id="${id}" requires placeholder=true, got ${String(placeholder)}`,
          ),
        );
      }
    }
  }

  // ----- ignore extraneous fields (forward-compatible) ----------------------
  // Schema is strict on the required fields but tolerant of unknown keys so
  // analytics/UI can decorate without re-versioning the validator.

  if (errors.length > 0) {
    return fail(errors);
  }

  // Safe to cast: every field has been individually validated above.
  const validated: ScanOption = Object.freeze({
    id: input.id as ScanOptionId,
    role: input.role as ScanOptionRole,
    slot: input.slot as ScanOptionSlot,
    status: input.status as ScanOptionStatus,
    displayLabelKo: input.displayLabelKo as string,
    placeholder: input.placeholder as boolean,
  });
  return ok(validated);
}

/**
 * Throw-on-failure variant.  Returns the validated `ScanOption` on success.
 */
export function parseScanOption(input: unknown): ScanOption {
  const result = validateScanOption(input);
  if (!result.valid) {
    throw new ScanOptionValidationError(result.errors);
  }
  return result.value;
}

// ---------------------------------------------------------------------------
// Catalogue-level validator
// ---------------------------------------------------------------------------

/**
 * Validate the full 3-option catalogue.  Performs all per-entry checks plus
 * size, uniqueness, and slot-coverage invariants.
 */
export function validateScanOptionCatalogue(
  input: unknown,
): ValidationResult<readonly ScanOption[]> {
  const errors: ValidationIssue[] = [];

  if (!Array.isArray(input)) {
    errors.push(
      issue(
        '$',
        'not_array',
        `expected array, got ${input === null ? 'null' : typeof input}`,
      ),
    );
    return fail(errors);
  }

  if (input.length !== SCAN_OPTION_COUNT) {
    errors.push(
      issue(
        '$',
        'wrong_length',
        `expected ${SCAN_OPTION_COUNT} entries, got ${input.length}`,
      ),
    );
    // Continue validating entries anyway — better error messages.
  }

  const validated: ScanOption[] = [];
  for (let i = 0; i < input.length; i++) {
    const entryResult = validateScanOption(input[i], `$[${i}]`);
    if (entryResult.valid) {
      validated.push(entryResult.value);
    } else {
      errors.push(...entryResult.errors);
    }
  }

  // Only run cross-entry checks if every entry parsed individually
  // (otherwise we'd compound noise on already-broken data).
  if (validated.length === input.length && input.length === SCAN_OPTION_COUNT) {
    // -- uniqueness on `id` --------------------------------------------------
    const seenIds = new Map<ScanOptionId, number>();
    validated.forEach((opt, idx) => {
      const prior = seenIds.get(opt.id);
      if (prior !== undefined) {
        errors.push(
          issue(
            `$[${idx}].id`,
            'duplicate_value',
            `id="${opt.id}" already used at index ${prior}`,
          ),
        );
      } else {
        seenIds.set(opt.id, idx);
      }
    });

    // -- uniqueness + coverage on `slot` ------------------------------------
    const seenSlots = new Map<ScanOptionSlot, number>();
    validated.forEach((opt, idx) => {
      const prior = seenSlots.get(opt.slot);
      if (prior !== undefined) {
        errors.push(
          issue(
            `$[${idx}].slot`,
            'duplicate_value',
            `slot=${opt.slot} already used at index ${prior}`,
          ),
        );
      } else {
        seenSlots.set(opt.slot, idx);
      }
    });

    const slotsSeen = [...seenSlots.keys()].sort((a, b) => a - b);
    const slotsExpected = [...SCAN_OPTION_SLOTS].sort((a, b) => a - b);
    if (
      slotsSeen.length !== slotsExpected.length ||
      slotsSeen.some((s, i) => s !== slotsExpected[i])
    ) {
      errors.push(
        issue(
          '$',
          'slot_coverage_mismatch',
          `expected slot set [${slotsExpected.join(', ')}], got [${slotsSeen.join(', ')}]`,
        ),
      );
    }

    // -- exactly one main, and it is `MAIN_SCAN_ID` -------------------------
    const mains = validated.filter((opt) => opt.role === 'main');
    if (mains.length === 0) {
      errors.push(
        issue(
          '$',
          'missing_main',
          `catalogue is missing a main entry (id="${MAIN_SCAN_ID}")`,
        ),
      );
    } else if (mains.length > 1) {
      errors.push(
        issue(
          '$',
          'multiple_mains',
          `expected exactly 1 main entry, got ${mains.length}`,
        ),
      );
    } else if (mains[0]?.id !== MAIN_SCAN_ID) {
      errors.push(
        issue(
          '$',
          'cross_field_mismatch',
          `main entry must have id="${MAIN_SCAN_ID}", got "${mains[0]?.id}"`,
        ),
      );
    }
  }

  if (errors.length > 0) {
    return fail(errors);
  }

  return ok(Object.freeze([...validated]));
}

/**
 * Throw-on-failure variant for the catalogue.
 */
export function parseScanOptionCatalogue(
  input: unknown,
): readonly ScanOption[] {
  const result = validateScanOptionCatalogue(input);
  if (!result.valid) {
    throw new ScanOptionValidationError(result.errors);
  }
  return result.value;
}
