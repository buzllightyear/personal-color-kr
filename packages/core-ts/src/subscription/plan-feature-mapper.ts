/**
 * Plan feature mapper — Sub-AC 14d-1.
 *
 * Pure function: planFeatureMapper(plans, featureDefs)
 *   → normalized feature × plan matrix (rows = features, columns = plans).
 *
 * Each cell in the matrix carries:
 *   - available   {boolean} — feature is present and truthy for that plan
 *   - value       {FeatureValue} — raw value for display (null if absent)
 *   - highlighted {boolean} — cell should receive visual emphasis
 *
 * Highlight rules (in priority order):
 *   1. If featureDef.highlightedPlanIds includes the plan's id → highlighted:true
 *      (only when the cell is also available)
 *   2. Else if the plan is marked isRecommended:true → highlighted:true
 *      (only when the cell is also available)
 *
 * Invariants:
 *   - Pure — no side-effects, always returns the same output for the same input.
 *   - All output objects are frozen (immutable).
 *   - Plans with no entry in plan.features for a given featureKey produce
 *     { available: false, value: null, highlighted: false }.
 *   - A feature value of `false` or `null` yields available:false.
 *   - A feature value of `true` yields available:true, value:true.
 *   - A non-empty string or positive number yields available:true.
 *   - Zero (0) is treated as available:false (not a meaningful tier).
 *   - highlighted is always false when available is false.
 *
 * Usage:
 *   const matrix = planFeatureMapper(plans, featureDefs);
 *   matrix.rows[0].cells[1].highlighted // → boolean
 *
 * Seed context:
 *   Subscription plans: monthly ($12), annual ($59 + 37-day trial).
 *   Used in payment_model (step 12) feature comparison table.
 */

// ---------------------------------------------------------------------------
// Value types
// ---------------------------------------------------------------------------

/**
 * All primitive values that can be stored in plan.features for a given key.
 *
 * - `true`  → feature included (no quantity; display as a checkmark)
 * - `false` → feature explicitly excluded
 * - `null`  → feature absent / not applicable
 * - `string` → textual description (e.g. '무제한', '5회/일')
 * - `number` → numeric quantity (e.g. 37 trial days); 0 treated as unavailable
 */
export type FeatureValue = string | number | boolean | null;

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

/**
 * A subscription plan with its feature set.
 *
 * `features` is a key→value map where each key matches a FeatureDef.featureKey.
 * Missing keys are treated as null (not available).
 */
export interface Plan {
  /** Unique plan identifier, e.g. 'monthly' | 'annual'. */
  readonly planId: string;
  /** Display name for column header, e.g. '월간', '연간'. */
  readonly name: string;
  /**
   * Feature values keyed by featureKey.
   * Absence of a key is treated identically to a null value.
   */
  readonly features: Readonly<Record<string, FeatureValue>>;
  /**
   * When true, all available cells in this plan's column are highlighted
   * unless the featureDef explicitly overrides highlighting.
   * Typical use: mark the annual plan as 'recommended'.
   */
  readonly isRecommended?: boolean;
}

/**
 * Definition of one feature row in the comparison matrix.
 */
export interface FeatureDef {
  /** Must match the keys used in Plan.features. */
  readonly featureKey: string;
  /** Human-readable label for the row header (Korean UI). */
  readonly label: string;
  /**
   * Optional explicit list of planIds whose cells should be highlighted for
   * this feature row.  When provided, overrides the plan's isRecommended flag
   * for this row (i.e. only the specified plans are highlighted).
   * When omitted, falls back to plan.isRecommended.
   */
  readonly highlightedPlanIds?: readonly string[];
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

/**
 * A single cell in the feature × plan matrix.
 */
export interface FeatureCell {
  /**
   * Whether the feature is available / meaningful for this plan.
   * false for null, false, undefined, or 0 values.
   */
  readonly available: boolean;
  /**
   * Raw feature value for rendering. null when the key is absent or
   * the value is undefined.
   */
  readonly value: FeatureValue;
  /**
   * Whether this cell should receive visual emphasis (e.g. green text, bold).
   * Always false when available is false.
   */
  readonly highlighted: boolean;
}

/**
 * One row of the feature matrix, representing a single feature across all plans.
 */
export interface FeatureMatrixRow {
  /** Matches FeatureDef.featureKey. */
  readonly featureKey: string;
  /** Display label from FeatureDef.label. */
  readonly label: string;
  /**
   * Ordered array of cells — one per plan, in the same order as the `plans`
   * input to planFeatureMapper.
   */
  readonly cells: readonly FeatureCell[];
}

/**
 * The normalized feature × plan matrix returned by planFeatureMapper.
 */
export interface FeatureMatrix {
  /**
   * The input plans array (same reference), preserved for column-header access.
   */
  readonly plans: readonly Plan[];
  /**
   * Rows in the same order as the `featureDefs` input.
   * rows[i].cells[j] corresponds to featureDefs[i] × plans[j].
   */
  readonly rows: readonly FeatureMatrixRow[];
}

// ---------------------------------------------------------------------------
// Pure helpers — no side effects, no external deps
// ---------------------------------------------------------------------------

/**
 * Resolves a feature value from a plan's feature map.
 * Returns null if the key is absent or the stored value is undefined.
 */
function resolveValue(plan: Plan, featureKey: string): FeatureValue {
  if (!Object.prototype.hasOwnProperty.call(plan.features, featureKey)) {
    return null;
  }
  const v = plan.features[featureKey];
  return v === undefined ? null : v;
}

/**
 * Computes the `available` flag from a resolved FeatureValue.
 *
 * Unavailable:  null | false | 0
 * Available:    true | non-empty string | non-zero number
 */
function computeAvailable(value: FeatureValue): boolean {
  if (value === null || value === false || value === 0) {
    return false;
  }
  if (typeof value === 'string' && value.length === 0) {
    return false;
  }
  return true;
}

/**
 * Computes the `highlighted` flag for a single cell.
 *
 * Priority:
 *   1. featureDef.highlightedPlanIds is set → only listed planIds are highlighted.
 *   2. featureDef.highlightedPlanIds is absent → defer to plan.isRecommended.
 * Highlighted is always false when the cell is unavailable.
 */
function computeHighlighted(
  plan: Plan,
  featureDef: FeatureDef,
  available: boolean,
): boolean {
  if (!available) {
    return false;
  }
  if (featureDef.highlightedPlanIds !== undefined) {
    return featureDef.highlightedPlanIds.includes(plan.planId);
  }
  return plan.isRecommended === true;
}

/**
 * Builds one FeatureCell (frozen) for a (plan, featureDef) pair.
 */
function buildCell(plan: Plan, featureDef: FeatureDef): FeatureCell {
  const value = resolveValue(plan, featureDef.featureKey);
  const available = computeAvailable(value);
  const highlighted = computeHighlighted(plan, featureDef, available);
  return Object.freeze({ available, value, highlighted });
}

// ---------------------------------------------------------------------------
// Public API — planFeatureMapper
// ---------------------------------------------------------------------------

/**
 * Maps an array of subscription plans and an array of feature definitions into
 * a normalized feature × plan matrix.
 *
 * AC spec name: `planFeatureMapper(plans, featureDefs)`
 *
 * Pure function — no mutations, no I/O, deterministic.
 *
 * @param plans      - Subscription plan descriptors (columns).
 * @param featureDefs - Feature row definitions (rows).
 * @returns Frozen FeatureMatrix where rows[i].cells[j] = featureDefs[i] × plans[j].
 *
 * @example
 * const matrix = planFeatureMapper(
 *   [
 *     { planId: 'monthly', name: '월간', features: { trialDays: 0 } },
 *     { planId: 'annual',  name: '연간', features: { trialDays: 37 }, isRecommended: true },
 *   ],
 *   [
 *     { featureKey: 'trialDays', label: '무료 체험일' },
 *   ],
 * );
 * // matrix.rows[0].cells[0] → { available: false, value: 0, highlighted: false }
 * // matrix.rows[0].cells[1] → { available: true,  value: 37, highlighted: true  }
 */
export function planFeatureMapper(
  plans: readonly Plan[],
  featureDefs: readonly FeatureDef[],
): FeatureMatrix {
  const rows: readonly FeatureMatrixRow[] = featureDefs.map((featureDef) => {
    const cells: readonly FeatureCell[] = plans.map((plan) =>
      buildCell(plan, featureDef),
    );
    return Object.freeze<FeatureMatrixRow>({
      featureKey: featureDef.featureKey,
      label: featureDef.label,
      cells: Object.freeze(cells),
    });
  });

  return Object.freeze<FeatureMatrix>({
    plans,
    rows: Object.freeze(rows),
  });
}
