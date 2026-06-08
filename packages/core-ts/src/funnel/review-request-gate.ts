/**
 * Sub-AC 14b-1 — `shouldRequestReview` 조건 평가 순수 함수.
 *
 * 스토어 리뷰 요청 여부를 결정하는 순수 함수(pure function)입니다.
 * 동일한 입력에 항상 동일한 출력을 반환하며, 부수 효과(side effect)가 없습니다.
 *
 * 평가 조건 (3개 모두 충족 시 true):
 *   1. 결제 완료 여부  — paymentCompleted === true
 *   2. 이전 요청 이력  — hasPreviouslyRequested === false (중복 요청 방지)
 *   3. 최소 사용 횟수  — usageCount >= minimumUsageCount
 *
 * 설계 원칙:
 *   - 순수 함수: 입력만으로 출력이 결정되며, 전역 상태를 참조하거나 변경하지 않음.
 *   - 단일 책임: 세 가지 조건의 AND 논리만 담당. 실제 리뷰 요청 디스패치,
 *     퍼시스턴스(AsyncStorage/MMKV), 네이티브 SDK 호출은 이 함수 밖에서 처리.
 *   - 빠른 실패(fast-fail): 조건을 순서대로 평가하여 첫 불충족 조건에서 false 반환.
 *   - 기본값 주입: minimumUsageCount 미지정 시 DEFAULT_MINIMUM_USAGE_COUNT 사용.
 *   - 입력 검증: 유효하지 않은 입력에 대해 ReviewRequestGateError를 throw.
 *
 * 파이프라인 위치:
 *   결제 완료(payment_completed) 이벤트 수신 후 → 이 함수로 리뷰 요청 여부 판단
 *   → true 시 RatingBridge.requestReview() 호출 (RatingGateService와 별도 경로).
 *
 * @module review-request-gate
 */

// ---------------------------------------------------------------------------
// 기본값 상수
// ---------------------------------------------------------------------------

/**
 * 리뷰 요청을 허용하기 위한 기본 최소 사용 횟수.
 * 결제 후 최소 1회 이상 앱을 실질적으로 사용한 이력이 있어야 요청.
 */
export const DEFAULT_MINIMUM_USAGE_COUNT = 1 as const;

// ---------------------------------------------------------------------------
// 에러 타입
// ---------------------------------------------------------------------------

/** `shouldRequestReview` 입력 검증 실패 이유. */
export type ReviewRequestGateErrorReason =
  | 'invalid_usage_count'
  | 'invalid_minimum_usage_count'
  | 'invalid_payment_completed'
  | 'invalid_has_previously_requested';

/** `shouldRequestReview` 입력이 유효하지 않을 때 throw되는 에러. */
export class ReviewRequestGateError extends Error {
  public override readonly name = 'ReviewRequestGateError';
  public readonly reason: ReviewRequestGateErrorReason;
  public readonly value: unknown;

  constructor(reason: ReviewRequestGateErrorReason, message: string, value: unknown) {
    super(message);
    this.reason = reason;
    this.value = value;
  }
}

// ---------------------------------------------------------------------------
// 입력/출력 타입
// ---------------------------------------------------------------------------

/**
 * `shouldRequestReview` 함수의 입력 인터페이스.
 *
 * 모든 필드는 읽기 전용(readonly)으로 선언되어 호출자의 값 객체가 변경되지 않음.
 */
export interface ShouldRequestReviewInput {
  /**
   * 결제 완료 여부.
   * true = 유효한 구독 결제가 완료된 상태.
   * false = 미결제 또는 무료 체험 사용자.
   */
  readonly paymentCompleted: boolean;

  /**
   * 이전 리뷰 요청 이력 존재 여부.
   * true = 이미 리뷰를 요청한 적이 있음 → 중복 요청 차단.
   * false = 리뷰를 요청한 적 없음 → 요청 가능.
   */
  readonly hasPreviouslyRequested: boolean;

  /**
   * 현재 누적 사용 횟수 (예: 생성 세션 수, 앱 실행 횟수 등).
   * 0 이상의 정수여야 함.
   */
  readonly usageCount: number;

  /**
   * 리뷰 요청을 허용하기 위한 최소 사용 횟수 임계값.
   * 미지정(또는 명시적 undefined) 시 DEFAULT_MINIMUM_USAGE_COUNT(1) 사용.
   * 0 이상의 정수여야 함.
   */
  readonly minimumUsageCount?: number | undefined;
}

/**
 * `shouldRequestReview` 함수의 출력 인터페이스.
 *
 * boolean 단순 반환 대신 상세 결과 객체를 제공하여
 * 호출자가 어떤 조건에서 false가 반환되었는지 파악 가능.
 */
export interface ReviewRequestDecision {
  /**
   * 리뷰 요청 여부. 3개 조건 모두 충족 시 true, 하나라도 불충족 시 false.
   */
  readonly shouldRequest: boolean;

  /** 결제 완료 조건 충족 여부. */
  readonly paymentCompleted: boolean;

  /** 이전 요청 이력 없음 조건 충족 여부 (이력이 없어야 true). */
  readonly noPreviousRequest: boolean;

  /** 최소 사용 횟수 조건 충족 여부. */
  readonly usageThresholdMet: boolean;

  /** 평가에 사용된 실제 usageCount 값. */
  readonly usageCount: number;

  /** 평가에 사용된 실제 minimumUsageCount 값 (기본값 포함). */
  readonly minimumUsageCount: number;
}

// ---------------------------------------------------------------------------
// 입력 검증 헬퍼
// ---------------------------------------------------------------------------

function isNonNegativeInteger(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0
  );
}

function validateInput(input: ShouldRequestReviewInput): void {
  if (typeof input.paymentCompleted !== 'boolean') {
    throw new ReviewRequestGateError(
      'invalid_payment_completed',
      `paymentCompleted must be a boolean (got ${typeof input.paymentCompleted})`,
      input.paymentCompleted,
    );
  }

  if (typeof input.hasPreviouslyRequested !== 'boolean') {
    throw new ReviewRequestGateError(
      'invalid_has_previously_requested',
      `hasPreviouslyRequested must be a boolean (got ${typeof input.hasPreviouslyRequested})`,
      input.hasPreviouslyRequested,
    );
  }

  if (!isNonNegativeInteger(input.usageCount)) {
    throw new ReviewRequestGateError(
      'invalid_usage_count',
      `usageCount must be a non-negative integer (got ${String(input.usageCount)})`,
      input.usageCount,
    );
  }

  if (input.minimumUsageCount !== undefined && !isNonNegativeInteger(input.minimumUsageCount)) {
    throw new ReviewRequestGateError(
      'invalid_minimum_usage_count',
      `minimumUsageCount must be a non-negative integer when provided (got ${String(input.minimumUsageCount)})`,
      input.minimumUsageCount,
    );
  }
}

// ---------------------------------------------------------------------------
// 핵심 순수 함수
// ---------------------------------------------------------------------------

/**
 * 스토어 리뷰 요청 조건을 평가하는 순수 함수.
 *
 * 세 가지 조건을 AND 논리로 평가합니다:
 *   1. 결제 완료 여부 (`paymentCompleted === true`)
 *   2. 이전 요청 이력 없음 (`hasPreviouslyRequested === false`)
 *   3. 최소 사용 횟수 충족 (`usageCount >= minimumUsageCount`)
 *
 * 세 조건이 모두 충족될 때만 `shouldRequest: true`를 반환합니다.
 * 하나라도 불충족되면 `shouldRequest: false`를 반환합니다.
 *
 * @param input - 평가에 필요한 조건 데이터
 * @returns 동결된(frozen) {@link ReviewRequestDecision} 객체
 * @throws {ReviewRequestGateError} 입력이 유효하지 않을 때
 *
 * @example
 * // 모든 조건 충족 → true
 * shouldRequestReview({
 *   paymentCompleted: true,
 *   hasPreviouslyRequested: false,
 *   usageCount: 3,
 *   minimumUsageCount: 1,
 * });
 * // → { shouldRequest: true, paymentCompleted: true, noPreviousRequest: true,
 * //      usageThresholdMet: true, usageCount: 3, minimumUsageCount: 1 }
 *
 * @example
 * // 미결제 → false
 * shouldRequestReview({
 *   paymentCompleted: false,
 *   hasPreviouslyRequested: false,
 *   usageCount: 5,
 * });
 * // → { shouldRequest: false, paymentCompleted: false, ... }
 */
export function shouldRequestReview(
  input: ShouldRequestReviewInput,
): ReviewRequestDecision {
  validateInput(input);

  const resolvedMinimum = input.minimumUsageCount ?? DEFAULT_MINIMUM_USAGE_COUNT;

  const paymentCompleted = input.paymentCompleted;
  const noPreviousRequest = !input.hasPreviouslyRequested;
  const usageThresholdMet = input.usageCount >= resolvedMinimum;

  const shouldRequest = paymentCompleted && noPreviousRequest && usageThresholdMet;

  return Object.freeze({
    shouldRequest,
    paymentCompleted,
    noPreviousRequest,
    usageThresholdMet,
    usageCount: input.usageCount,
    minimumUsageCount: resolvedMinimum,
  }) satisfies ReviewRequestDecision;
}
