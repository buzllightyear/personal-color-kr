/**
 * Unit tests — Sub-AC 2.2: 8단계 스텝 메타데이터 모듈.
 *
 * 검증 범위:
 *   1. 길이 — `SCAN_ANIMATION_STEPS` / `SCAN_ANIMATION_STEP_ORDER` /
 *      `SCAN_ANIMATION_STEP_ICONS` 모두 정확히 8.
 *   2. 순서 — index가 0..7로 단조 증가, order = index + 1,
 *      라벨/아이콘이 정렬 순서와 정확히 정합한다.
 *   3. 라벨 SSoT — 라벨은 `scan-animation.ts`의 시그니처와 동일.
 *   4. 조회 함수 — `getScanAnimationStep` (정상/범위 밖),
 *      `findScanAnimationStepByLabel` / `findScanAnimationStepByIcon`
 *      (정상/미존재).
 *   5. type guard — `isScanAnimationStepIndex`가 0..7만 통과.
 *   6. 불변성 — 모든 export 상수와 각 항목이 frozen.
 */
import { describe, expect, it } from 'vitest';

import {
  CANONICAL_SCAN_ANIMATION_STAGES,
  SCAN_ANIMATION_STAGE_LABELS,
  SCAN_ANIMATION_TOTAL_STAGES,
  type ScanAnimationStageIndex,
} from '../../src/scan_option/scan-animation.js';
import {
  SCAN_ANIMATION_STEPS,
  SCAN_ANIMATION_STEP_ICONS,
  SCAN_ANIMATION_STEP_ORDER,
  findScanAnimationStepByIcon,
  findScanAnimationStepByLabel,
  getScanAnimationStep,
  isScanAnimationStepIndex,
  type ScanAnimationStep,
  type ScanAnimationStepIcon,
} from '../../src/scan_option/scan-animation-steps.js';

// ---------------------------------------------------------------------------
// 길이
// ---------------------------------------------------------------------------

describe('SCAN_ANIMATION_STEPS — 길이', () => {
  it('정확히 8개 스텝을 노출한다', () => {
    expect(SCAN_ANIMATION_STEPS).toHaveLength(SCAN_ANIMATION_TOTAL_STAGES);
    expect(SCAN_ANIMATION_TOTAL_STAGES).toBe(8);
  });

  it('icon / order 튜플도 모두 길이 8이다', () => {
    expect(SCAN_ANIMATION_STEP_ICONS).toHaveLength(8);
    expect(SCAN_ANIMATION_STEP_ORDER).toHaveLength(8);
  });

  it('라벨 SSoT와 길이가 정합한다', () => {
    expect(SCAN_ANIMATION_STEPS.length).toBe(SCAN_ANIMATION_STAGE_LABELS.length);
    expect(SCAN_ANIMATION_STEPS.length).toBe(CANONICAL_SCAN_ANIMATION_STAGES.length);
  });
});

// ---------------------------------------------------------------------------
// 순서
// ---------------------------------------------------------------------------

describe('SCAN_ANIMATION_STEPS — 순서', () => {
  it('index가 0..7로 단조 증가한다', () => {
    SCAN_ANIMATION_STEPS.forEach((step, i) => {
      expect(step.index).toBe(i);
    });
  });

  it('order는 1-기반(index + 1)이다', () => {
    SCAN_ANIMATION_STEPS.forEach((step) => {
      expect(step.order).toBe(step.index + 1);
    });
  });

  it('SCAN_ANIMATION_STEP_ORDER가 [0,1,2,3,4,5,6,7]과 같다', () => {
    expect([...SCAN_ANIMATION_STEP_ORDER]).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('라벨이 SCAN_ANIMATION_STAGE_LABELS 순서와 1:1로 일치한다', () => {
    SCAN_ANIMATION_STEPS.forEach((step, i) => {
      expect(step.label).toBe(SCAN_ANIMATION_STAGE_LABELS[i]);
    });
  });

  it('아이콘이 SCAN_ANIMATION_STEP_ICONS 순서와 1:1로 일치한다', () => {
    SCAN_ANIMATION_STEPS.forEach((step, i) => {
      expect(step.icon).toBe(SCAN_ANIMATION_STEP_ICONS[i]);
    });
  });

  it('아이콘 식별자는 모두 서로 다르다(중복 없음)', () => {
    const unique = new Set(SCAN_ANIMATION_STEP_ICONS);
    expect(unique.size).toBe(SCAN_ANIMATION_STEP_ICONS.length);
  });

  it('라벨은 모두 한국어 시그니처(가-힣 포함)다', () => {
    SCAN_ANIMATION_STEPS.forEach((step) => {
      expect(/[가-힣]/.test(step.label)).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// 조회: getScanAnimationStep
// ---------------------------------------------------------------------------

describe('getScanAnimationStep — 정상 접근', () => {
  for (let i = 0; i < 8; i += 1) {
    const idx = i as ScanAnimationStageIndex;
    it(`index=${i}: 메타데이터를 반환한다 (라벨/아이콘/order 정합)`, () => {
      const step = getScanAnimationStep(idx);
      expect(step.index).toBe(idx);
      expect(step.label).toBe(SCAN_ANIMATION_STAGE_LABELS[idx]);
      expect(step.icon).toBe(SCAN_ANIMATION_STEP_ICONS[idx]);
      expect(step.order).toBe(idx + 1);
    });
  }

  it('반환한 객체는 SCAN_ANIMATION_STEPS의 동일 참조다(메모이즈)', () => {
    for (let i = 0; i < 8; i += 1) {
      const idx = i as ScanAnimationStageIndex;
      expect(getScanAnimationStep(idx)).toBe(SCAN_ANIMATION_STEPS[idx]);
    }
  });
});

describe('getScanAnimationStep — 범위 밖 입력', () => {
  it('-1이면 RangeError', () => {
    expect(() =>
      getScanAnimationStep(-1 as unknown as ScanAnimationStageIndex),
    ).toThrowError(RangeError);
  });

  it('8(=총 단계 수)이면 RangeError', () => {
    expect(() =>
      getScanAnimationStep(8 as unknown as ScanAnimationStageIndex),
    ).toThrowError(RangeError);
  });

  it('소수점 인덱스는 RangeError', () => {
    expect(() =>
      getScanAnimationStep(1.5 as unknown as ScanAnimationStageIndex),
    ).toThrowError(RangeError);
  });

  it('NaN은 RangeError', () => {
    expect(() =>
      getScanAnimationStep(Number.NaN as unknown as ScanAnimationStageIndex),
    ).toThrowError(RangeError);
  });
});

// ---------------------------------------------------------------------------
// 조회: findScanAnimationStepByLabel / Icon
// ---------------------------------------------------------------------------

describe('findScanAnimationStepByLabel', () => {
  it('각 시그니처 라벨로 정확히 해당 스텝을 반환한다', () => {
    SCAN_ANIMATION_STAGE_LABELS.forEach((label, i) => {
      const found = findScanAnimationStepByLabel(label);
      expect(found).not.toBeNull();
      expect(found?.index).toBe(i);
      expect(found?.label).toBe(label);
    });
  });

  it('존재하지 않는 라벨은 null', () => {
    expect(findScanAnimationStepByLabel('존재하지 않는 단계')).toBeNull();
    expect(findScanAnimationStepByLabel('')).toBeNull();
  });

  it('대소문자/공백 정규화는 하지 않는다(정확 매칭 강제)', () => {
    // 시그니처 라벨 첫 번째 단계는 '얼굴 감지'.
    expect(findScanAnimationStepByLabel('얼굴감지')).toBeNull(); // 공백 차이
    expect(findScanAnimationStepByLabel(' 얼굴 감지 ')).toBeNull();
  });
});

describe('findScanAnimationStepByIcon', () => {
  it('각 아이콘 식별자로 정확히 해당 스텝을 반환한다', () => {
    SCAN_ANIMATION_STEP_ICONS.forEach((icon, i) => {
      const found = findScanAnimationStepByIcon(icon);
      expect(found).not.toBeNull();
      expect(found?.index).toBe(i);
      expect(found?.icon).toBe(icon);
    });
  });

  it('존재하지 않는 아이콘 식별자는 null', () => {
    expect(findScanAnimationStepByIcon('not-a-real-icon')).toBeNull();
    expect(findScanAnimationStepByIcon('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// type guard: isScanAnimationStepIndex
// ---------------------------------------------------------------------------

describe('isScanAnimationStepIndex', () => {
  it('0..7 정수는 true', () => {
    for (let i = 0; i < 8; i += 1) {
      expect(isScanAnimationStepIndex(i)).toBe(true);
    }
  });

  it('범위 밖 정수는 false', () => {
    expect(isScanAnimationStepIndex(-1)).toBe(false);
    expect(isScanAnimationStepIndex(8)).toBe(false);
    expect(isScanAnimationStepIndex(100)).toBe(false);
  });

  it('정수가 아닌 number는 false', () => {
    expect(isScanAnimationStepIndex(1.5)).toBe(false);
    expect(isScanAnimationStepIndex(Number.NaN)).toBe(false);
    expect(isScanAnimationStepIndex(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('non-number 입력은 false', () => {
    expect(isScanAnimationStepIndex('3')).toBe(false);
    expect(isScanAnimationStepIndex(null)).toBe(false);
    expect(isScanAnimationStepIndex(undefined)).toBe(false);
    expect(isScanAnimationStepIndex({})).toBe(false);
    expect(isScanAnimationStepIndex([])).toBe(false);
    expect(isScanAnimationStepIndex(true)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 불변성
// ---------------------------------------------------------------------------

describe('SCAN_ANIMATION_STEPS — 불변성', () => {
  it('SCAN_ANIMATION_STEPS 배열이 frozen이다', () => {
    expect(Object.isFrozen(SCAN_ANIMATION_STEPS)).toBe(true);
  });

  it('각 항목이 frozen이다', () => {
    for (const step of SCAN_ANIMATION_STEPS) {
      expect(Object.isFrozen(step)).toBe(true);
    }
  });

  it('SCAN_ANIMATION_STEP_ICONS / ORDER 튜플도 frozen이다', () => {
    expect(Object.isFrozen(SCAN_ANIMATION_STEP_ICONS)).toBe(true);
    expect(Object.isFrozen(SCAN_ANIMATION_STEP_ORDER)).toBe(true);
  });

  it('mutation 시도는 무시되거나 throw된다(strict mode)', () => {
    // 동결된 배열은 push가 TypeError(strict) — vitest는 strict 모드로 실행.
    expect(() => {
      (SCAN_ANIMATION_STEPS as unknown as ScanAnimationStep[]).push(
        {} as ScanAnimationStep,
      );
    }).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 타입 안내(컴파일 타임만 확인용) — 런타임 단언으로 표현
// ---------------------------------------------------------------------------

describe('타입 안내', () => {
  it('SCAN_ANIMATION_STEP_ICONS 값이 ScanAnimationStepIcon 유니언에 속한다', () => {
    // 런타임 길이/값 일치를 확인.  타입 자체는 컴파일이 보장.
    const expected: readonly ScanAnimationStepIcon[] = [
      'face-detect',
      'face-contour',
      'skin-region',
      'eye-region',
      'lip-region',
      'color-sampling',
      'tone-matching',
      'result-ready',
    ];
    expect([...SCAN_ANIMATION_STEP_ICONS]).toEqual(expected);
  });
});
