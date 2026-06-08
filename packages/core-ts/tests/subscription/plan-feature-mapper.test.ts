/**
 * Unit tests for planFeatureMapper — Sub-AC 14d-1.
 *
 * Verified invariants:
 *   - Returns a matrix with rows = featureDefs order, cells = plans order.
 *   - Cell.available: true for truthy values (true, non-empty string, non-zero number).
 *   - Cell.available: false for null, false, 0, empty string, missing key.
 *   - Cell.value: null when key is absent or value is undefined.
 *   - Cell.value: echoes the stored FeatureValue otherwise.
 *   - Cell.highlighted: true when plan.isRecommended && available (no featureDef override).
 *   - Cell.highlighted: false when !available (even if plan.isRecommended).
 *   - Cell.highlighted: controlled by featureDef.highlightedPlanIds when set.
 *   - featureDef.highlightedPlanIds overrides plan.isRecommended.
 *   - Empty plans array → rows with empty cells arrays.
 *   - Empty featureDefs array → empty rows array.
 *   - Output (matrix, rows, cells) are all frozen (immutable).
 *   - Pure function — same input always yields structurally equal output.
 *   - matrix.plans is the input plans reference.
 */
import { describe, expect, it } from 'vitest';
import {
  planFeatureMapper,
  type FeatureCell,
  type FeatureDef,
  type FeatureMatrix,
  type FeatureMatrixRow,
  type FeatureValue,
  type Plan,
} from '../../src/subscription/plan-feature-mapper.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Monthly plan — no trial, not recommended. */
const MONTHLY_PLAN: Plan = Object.freeze({
  planId: 'monthly',
  name: '월간',
  features: Object.freeze({
    trialDays: 0,
    generationsPerDay: 5,
    trendDrops: true,
    personalColorAnalysis: true,
    prioritySupport: false,
  }),
  isRecommended: false,
});

/** Annual plan — 37-day trial, recommended. */
const ANNUAL_PLAN: Plan = Object.freeze({
  planId: 'annual',
  name: '연간',
  features: Object.freeze({
    trialDays: 37,
    generationsPerDay: '무제한',
    trendDrops: true,
    personalColorAnalysis: true,
    prioritySupport: true,
  }),
  isRecommended: true,
});

const FEATURE_DEFS: readonly FeatureDef[] = Object.freeze([
  Object.freeze({ featureKey: 'trialDays', label: '무료 체험일' }),
  Object.freeze({ featureKey: 'generationsPerDay', label: '일일 생성 횟수' }),
  Object.freeze({ featureKey: 'trendDrops', label: '트렌드 드롭 알림' }),
  Object.freeze({ featureKey: 'personalColorAnalysis', label: '퍼스널 컬러 분석' }),
  Object.freeze({ featureKey: 'prioritySupport', label: '우선 고객지원' }),
]);

// ---------------------------------------------------------------------------
// Helper: run mapper with both plans and standard feature defs
// ---------------------------------------------------------------------------

function runMapper(
  plans: readonly Plan[] = [MONTHLY_PLAN, ANNUAL_PLAN],
  featureDefs: readonly FeatureDef[] = FEATURE_DEFS,
): FeatureMatrix {
  return planFeatureMapper(plans, featureDefs);
}

// ---------------------------------------------------------------------------
// Matrix shape
// ---------------------------------------------------------------------------

describe('planFeatureMapper — matrix shape', () => {
  it('returns an object with plans and rows properties', () => {
    const matrix = runMapper();
    expect(matrix).toHaveProperty('plans');
    expect(matrix).toHaveProperty('rows');
  });

  it('rows length equals featureDefs length', () => {
    const matrix = runMapper();
    expect(matrix.rows).toHaveLength(FEATURE_DEFS.length);
  });

  it('each row has featureKey and label from the matching featureDef', () => {
    const matrix = runMapper();
    FEATURE_DEFS.forEach((def, i) => {
      expect(matrix.rows[i]!.featureKey).toBe(def.featureKey);
      expect(matrix.rows[i]!.label).toBe(def.label);
    });
  });

  it('each row.cells length equals plans length', () => {
    const matrix = runMapper();
    matrix.rows.forEach((row: FeatureMatrixRow) => {
      expect(row.cells).toHaveLength(2); // MONTHLY + ANNUAL
    });
  });

  it('preserves featureDef order in rows', () => {
    const matrix = runMapper();
    const rowKeys = matrix.rows.map((r: FeatureMatrixRow) => r.featureKey);
    expect(rowKeys).toEqual(FEATURE_DEFS.map((d) => d.featureKey));
  });

  it('preserves plan order in cells', () => {
    const matrix = runMapper();
    // The generationsPerDay row: monthly=5, annual='무제한'
    const row = matrix.rows.find((r) => r.featureKey === 'generationsPerDay')!;
    expect(row.cells[0]!.value).toBe(5);
    expect(row.cells[1]!.value).toBe('무제한');
  });

  it('matrix.plans is the same reference as the input plans array', () => {
    const plans: readonly Plan[] = [MONTHLY_PLAN, ANNUAL_PLAN];
    const matrix = planFeatureMapper(plans, FEATURE_DEFS);
    expect(matrix.plans).toBe(plans);
  });
});

// ---------------------------------------------------------------------------
// cell.value — raw value resolution
// ---------------------------------------------------------------------------

describe('planFeatureMapper — cell.value', () => {
  it('echoes a numeric value directly (trialDays=0 for monthly)', () => {
    const matrix = runMapper();
    const trialRow = matrix.rows.find((r) => r.featureKey === 'trialDays')!;
    expect(trialRow.cells[0]!.value).toBe(0); // monthly
  });

  it('echoes a numeric value directly (trialDays=37 for annual)', () => {
    const matrix = runMapper();
    const trialRow = matrix.rows.find((r) => r.featureKey === 'trialDays')!;
    expect(trialRow.cells[1]!.value).toBe(37); // annual
  });

  it('echoes a boolean true value', () => {
    const matrix = runMapper();
    const dropRow = matrix.rows.find((r) => r.featureKey === 'trendDrops')!;
    expect(dropRow.cells[0]!.value).toBe(true); // monthly
    expect(dropRow.cells[1]!.value).toBe(true); // annual
  });

  it('echoes a boolean false value', () => {
    const matrix = runMapper();
    const supportRow = matrix.rows.find((r) => r.featureKey === 'prioritySupport')!;
    expect(supportRow.cells[0]!.value).toBe(false); // monthly
  });

  it('echoes a string value', () => {
    const matrix = runMapper();
    const genRow = matrix.rows.find((r) => r.featureKey === 'generationsPerDay')!;
    expect(genRow.cells[1]!.value).toBe('무제한'); // annual
  });

  it('returns null when featureKey is absent from plan.features', () => {
    const plans: readonly Plan[] = [
      { planId: 'free', name: '무료', features: {} },
    ];
    const defs: readonly FeatureDef[] = [
      { featureKey: 'missingFeature', label: '없는 기능' },
    ];
    const matrix = planFeatureMapper(plans, defs);
    expect(matrix.rows[0]!.cells[0]!.value).toBeNull();
  });

  it('returns null when stored value is undefined', () => {
    const plans: readonly Plan[] = [
      { planId: 'test', name: '테스트', features: { explicit: undefined as unknown as FeatureValue } },
    ];
    const defs: readonly FeatureDef[] = [
      { featureKey: 'explicit', label: '명시적 undefined' },
    ];
    const matrix = planFeatureMapper(plans, defs);
    expect(matrix.rows[0]!.cells[0]!.value).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// cell.available — availability computation
// ---------------------------------------------------------------------------

describe('planFeatureMapper — cell.available', () => {
  it('available=false when value is 0', () => {
    const matrix = runMapper();
    const trialRow = matrix.rows.find((r) => r.featureKey === 'trialDays')!;
    expect(trialRow.cells[0]!.available).toBe(false); // monthly, trialDays=0
  });

  it('available=true when value is positive number', () => {
    const matrix = runMapper();
    const trialRow = matrix.rows.find((r) => r.featureKey === 'trialDays')!;
    expect(trialRow.cells[1]!.available).toBe(true); // annual, trialDays=37
  });

  it('available=true when value is a non-empty string', () => {
    const matrix = runMapper();
    const genRow = matrix.rows.find((r) => r.featureKey === 'generationsPerDay')!;
    expect(genRow.cells[1]!.available).toBe(true); // annual, '무제한'
  });

  it('available=false when value is boolean false', () => {
    const matrix = runMapper();
    const supportRow = matrix.rows.find((r) => r.featureKey === 'prioritySupport')!;
    expect(supportRow.cells[0]!.available).toBe(false); // monthly, false
  });

  it('available=true when value is boolean true', () => {
    const matrix = runMapper();
    const dropRow = matrix.rows.find((r) => r.featureKey === 'trendDrops')!;
    expect(dropRow.cells[0]!.available).toBe(true); // monthly, true
  });

  it('available=false when value is null (key absent)', () => {
    const plans: readonly Plan[] = [
      { planId: 'free', name: '무료', features: {} },
    ];
    const defs: readonly FeatureDef[] = [
      { featureKey: 'missing', label: '없음' },
    ];
    const matrix = planFeatureMapper(plans, defs);
    expect(matrix.rows[0]!.cells[0]!.available).toBe(false);
  });

  it('available=false when value is an empty string', () => {
    const plans: readonly Plan[] = [
      { planId: 'test', name: '테스트', features: { emptyStr: '' } },
    ];
    const defs: readonly FeatureDef[] = [
      { featureKey: 'emptyStr', label: '빈 문자열' },
    ];
    const matrix = planFeatureMapper(plans, defs);
    expect(matrix.rows[0]!.cells[0]!.available).toBe(false);
  });

  it('available=false when value is explicit null', () => {
    const plans: readonly Plan[] = [
      { planId: 'test', name: '테스트', features: { nullVal: null } },
    ];
    const defs: readonly FeatureDef[] = [
      { featureKey: 'nullVal', label: '널 값' },
    ];
    const matrix = planFeatureMapper(plans, defs);
    expect(matrix.rows[0]!.cells[0]!.available).toBe(false);
  });

  it('available=true for numeric value 5 (generationsPerDay monthly)', () => {
    const matrix = runMapper();
    const genRow = matrix.rows.find((r) => r.featureKey === 'generationsPerDay')!;
    expect(genRow.cells[0]!.available).toBe(true); // monthly, 5
  });
});

// ---------------------------------------------------------------------------
// cell.highlighted — highlight computation
// ---------------------------------------------------------------------------

describe('planFeatureMapper — cell.highlighted (isRecommended fallback)', () => {
  it('highlighted=false when plan.isRecommended=false even if available', () => {
    // monthly: isRecommended=false, trendDrops=true → not highlighted
    const matrix = runMapper();
    const dropRow = matrix.rows.find((r) => r.featureKey === 'trendDrops')!;
    expect(dropRow.cells[0]!.highlighted).toBe(false);
  });

  it('highlighted=true when plan.isRecommended=true and available=true', () => {
    // annual: isRecommended=true, trendDrops=true → highlighted
    const matrix = runMapper();
    const dropRow = matrix.rows.find((r) => r.featureKey === 'trendDrops')!;
    expect(dropRow.cells[1]!.highlighted).toBe(true);
  });

  it('highlighted=false when available=false even if plan.isRecommended=true', () => {
    // A plan marked recommended but with value=false for a feature
    const plans: readonly Plan[] = [
      {
        planId: 'annual',
        name: '연간',
        features: { someFeature: false },
        isRecommended: true,
      },
    ];
    const defs: readonly FeatureDef[] = [
      { featureKey: 'someFeature', label: '어떤 기능' },
    ];
    const matrix = planFeatureMapper(plans, defs);
    expect(matrix.rows[0]!.cells[0]!.highlighted).toBe(false);
  });

  it('highlighted=false when value=0 even if plan.isRecommended=true', () => {
    const plans: readonly Plan[] = [
      {
        planId: 'annual',
        name: '연간',
        features: { trialDays: 0 },
        isRecommended: true,
      },
    ];
    const defs: readonly FeatureDef[] = [
      { featureKey: 'trialDays', label: '무료 체험일' },
    ];
    const matrix = planFeatureMapper(plans, defs);
    expect(matrix.rows[0]!.cells[0]!.highlighted).toBe(false);
  });

  it('highlighted=false when key is absent even if plan.isRecommended=true', () => {
    const plans: readonly Plan[] = [
      { planId: 'annual', name: '연간', features: {}, isRecommended: true },
    ];
    const defs: readonly FeatureDef[] = [
      { featureKey: 'ghost', label: '없는 기능' },
    ];
    const matrix = planFeatureMapper(plans, defs);
    expect(matrix.rows[0]!.cells[0]!.highlighted).toBe(false);
  });

  it('highlighted=false when plan.isRecommended is absent (defaults to false)', () => {
    const plans: readonly Plan[] = [
      { planId: 'plain', name: '플레인', features: { f: true } },
    ];
    const defs: readonly FeatureDef[] = [{ featureKey: 'f', label: '기능 F' }];
    const matrix = planFeatureMapper(plans, defs);
    expect(matrix.rows[0]!.cells[0]!.highlighted).toBe(false);
  });
});

describe('planFeatureMapper — cell.highlighted (featureDef.highlightedPlanIds override)', () => {
  it('highlights only the specified planId even when it is not isRecommended', () => {
    const plans: readonly Plan[] = [
      { planId: 'monthly', name: '월간', features: { f: true }, isRecommended: false },
      { planId: 'annual',  name: '연간',  features: { f: true }, isRecommended: true },
    ];
    const defs: readonly FeatureDef[] = [
      { featureKey: 'f', label: '기능', highlightedPlanIds: ['monthly'] },
    ];
    const matrix = planFeatureMapper(plans, defs);
    // monthly highlighted despite isRecommended=false
    expect(matrix.rows[0]!.cells[0]!.highlighted).toBe(true);
    // annual NOT highlighted despite isRecommended=true (override in effect)
    expect(matrix.rows[0]!.cells[1]!.highlighted).toBe(false);
  });

  it('does NOT highlight a plan listed in highlightedPlanIds when its cell is unavailable', () => {
    const plans: readonly Plan[] = [
      { planId: 'annual', name: '연간', features: { f: false }, isRecommended: true },
    ];
    const defs: readonly FeatureDef[] = [
      { featureKey: 'f', label: '기능', highlightedPlanIds: ['annual'] },
    ];
    const matrix = planFeatureMapper(plans, defs);
    expect(matrix.rows[0]!.cells[0]!.highlighted).toBe(false);
  });

  it('highlights multiple plans when highlightedPlanIds lists several ids', () => {
    const plans: readonly Plan[] = [
      { planId: 'monthly', name: '월간', features: { f: true } },
      { planId: 'annual',  name: '연간',  features: { f: true } },
    ];
    const defs: readonly FeatureDef[] = [
      { featureKey: 'f', label: '기능', highlightedPlanIds: ['monthly', 'annual'] },
    ];
    const matrix = planFeatureMapper(plans, defs);
    expect(matrix.rows[0]!.cells[0]!.highlighted).toBe(true);
    expect(matrix.rows[0]!.cells[1]!.highlighted).toBe(true);
  });

  it('highlights zero plans when highlightedPlanIds is empty array', () => {
    const plans: readonly Plan[] = [
      { planId: 'annual', name: '연간', features: { f: true }, isRecommended: true },
    ];
    const defs: readonly FeatureDef[] = [
      { featureKey: 'f', label: '기능', highlightedPlanIds: [] },
    ];
    const matrix = planFeatureMapper(plans, defs);
    // Even though plan.isRecommended=true, the override forces no highlights
    expect(matrix.rows[0]!.cells[0]!.highlighted).toBe(false);
  });

  it('per-featureDef override applies independently to each row', () => {
    const plans: readonly Plan[] = [
      { planId: 'monthly', name: '월간', features: { f1: true, f2: true }, isRecommended: false },
      { planId: 'annual',  name: '연간',  features: { f1: true, f2: true }, isRecommended: true },
    ];
    // f1 row: highlight monthly only (override)
    // f2 row: no override → fall back to isRecommended (annual)
    const defs: readonly FeatureDef[] = [
      { featureKey: 'f1', label: '기능1', highlightedPlanIds: ['monthly'] },
      { featureKey: 'f2', label: '기능2' },
    ];
    const matrix = planFeatureMapper(plans, defs);

    // f1 row
    expect(matrix.rows[0]!.cells[0]!.highlighted).toBe(true);  // monthly, override
    expect(matrix.rows[0]!.cells[1]!.highlighted).toBe(false); // annual, not in override list

    // f2 row
    expect(matrix.rows[1]!.cells[0]!.highlighted).toBe(false); // monthly, isRecommended=false
    expect(matrix.rows[1]!.cells[1]!.highlighted).toBe(true);  // annual, isRecommended=true
  });
});

// ---------------------------------------------------------------------------
// Edge cases — empty inputs
// ---------------------------------------------------------------------------

describe('planFeatureMapper — edge cases', () => {
  it('returns empty rows when featureDefs is empty', () => {
    const matrix = planFeatureMapper([MONTHLY_PLAN, ANNUAL_PLAN], []);
    expect(matrix.rows).toHaveLength(0);
  });

  it('returns rows with empty cells arrays when plans is empty', () => {
    const matrix = planFeatureMapper([], FEATURE_DEFS);
    expect(matrix.rows).toHaveLength(FEATURE_DEFS.length);
    matrix.rows.forEach((row: FeatureMatrixRow) => {
      expect(row.cells).toHaveLength(0);
    });
  });

  it('returns empty matrix when both inputs are empty', () => {
    const matrix = planFeatureMapper([], []);
    expect(matrix.rows).toHaveLength(0);
    expect(matrix.plans).toHaveLength(0);
  });

  it('handles a single plan and single feature', () => {
    const plans: readonly Plan[] = [
      { planId: 'solo', name: '솔로', features: { x: 'yes' }, isRecommended: true },
    ];
    const defs: readonly FeatureDef[] = [{ featureKey: 'x', label: 'X' }];
    const matrix = planFeatureMapper(plans, defs);
    expect(matrix.rows).toHaveLength(1);
    expect(matrix.rows[0]!.cells).toHaveLength(1);
    const cell: FeatureCell = matrix.rows[0]!.cells[0]!;
    expect(cell.available).toBe(true);
    expect(cell.value).toBe('yes');
    expect(cell.highlighted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Purity — same input → structurally identical output
// ---------------------------------------------------------------------------

describe('planFeatureMapper — pure function', () => {
  it('returns structurally equal output on repeated calls with same input', () => {
    const result1 = runMapper();
    const result2 = runMapper();
    expect(result1).toEqual(result2);
  });

  it('does not mutate the input plans array', () => {
    const plans: Plan[] = [
      { planId: 'monthly', name: '월간', features: { f: true } },
    ];
    const originalLength = plans.length;
    planFeatureMapper(plans, [{ featureKey: 'f', label: 'F' }]);
    expect(plans).toHaveLength(originalLength);
    expect(plans[0]!.planId).toBe('monthly');
  });

  it('does not mutate the input featureDefs array', () => {
    const defs: FeatureDef[] = [{ featureKey: 'f', label: 'F' }];
    planFeatureMapper([MONTHLY_PLAN], defs);
    expect(defs[0]!.featureKey).toBe('f');
    expect(defs[0]!.label).toBe('F');
  });
});

// ---------------------------------------------------------------------------
// Immutability — output objects are frozen
// ---------------------------------------------------------------------------

describe('planFeatureMapper — output immutability', () => {
  it('the returned matrix object is frozen', () => {
    const matrix = runMapper();
    expect(Object.isFrozen(matrix)).toBe(true);
  });

  it('matrix.rows is frozen', () => {
    const matrix = runMapper();
    expect(Object.isFrozen(matrix.rows)).toBe(true);
  });

  it('each row is frozen', () => {
    const matrix = runMapper();
    matrix.rows.forEach((row: FeatureMatrixRow) => {
      expect(Object.isFrozen(row)).toBe(true);
    });
  });

  it('each row.cells array is frozen', () => {
    const matrix = runMapper();
    matrix.rows.forEach((row: FeatureMatrixRow) => {
      expect(Object.isFrozen(row.cells)).toBe(true);
    });
  });

  it('each cell is frozen', () => {
    const matrix = runMapper();
    matrix.rows.forEach((row: FeatureMatrixRow) => {
      row.cells.forEach((cell: FeatureCell) => {
        expect(Object.isFrozen(cell)).toBe(true);
      });
    });
  });
});

// ---------------------------------------------------------------------------
// Seed-specific scenario: monthly ($12) vs annual ($59 + 37-day trial)
// ---------------------------------------------------------------------------

describe('planFeatureMapper — Seed pricing scenario', () => {
  const SEED_PLANS: readonly Plan[] = [
    {
      planId: 'monthly',
      name: '월간 $12',
      features: {
        priceUsd: 12,
        trialDays: 0,
        trendDropAccess: true,
        generationCandidates: 5,
        prioritySupport: false,
      },
      isRecommended: false,
    },
    {
      planId: 'annual',
      name: '연간 $59',
      features: {
        priceUsd: 59,
        trialDays: 37,
        trendDropAccess: true,
        generationCandidates: '무제한',
        prioritySupport: true,
      },
      isRecommended: true,
    },
  ];

  const SEED_DEFS: readonly FeatureDef[] = [
    { featureKey: 'priceUsd', label: '월 요금 (USD)' },
    { featureKey: 'trialDays', label: '무료 체험일' },
    { featureKey: 'trendDropAccess', label: '트렌드 드롭 접근' },
    { featureKey: 'generationCandidates', label: '후보 생성 수' },
    { featureKey: 'prioritySupport', label: '우선 고객지원' },
  ];

  it('monthly plan: priceUsd=12 → available, not highlighted (not recommended)', () => {
    const matrix = planFeatureMapper(SEED_PLANS, SEED_DEFS);
    const priceRow = matrix.rows.find((r) => r.featureKey === 'priceUsd')!;
    expect(priceRow.cells[0]!.available).toBe(true);
    expect(priceRow.cells[0]!.value).toBe(12);
    expect(priceRow.cells[0]!.highlighted).toBe(false);
  });

  it('annual plan: priceUsd=59 → available, highlighted (isRecommended)', () => {
    const matrix = planFeatureMapper(SEED_PLANS, SEED_DEFS);
    const priceRow = matrix.rows.find((r) => r.featureKey === 'priceUsd')!;
    expect(priceRow.cells[1]!.available).toBe(true);
    expect(priceRow.cells[1]!.value).toBe(59);
    expect(priceRow.cells[1]!.highlighted).toBe(true);
  });

  it('monthly plan: trialDays=0 → not available, not highlighted', () => {
    const matrix = planFeatureMapper(SEED_PLANS, SEED_DEFS);
    const trialRow = matrix.rows.find((r) => r.featureKey === 'trialDays')!;
    expect(trialRow.cells[0]!.available).toBe(false);
    expect(trialRow.cells[0]!.value).toBe(0);
    expect(trialRow.cells[0]!.highlighted).toBe(false);
  });

  it('annual plan: trialDays=37 → available, highlighted (isRecommended)', () => {
    const matrix = planFeatureMapper(SEED_PLANS, SEED_DEFS);
    const trialRow = matrix.rows.find((r) => r.featureKey === 'trialDays')!;
    expect(trialRow.cells[1]!.available).toBe(true);
    expect(trialRow.cells[1]!.value).toBe(37);
    expect(trialRow.cells[1]!.highlighted).toBe(true);
  });

  it('both plans: trendDropAccess=true → both available; only annual highlighted', () => {
    const matrix = planFeatureMapper(SEED_PLANS, SEED_DEFS);
    const dropRow = matrix.rows.find((r) => r.featureKey === 'trendDropAccess')!;
    expect(dropRow.cells[0]!.available).toBe(true);
    expect(dropRow.cells[0]!.highlighted).toBe(false); // monthly, not recommended
    expect(dropRow.cells[1]!.available).toBe(true);
    expect(dropRow.cells[1]!.highlighted).toBe(true);  // annual, recommended
  });

  it('monthly plan: generationCandidates=5 → available, not highlighted', () => {
    const matrix = planFeatureMapper(SEED_PLANS, SEED_DEFS);
    const genRow = matrix.rows.find((r) => r.featureKey === 'generationCandidates')!;
    expect(genRow.cells[0]!.available).toBe(true);
    expect(genRow.cells[0]!.value).toBe(5);
    expect(genRow.cells[0]!.highlighted).toBe(false);
  });

  it('annual plan: generationCandidates="무제한" → available, highlighted', () => {
    const matrix = planFeatureMapper(SEED_PLANS, SEED_DEFS);
    const genRow = matrix.rows.find((r) => r.featureKey === 'generationCandidates')!;
    expect(genRow.cells[1]!.available).toBe(true);
    expect(genRow.cells[1]!.value).toBe('무제한');
    expect(genRow.cells[1]!.highlighted).toBe(true);
  });

  it('monthly plan: prioritySupport=false → not available, not highlighted', () => {
    const matrix = planFeatureMapper(SEED_PLANS, SEED_DEFS);
    const suppRow = matrix.rows.find((r) => r.featureKey === 'prioritySupport')!;
    expect(suppRow.cells[0]!.available).toBe(false);
    expect(suppRow.cells[0]!.highlighted).toBe(false);
  });

  it('annual plan: prioritySupport=true → available, highlighted', () => {
    const matrix = planFeatureMapper(SEED_PLANS, SEED_DEFS);
    const suppRow = matrix.rows.find((r) => r.featureKey === 'prioritySupport')!;
    expect(suppRow.cells[1]!.available).toBe(true);
    expect(suppRow.cells[1]!.value).toBe(true);
    expect(suppRow.cells[1]!.highlighted).toBe(true);
  });

  it('matrix has exactly 5 rows for 5 feature defs', () => {
    const matrix = planFeatureMapper(SEED_PLANS, SEED_DEFS);
    expect(matrix.rows).toHaveLength(5);
  });

  it('matrix has exactly 2 plans (columns)', () => {
    const matrix = planFeatureMapper(SEED_PLANS, SEED_DEFS);
    expect(matrix.plans).toHaveLength(2);
  });
});
