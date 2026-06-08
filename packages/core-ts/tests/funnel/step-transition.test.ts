/**
 * 단위 테스트 — 결제 깔때기 단계 전환 로직 모듈 (Sub-AC 14a-4)
 *
 * 검증 대상:
 *   1. 순차 진입 (1→2→3 sequential forward entry)
 *   2. 뒤로 이동 (backward retreat)
 *   3. 단계 범위 초과 시 예외 처리 (StepRangeError on out-of-range)
 *
 * 함수: `validateStepRange`, `enterNextStep`, `retreatToPrevStep`, `StepRangeError`
 *
 * 설계 원칙:
 *   - 각 it-block은 단일 행동을 검증 (atomic AC)
 *   - out-of-range 경계값은 경계 양쪽 모두 검증 (0 and 13)
 *   - 순수 함수 계약 (immutability, determinism) 검증 포함
 */
import { describe, expect, it } from 'vitest';

import {
  MAX_FUNNEL_STEP,
  MIN_FUNNEL_STEP,
  StepRangeError,
  enterNextStep,
  retreatToPrevStep,
  validateStepRange,
} from '../../src/funnel/step-transition.js';

// ---------------------------------------------------------------------------
// 상수 검증
// ---------------------------------------------------------------------------

describe('MIN_FUNNEL_STEP / MAX_FUNNEL_STEP 상수', () => {
  it('MIN_FUNNEL_STEP === 1 (첫 번째 단계)', () => {
    expect(MIN_FUNNEL_STEP).toBe(1);
  });

  it('MAX_FUNNEL_STEP === 12 (마지막 단계)', () => {
    expect(MAX_FUNNEL_STEP).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// StepRangeError 예외 클래스
// ---------------------------------------------------------------------------

describe('StepRangeError 예외 클래스', () => {
  it('message에 요청된 단계 번호와 사유가 포함된다', () => {
    const err = new StepRangeError(0, '최소 미만');
    expect(err.message).toContain('0');
    expect(err.message).toContain('최소 미만');
  });

  it('name은 "StepRangeError"다', () => {
    const err = new StepRangeError(13, '최대 초과');
    expect(err.name).toBe('StepRangeError');
  });

  it('requestedStep 필드에 요청된 단계 번호가 저장된다', () => {
    const err = new StepRangeError(99, 'test');
    expect(err.requestedStep).toBe(99);
  });

  it('instanceof StepRangeError === true (prototype chain 정상)', () => {
    const err = new StepRangeError(0, 'test');
    expect(err instanceof StepRangeError).toBe(true);
  });

  it('instanceof Error === true (Error 상속)', () => {
    const err = new StepRangeError(0, 'test');
    expect(err instanceof Error).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateStepRange — 범위 검증
// ---------------------------------------------------------------------------

describe('validateStepRange — 단계 범위 초과 시 예외 처리', () => {
  // 유효 범위
  it('step 1은 유효 범위 — 예외 없이 통과한다', () => {
    expect(() => validateStepRange(1)).not.toThrow();
  });

  it('step 12는 유효 범위 — 예외 없이 통과한다', () => {
    expect(() => validateStepRange(12)).not.toThrow();
  });

  it('step 6(중간)은 유효 범위 — 예외 없이 통과한다', () => {
    expect(() => validateStepRange(6)).not.toThrow();
  });

  // 하한 경계: step 0 (1 미만)
  it('step 0 → StepRangeError throw (최소 미만 경계)', () => {
    expect(() => validateStepRange(0)).toThrow(StepRangeError);
  });

  it('step 0 → StepRangeError.requestedStep === 0', () => {
    try {
      validateStepRange(0);
      expect.fail('StepRangeError가 throw되어야 한다');
    } catch (err) {
      expect(err instanceof StepRangeError).toBe(true);
      expect((err as StepRangeError).requestedStep).toBe(0);
    }
  });

  it('step -1 → StepRangeError throw (음수 단계)', () => {
    expect(() => validateStepRange(-1)).toThrow(StepRangeError);
  });

  it('step -100 → StepRangeError throw (큰 음수)', () => {
    expect(() => validateStepRange(-100)).toThrow(StepRangeError);
  });

  // 상한 경계: step 13 (12 초과)
  it('step 13 → StepRangeError throw (최대 초과 경계)', () => {
    expect(() => validateStepRange(13)).toThrow(StepRangeError);
  });

  it('step 13 → StepRangeError.requestedStep === 13', () => {
    try {
      validateStepRange(13);
      expect.fail('StepRangeError가 throw되어야 한다');
    } catch (err) {
      expect(err instanceof StepRangeError).toBe(true);
      expect((err as StepRangeError).requestedStep).toBe(13);
    }
  });

  it('step 100 → StepRangeError throw (큰 양수 초과)', () => {
    expect(() => validateStepRange(100)).toThrow(StepRangeError);
  });

  // 전체 유효 범위 순회
  it('step 1..12 모두 유효 범위 — 어느 단계도 예외 없음', () => {
    for (let step = MIN_FUNNEL_STEP; step <= MAX_FUNNEL_STEP; step++) {
      expect(() => validateStepRange(step)).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// enterNextStep — 1→2→3 순차 진입
// ---------------------------------------------------------------------------

describe('enterNextStep — 1→2→3 순차 진입 (sequential forward entry)', () => {
  // 핵심 순차 진입 시나리오
  it('1 → 2: enterNextStep(1) === 2 (첫 단계 진입)', () => {
    expect(enterNextStep(1)).toBe(2);
  });

  it('2 → 3: enterNextStep(2) === 3', () => {
    expect(enterNextStep(2)).toBe(3);
  });

  it('3 → 4: enterNextStep(3) === 4', () => {
    expect(enterNextStep(3)).toBe(4);
  });

  it('1→2→3 연속 진입: 시작 단계 1에서 두 번 enterNextStep하면 3에 도달', () => {
    const step1 = 1;
    const step2 = enterNextStep(step1); // → 2
    const step3 = enterNextStep(step2); // → 3
    expect(step2).toBe(2);
    expect(step3).toBe(3);
  });

  it('전체 순차 순회: step 1에서 11번 enterNextStep 하면 step 12에 도달', () => {
    let step = 1;
    for (let i = 1; i < MAX_FUNNEL_STEP; i++) {
      step = enterNextStep(step);
    }
    expect(step).toBe(12);
  });

  it('11 → 12: 마지막으로 유효한 전진 (step 11 → 12)', () => {
    expect(enterNextStep(11)).toBe(12);
  });

  // 마지막 단계에서 전진 시 예외
  it('12 → 13: step 12에서 enterNextStep → StepRangeError throw (최대 초과)', () => {
    expect(() => enterNextStep(12)).toThrow(StepRangeError);
  });

  it('step 12에서 enterNextStep → requestedStep === 13', () => {
    try {
      enterNextStep(12);
      expect.fail('StepRangeError가 throw되어야 한다');
    } catch (err) {
      expect(err instanceof StepRangeError).toBe(true);
      expect((err as StepRangeError).requestedStep).toBe(13);
    }
  });

  // 입력 범위 초과 시 예외
  it('enterNextStep(0) → StepRangeError throw (유효 범위 밖 입력)', () => {
    expect(() => enterNextStep(0)).toThrow(StepRangeError);
  });

  it('enterNextStep(-1) → StepRangeError throw (음수 입력)', () => {
    expect(() => enterNextStep(-1)).toThrow(StepRangeError);
  });

  it('enterNextStep(13) → StepRangeError throw (최대 초과 입력)', () => {
    expect(() => enterNextStep(13)).toThrow(StepRangeError);
  });

  // 순수 함수 검증
  it('순수 함수: 동일 입력에 동일 출력', () => {
    const a = enterNextStep(5);
    const b = enterNextStep(5);
    expect(a).toBe(b);
    expect(a).toBe(6);
  });

  it('입력 값 자체를 변이하지 않는다 (순수 함수)', () => {
    const currentStep = 3;
    enterNextStep(currentStep);
    // 숫자 primitive는 변이 불가 — 참조 동일성 확인
    expect(currentStep).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// retreatToPrevStep — 뒤로 이동 (backward retreat)
// ---------------------------------------------------------------------------

describe('retreatToPrevStep — 뒤로 이동 (backward retreat)', () => {
  // 핵심 후퇴 시나리오
  it('3 → 2: retreatToPrevStep(3) === 2', () => {
    expect(retreatToPrevStep(3)).toBe(2);
  });

  it('2 → 1: retreatToPrevStep(2) === 1 (첫 단계로 복귀)', () => {
    expect(retreatToPrevStep(2)).toBe(1);
  });

  it('12 → 11: 마지막 단계에서 후퇴 가능', () => {
    expect(retreatToPrevStep(12)).toBe(11);
  });

  it('3→2→1 연속 후퇴: step 3에서 두 번 retreatToPrevStep하면 1에 도달', () => {
    const step3 = 3;
    const step2 = retreatToPrevStep(step3); // → 2
    const step1 = retreatToPrevStep(step2); // → 1
    expect(step2).toBe(2);
    expect(step1).toBe(1);
  });

  it('전체 역순 순회: step 12에서 11번 retreatToPrevStep 하면 step 1에 도달', () => {
    let step = 12;
    for (let i = 1; i < MAX_FUNNEL_STEP; i++) {
      step = retreatToPrevStep(step);
    }
    expect(step).toBe(1);
  });

  // 첫 번째 단계에서 후퇴 시 예외
  it('step 1에서 retreatToPrevStep → StepRangeError throw (최소 미만으로 후퇴 불가)', () => {
    expect(() => retreatToPrevStep(1)).toThrow(StepRangeError);
  });

  it('step 1에서 retreatToPrevStep → requestedStep === 0', () => {
    try {
      retreatToPrevStep(1);
      expect.fail('StepRangeError가 throw되어야 한다');
    } catch (err) {
      expect(err instanceof StepRangeError).toBe(true);
      expect((err as StepRangeError).requestedStep).toBe(0);
    }
  });

  // 입력 범위 초과 시 예외
  it('retreatToPrevStep(0) → StepRangeError throw (유효 범위 밖 입력)', () => {
    expect(() => retreatToPrevStep(0)).toThrow(StepRangeError);
  });

  it('retreatToPrevStep(-1) → StepRangeError throw (음수 입력)', () => {
    expect(() => retreatToPrevStep(-1)).toThrow(StepRangeError);
  });

  it('retreatToPrevStep(13) → StepRangeError throw (최대 초과 입력)', () => {
    expect(() => retreatToPrevStep(13)).toThrow(StepRangeError);
  });

  // 순수 함수 검증
  it('순수 함수: 동일 입력에 동일 출력', () => {
    const a = retreatToPrevStep(7);
    const b = retreatToPrevStep(7);
    expect(a).toBe(b);
    expect(a).toBe(6);
  });

  it('입력 값 자체를 변이하지 않는다 (순수 함수)', () => {
    const currentStep = 5;
    retreatToPrevStep(currentStep);
    expect(currentStep).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// 전진 ↔ 후퇴 대칭성 (round-trip)
// ---------------------------------------------------------------------------

describe('enterNextStep ↔ retreatToPrevStep 대칭성 (round-trip)', () => {
  it('전진 후 후퇴하면 원래 단계로 복귀한다 (step 1..11 구간)', () => {
    for (let step = MIN_FUNNEL_STEP; step < MAX_FUNNEL_STEP; step++) {
      const advanced = enterNextStep(step);
      const retreated = retreatToPrevStep(advanced);
      expect(retreated).toBe(step);
    }
  });

  it('후퇴 후 전진하면 원래 단계로 복귀한다 (step 2..12 구간)', () => {
    for (let step = MIN_FUNNEL_STEP + 1; step <= MAX_FUNNEL_STEP; step++) {
      const retreated = retreatToPrevStep(step);
      const advanced = enterNextStep(retreated);
      expect(advanced).toBe(step);
    }
  });
});

// ---------------------------------------------------------------------------
// 단계 범위 경계값 총괄 (경계값 분석 — boundary value analysis)
// ---------------------------------------------------------------------------

describe('단계 범위 경계값 총괄', () => {
  it('step -1: 모든 함수가 StepRangeError throw', () => {
    expect(() => validateStepRange(-1)).toThrow(StepRangeError);
    expect(() => enterNextStep(-1)).toThrow(StepRangeError);
    expect(() => retreatToPrevStep(-1)).toThrow(StepRangeError);
  });

  it('step 0: 모든 함수가 StepRangeError throw', () => {
    expect(() => validateStepRange(0)).toThrow(StepRangeError);
    expect(() => enterNextStep(0)).toThrow(StepRangeError);
    expect(() => retreatToPrevStep(0)).toThrow(StepRangeError);
  });

  it('step 1: validateStepRange 통과, retreatToPrevStep은 StepRangeError', () => {
    expect(() => validateStepRange(1)).not.toThrow();
    expect(enterNextStep(1)).toBe(2);
    expect(() => retreatToPrevStep(1)).toThrow(StepRangeError);
  });

  it('step 12: validateStepRange 통과, enterNextStep은 StepRangeError', () => {
    expect(() => validateStepRange(12)).not.toThrow();
    expect(() => enterNextStep(12)).toThrow(StepRangeError);
    expect(retreatToPrevStep(12)).toBe(11);
  });

  it('step 13: 모든 함수가 StepRangeError throw', () => {
    expect(() => validateStepRange(13)).toThrow(StepRangeError);
    expect(() => enterNextStep(13)).toThrow(StepRangeError);
    expect(() => retreatToPrevStep(13)).toThrow(StepRangeError);
  });

  it('step 100: 모든 함수가 StepRangeError throw', () => {
    expect(() => validateStepRange(100)).toThrow(StepRangeError);
    expect(() => enterNextStep(100)).toThrow(StepRangeError);
    expect(() => retreatToPrevStep(100)).toThrow(StepRangeError);
  });
});
