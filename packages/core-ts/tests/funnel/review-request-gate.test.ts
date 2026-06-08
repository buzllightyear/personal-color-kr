/**
 * 단위 테스트 — `shouldRequestReview` 순수 함수 (Sub-AC 14b-1).
 *
 * 검증 계약:
 *   `shouldRequestReview`는 세 가지 독립 조건을 AND 논리로 평가하는 순수 함수입니다.
 *
 *   조건 1. 결제 완료 여부  (paymentCompleted)
 *   조건 2. 이전 요청 이력  (hasPreviouslyRequested — false여야 통과)
 *   조건 3. 최소 사용 횟수  (usageCount >= minimumUsageCount)
 *
 *   세 조건 모두 충족 시 shouldRequest = true,
 *   하나라도 불충족 시 shouldRequest = false.
 *
 * 커버리지 매트릭스:
 *   1. 모든 조건 충족 → shouldRequest = true
 *   2. 결제 미완료    → shouldRequest = false (paymentCompleted = false)
 *   3. 이전 요청 이력 존재 → shouldRequest = false (hasPreviouslyRequested = true)
 *   4. 사용 횟수 미달 → shouldRequest = false (usageCount < minimumUsageCount)
 *   5. 두 조건 이상 동시 불충족 → shouldRequest = false
 *   6. minimumUsageCount 기본값(1) 적용
 *   7. usageCount === minimumUsageCount (경계값 — 정확히 임계값) → true
 *   8. usageCount === minimumUsageCount - 1 (경계값 — 임계값 미달) → false
 *   9. minimumUsageCount = 0 → usageCount 0 이상이면 충족
 *  10. 출력 객체 동결(freeze) 검증
 *  11. 출력 필드 트레이서빌리티 (usageCount, minimumUsageCount 에코)
 *  12. 순수성: 동일 입력 → 동일 출력 (결정론적)
 *  13. 순수성: 입력 객체 불변 (호출 후 입력 변경 없음)
 *  14. 입력 검증 — paymentCompleted 비boolean 거부
 *  15. 입력 검증 — hasPreviouslyRequested 비boolean 거부
 *  16. 입력 검증 — usageCount 음수 거부
 *  17. 입력 검증 — usageCount 비정수(float) 거부
 *  18. 입력 검증 — usageCount NaN 거부
 *  19. 입력 검증 — minimumUsageCount 음수 거부
 *  20. 입력 검증 — minimumUsageCount 비정수(float) 거부
 *  21. ReviewRequestGateError reason 판별자 확인
 *  22. DEFAULT_MINIMUM_USAGE_COUNT 상수 값 확인
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MINIMUM_USAGE_COUNT,
  ReviewRequestGateError,
  shouldRequestReview,
  type ReviewRequestDecision,
  type ShouldRequestReviewInput,
} from '../../src/funnel/review-request-gate.js';

// ---------------------------------------------------------------------------
// 헬퍼
// ---------------------------------------------------------------------------

/** 전체 충족 기본 입력. 각 테스트에서 필요한 필드만 재정의. */
function makeValidInput(
  overrides: Partial<ShouldRequestReviewInput> = {},
): ShouldRequestReviewInput {
  return {
    paymentCompleted: true,
    hasPreviouslyRequested: false,
    usageCount: 1,
    minimumUsageCount: 1,
    ...overrides,
  };
}

/** `shouldRequestReview` 호출 시 throw 발생을 검사하고 에러 반환. */
function expectThrows(fn: () => unknown): ReviewRequestGateError {
  let caught: unknown;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(ReviewRequestGateError);
  return caught as ReviewRequestGateError;
}

// ---------------------------------------------------------------------------
// 1. 모든 조건 충족 → shouldRequest = true
// ---------------------------------------------------------------------------

describe('shouldRequestReview — 모든 조건 충족', () => {
  it('세 조건 모두 충족 시 shouldRequest = true를 반환한다', () => {
    const decision = shouldRequestReview(makeValidInput());
    expect(decision.shouldRequest).toBe(true);
  });

  it('shouldRequest = true일 때 각 조건 필드도 모두 true다', () => {
    const decision = shouldRequestReview(makeValidInput());
    expect(decision.paymentCompleted).toBe(true);
    expect(decision.noPreviousRequest).toBe(true);
    expect(decision.usageThresholdMet).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. 결제 미완료 → shouldRequest = false
// ---------------------------------------------------------------------------

describe('shouldRequestReview — 결제 미완료', () => {
  it('paymentCompleted=false 시 shouldRequest = false를 반환한다', () => {
    const decision = shouldRequestReview(makeValidInput({ paymentCompleted: false }));
    expect(decision.shouldRequest).toBe(false);
  });

  it('결제 미완료 시 paymentCompleted 필드가 false로 에코된다', () => {
    const decision = shouldRequestReview(makeValidInput({ paymentCompleted: false }));
    expect(decision.paymentCompleted).toBe(false);
  });

  it('결제 미완료임에도 나머지 조건은 충족 상태로 평가된다', () => {
    const decision = shouldRequestReview(
      makeValidInput({ paymentCompleted: false, usageCount: 10, minimumUsageCount: 1 }),
    );
    expect(decision.noPreviousRequest).toBe(true);
    expect(decision.usageThresholdMet).toBe(true);
    expect(decision.shouldRequest).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. 이전 요청 이력 존재 → shouldRequest = false
// ---------------------------------------------------------------------------

describe('shouldRequestReview — 이전 요청 이력 존재', () => {
  it('hasPreviouslyRequested=true 시 shouldRequest = false를 반환한다', () => {
    const decision = shouldRequestReview(
      makeValidInput({ hasPreviouslyRequested: true }),
    );
    expect(decision.shouldRequest).toBe(false);
  });

  it('이전 요청 이력 있음 시 noPreviousRequest 필드가 false다', () => {
    const decision = shouldRequestReview(
      makeValidInput({ hasPreviouslyRequested: true }),
    );
    expect(decision.noPreviousRequest).toBe(false);
  });

  it('이전 요청 이력 없음 시 noPreviousRequest 필드가 true다', () => {
    const decision = shouldRequestReview(
      makeValidInput({ hasPreviouslyRequested: false }),
    );
    expect(decision.noPreviousRequest).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. 사용 횟수 미달 → shouldRequest = false
// ---------------------------------------------------------------------------

describe('shouldRequestReview — 사용 횟수 미달', () => {
  it('usageCount < minimumUsageCount 시 shouldRequest = false를 반환한다', () => {
    const decision = shouldRequestReview(
      makeValidInput({ usageCount: 0, minimumUsageCount: 1 }),
    );
    expect(decision.shouldRequest).toBe(false);
  });

  it('사용 횟수 미달 시 usageThresholdMet 필드가 false다', () => {
    const decision = shouldRequestReview(
      makeValidInput({ usageCount: 2, minimumUsageCount: 5 }),
    );
    expect(decision.usageThresholdMet).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. 두 조건 이상 동시 불충족
// ---------------------------------------------------------------------------

describe('shouldRequestReview — 복수 조건 불충족', () => {
  it('결제 미완료 + 이전 요청 이력 → shouldRequest = false', () => {
    const decision = shouldRequestReview(
      makeValidInput({ paymentCompleted: false, hasPreviouslyRequested: true }),
    );
    expect(decision.shouldRequest).toBe(false);
    expect(decision.paymentCompleted).toBe(false);
    expect(decision.noPreviousRequest).toBe(false);
  });

  it('결제 미완료 + 사용 횟수 미달 → shouldRequest = false', () => {
    const decision = shouldRequestReview(
      makeValidInput({ paymentCompleted: false, usageCount: 0, minimumUsageCount: 3 }),
    );
    expect(decision.shouldRequest).toBe(false);
    expect(decision.usageThresholdMet).toBe(false);
  });

  it('세 조건 모두 불충족 → shouldRequest = false', () => {
    const decision = shouldRequestReview({
      paymentCompleted: false,
      hasPreviouslyRequested: true,
      usageCount: 0,
      minimumUsageCount: 5,
    });
    expect(decision.shouldRequest).toBe(false);
    expect(decision.paymentCompleted).toBe(false);
    expect(decision.noPreviousRequest).toBe(false);
    expect(decision.usageThresholdMet).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. DEFAULT_MINIMUM_USAGE_COUNT 기본값 적용
// ---------------------------------------------------------------------------

describe('shouldRequestReview — minimumUsageCount 기본값', () => {
  it('minimumUsageCount 미지정 시 DEFAULT_MINIMUM_USAGE_COUNT(1)이 적용된다', () => {
    const decision = shouldRequestReview({
      paymentCompleted: true,
      hasPreviouslyRequested: false,
      usageCount: 1,
      // minimumUsageCount 생략
    });
    expect(decision.minimumUsageCount).toBe(DEFAULT_MINIMUM_USAGE_COUNT);
    expect(decision.shouldRequest).toBe(true);
  });

  it('기본값 적용 시 usageCount=0이면 shouldRequest = false', () => {
    const decision = shouldRequestReview({
      paymentCompleted: true,
      hasPreviouslyRequested: false,
      usageCount: 0,
    });
    expect(decision.minimumUsageCount).toBe(DEFAULT_MINIMUM_USAGE_COUNT);
    expect(decision.shouldRequest).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7 & 8. 경계값 (boundary) 검증
// ---------------------------------------------------------------------------

describe('shouldRequestReview — 경계값 (usageCount === minimumUsageCount)', () => {
  it('usageCount === minimumUsageCount 정확히 임계값 → shouldRequest = true', () => {
    const decision = shouldRequestReview(
      makeValidInput({ usageCount: 5, minimumUsageCount: 5 }),
    );
    expect(decision.usageThresholdMet).toBe(true);
    expect(decision.shouldRequest).toBe(true);
  });

  it('usageCount === minimumUsageCount - 1 (임계값 한 칸 아래) → shouldRequest = false', () => {
    const decision = shouldRequestReview(
      makeValidInput({ usageCount: 4, minimumUsageCount: 5 }),
    );
    expect(decision.usageThresholdMet).toBe(false);
    expect(decision.shouldRequest).toBe(false);
  });

  it('usageCount > minimumUsageCount → shouldRequest = true', () => {
    const decision = shouldRequestReview(
      makeValidInput({ usageCount: 10, minimumUsageCount: 5 }),
    );
    expect(decision.usageThresholdMet).toBe(true);
    expect(decision.shouldRequest).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 9. minimumUsageCount = 0 엣지 케이스
// ---------------------------------------------------------------------------

describe('shouldRequestReview — minimumUsageCount = 0', () => {
  it('minimumUsageCount = 0이면 usageCount = 0도 임계값 충족', () => {
    const decision = shouldRequestReview(
      makeValidInput({ usageCount: 0, minimumUsageCount: 0 }),
    );
    expect(decision.usageThresholdMet).toBe(true);
    expect(decision.shouldRequest).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 10. 출력 객체 동결 검증
// ---------------------------------------------------------------------------

describe('shouldRequestReview — 출력 불변성 (frozen output)', () => {
  it('반환된 결정 객체는 Object.freeze되어 있다', () => {
    const decision = shouldRequestReview(makeValidInput());
    expect(Object.isFrozen(decision)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 11. 출력 필드 트레이서빌리티
// ---------------------------------------------------------------------------

describe('shouldRequestReview — 출력 필드 에코 (traceability)', () => {
  it('usageCount 필드가 입력값 그대로 에코된다', () => {
    const decision = shouldRequestReview(makeValidInput({ usageCount: 42 }));
    expect(decision.usageCount).toBe(42);
  });

  it('minimumUsageCount 필드가 입력값 그대로 에코된다', () => {
    const decision = shouldRequestReview(
      makeValidInput({ usageCount: 5, minimumUsageCount: 3 }),
    );
    expect(decision.minimumUsageCount).toBe(3);
  });

  it('minimumUsageCount 미지정 시 기본값이 에코된다', () => {
    const decision = shouldRequestReview({
      paymentCompleted: true,
      hasPreviouslyRequested: false,
      usageCount: 1,
    });
    expect(decision.minimumUsageCount).toBe(DEFAULT_MINIMUM_USAGE_COUNT);
  });
});

// ---------------------------------------------------------------------------
// 12. 순수성 — 결정론적 (동일 입력 → 동일 출력)
// ---------------------------------------------------------------------------

describe('shouldRequestReview — 순수성 (deterministic)', () => {
  it('동일한 입력을 두 번 호출하면 동일한 결과를 반환한다', () => {
    const input = makeValidInput({ usageCount: 3, minimumUsageCount: 2 });
    const a = shouldRequestReview(input);
    const b = shouldRequestReview(input);
    expect(a).toEqual(b);
  });

  it('서로 다른 입력은 독립적인 결과를 반환한다', () => {
    const trueDecision = shouldRequestReview(makeValidInput());
    const falseDecision = shouldRequestReview(
      makeValidInput({ paymentCompleted: false }),
    );
    expect(trueDecision.shouldRequest).toBe(true);
    expect(falseDecision.shouldRequest).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 13. 순수성 — 입력 객체 불변 (mutation guard)
// ---------------------------------------------------------------------------

describe('shouldRequestReview — 입력 불변 보장', () => {
  it('함수 호출 후 입력 객체의 필드가 변경되지 않는다', () => {
    const input: ShouldRequestReviewInput = {
      paymentCompleted: true,
      hasPreviouslyRequested: false,
      usageCount: 5,
      minimumUsageCount: 3,
    };
    // 입력 스냅샷
    const before = { ...input };
    shouldRequestReview(input);
    // 호출 후에도 동일한 값
    expect(input.paymentCompleted).toBe(before.paymentCompleted);
    expect(input.hasPreviouslyRequested).toBe(before.hasPreviouslyRequested);
    expect(input.usageCount).toBe(before.usageCount);
    expect(input.minimumUsageCount).toBe(before.minimumUsageCount);
  });
});

// ---------------------------------------------------------------------------
// 14–21. 입력 검증 (유효하지 않은 값 → ReviewRequestGateError throw)
// ---------------------------------------------------------------------------

describe('shouldRequestReview — 입력 검증: paymentCompleted', () => {
  it('paymentCompleted가 string이면 ReviewRequestGateError를 throw한다', () => {
    const err = expectThrows(() =>
      shouldRequestReview(makeValidInput({ paymentCompleted: 'yes' as never })),
    );
    expect(err.reason).toBe('invalid_payment_completed');
  });

  it('paymentCompleted가 null이면 ReviewRequestGateError를 throw한다', () => {
    const err = expectThrows(() =>
      shouldRequestReview(makeValidInput({ paymentCompleted: null as never })),
    );
    expect(err.reason).toBe('invalid_payment_completed');
  });

  it('paymentCompleted가 1(number)이면 ReviewRequestGateError를 throw한다', () => {
    const err = expectThrows(() =>
      shouldRequestReview(makeValidInput({ paymentCompleted: 1 as never })),
    );
    expect(err.reason).toBe('invalid_payment_completed');
  });
});

describe('shouldRequestReview — 입력 검증: hasPreviouslyRequested', () => {
  it('hasPreviouslyRequested가 string이면 ReviewRequestGateError를 throw한다', () => {
    const err = expectThrows(() =>
      shouldRequestReview(makeValidInput({ hasPreviouslyRequested: 'no' as never })),
    );
    expect(err.reason).toBe('invalid_has_previously_requested');
  });

  it('hasPreviouslyRequested가 0(number)이면 ReviewRequestGateError를 throw한다', () => {
    const err = expectThrows(() =>
      shouldRequestReview(makeValidInput({ hasPreviouslyRequested: 0 as never })),
    );
    expect(err.reason).toBe('invalid_has_previously_requested');
  });
});

describe('shouldRequestReview — 입력 검증: usageCount', () => {
  it('usageCount가 음수이면 ReviewRequestGateError를 throw한다', () => {
    const err = expectThrows(() =>
      shouldRequestReview(makeValidInput({ usageCount: -1 })),
    );
    expect(err.reason).toBe('invalid_usage_count');
  });

  it('usageCount가 float이면 ReviewRequestGateError를 throw한다', () => {
    const err = expectThrows(() =>
      shouldRequestReview(makeValidInput({ usageCount: 1.5 })),
    );
    expect(err.reason).toBe('invalid_usage_count');
  });

  it('usageCount가 NaN이면 ReviewRequestGateError를 throw한다', () => {
    const err = expectThrows(() =>
      shouldRequestReview(makeValidInput({ usageCount: NaN })),
    );
    expect(err.reason).toBe('invalid_usage_count');
  });

  it('usageCount가 Infinity이면 ReviewRequestGateError를 throw한다', () => {
    const err = expectThrows(() =>
      shouldRequestReview(makeValidInput({ usageCount: Infinity })),
    );
    expect(err.reason).toBe('invalid_usage_count');
  });

  it('usageCount가 string이면 ReviewRequestGateError를 throw한다', () => {
    const err = expectThrows(() =>
      shouldRequestReview(makeValidInput({ usageCount: '3' as never })),
    );
    expect(err.reason).toBe('invalid_usage_count');
  });
});

describe('shouldRequestReview — 입력 검증: minimumUsageCount', () => {
  it('minimumUsageCount가 음수이면 ReviewRequestGateError를 throw한다', () => {
    const err = expectThrows(() =>
      shouldRequestReview(makeValidInput({ minimumUsageCount: -1 })),
    );
    expect(err.reason).toBe('invalid_minimum_usage_count');
  });

  it('minimumUsageCount가 float이면 ReviewRequestGateError를 throw한다', () => {
    const err = expectThrows(() =>
      shouldRequestReview(makeValidInput({ minimumUsageCount: 0.5 })),
    );
    expect(err.reason).toBe('invalid_minimum_usage_count');
  });

  it('minimumUsageCount가 NaN이면 ReviewRequestGateError를 throw한다', () => {
    const err = expectThrows(() =>
      shouldRequestReview(makeValidInput({ minimumUsageCount: NaN })),
    );
    expect(err.reason).toBe('invalid_minimum_usage_count');
  });

  it('minimumUsageCount가 undefined이면 에러 없이 기본값이 적용된다', () => {
    // undefined는 허용 — 기본값으로 대체
    const decision = shouldRequestReview({
      paymentCompleted: true,
      hasPreviouslyRequested: false,
      usageCount: 1,
      minimumUsageCount: undefined,
    });
    expect(decision.minimumUsageCount).toBe(DEFAULT_MINIMUM_USAGE_COUNT);
  });
});

// ---------------------------------------------------------------------------
// 21. ReviewRequestGateError reason 판별자 확인
// ---------------------------------------------------------------------------

describe('ReviewRequestGateError — reason 판별자', () => {
  it('에러 이름이 "ReviewRequestGateError"다', () => {
    const err = expectThrows(() =>
      shouldRequestReview(makeValidInput({ usageCount: -5 })),
    );
    expect(err.name).toBe('ReviewRequestGateError');
  });

  it('value 필드에 유효하지 않은 입력값이 담겨 있다', () => {
    const err = expectThrows(() =>
      shouldRequestReview(makeValidInput({ usageCount: -99 })),
    );
    expect(err.value).toBe(-99);
  });

  it('ReviewRequestGateError는 Error를 상속한다', () => {
    const err = expectThrows(() =>
      shouldRequestReview(makeValidInput({ usageCount: -1 })),
    );
    expect(err).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// 22. DEFAULT_MINIMUM_USAGE_COUNT 상수 값 확인
// ---------------------------------------------------------------------------

describe('DEFAULT_MINIMUM_USAGE_COUNT', () => {
  it('DEFAULT_MINIMUM_USAGE_COUNT는 1이다', () => {
    expect(DEFAULT_MINIMUM_USAGE_COUNT).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 통합 시나리오 — 실제 12단계 결제 깔때기 흐름
// ---------------------------------------------------------------------------

describe('shouldRequestReview — 통합 시나리오 (12단계 깔때기)', () => {
  it('결제 전 사용자: 결제 미완료 → false', () => {
    const decision = shouldRequestReview({
      paymentCompleted: false,
      hasPreviouslyRequested: false,
      usageCount: 10,
    });
    expect(decision.shouldRequest).toBe(false);
  });

  it('결제 완료 직후 (첫 세션): 모든 조건 충족 → true', () => {
    const decision = shouldRequestReview({
      paymentCompleted: true,
      hasPreviouslyRequested: false,
      usageCount: 1,
      minimumUsageCount: 1,
    });
    expect(decision.shouldRequest).toBe(true);
  });

  it('결제 완료 + 리뷰 이미 요청: 중복 방지 → false', () => {
    const decision = shouldRequestReview({
      paymentCompleted: true,
      hasPreviouslyRequested: true, // 이미 요청함
      usageCount: 5,
      minimumUsageCount: 1,
    });
    expect(decision.shouldRequest).toBe(false);
    expect(decision.noPreviousRequest).toBe(false);
  });

  it('결제 완료 + 사용 횟수 미달: 사용자가 아직 충분히 사용하지 않음 → false', () => {
    const decision = shouldRequestReview({
      paymentCompleted: true,
      hasPreviouslyRequested: false,
      usageCount: 2,
      minimumUsageCount: 5, // 최소 5회 사용 필요
    });
    expect(decision.shouldRequest).toBe(false);
  });

  it('결제 완료 + 충분한 사용 후: 리뷰 요청 적합 → true', () => {
    const decision = shouldRequestReview({
      paymentCompleted: true,
      hasPreviouslyRequested: false,
      usageCount: 7,
      minimumUsageCount: 5,
    });
    expect(decision.shouldRequest).toBe(true);
    expect(decision.usageCount).toBe(7);
    expect(decision.minimumUsageCount).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// ReviewRequestDecision 타입 구조 검증
// ---------------------------------------------------------------------------

describe('ReviewRequestDecision — 출력 구조 완전성', () => {
  it('모든 필드(shouldRequest, paymentCompleted, noPreviousRequest, usageThresholdMet, usageCount, minimumUsageCount)가 존재한다', () => {
    const decision: ReviewRequestDecision = shouldRequestReview(makeValidInput());
    expect(Object.keys(decision)).toEqual(
      expect.arrayContaining([
        'shouldRequest',
        'paymentCompleted',
        'noPreviousRequest',
        'usageThresholdMet',
        'usageCount',
        'minimumUsageCount',
      ]),
    );
  });

  it('모든 필드가 올바른 타입이다', () => {
    const decision = shouldRequestReview(makeValidInput());
    expect(typeof decision.shouldRequest).toBe('boolean');
    expect(typeof decision.paymentCompleted).toBe('boolean');
    expect(typeof decision.noPreviousRequest).toBe('boolean');
    expect(typeof decision.usageThresholdMet).toBe('boolean');
    expect(typeof decision.usageCount).toBe('number');
    expect(typeof decision.minimumUsageCount).toBe('number');
  });
});
