/**
 * Sub-AC 14b-4 — 스킵 경로 처리 (Gated Review Request Orchestrator).
 *
 * 스토어 리뷰 요청 전에 3가지 스킵 조건을 검사하고, 조건에 해당할 경우
 * 네이티브 요청을 호출하지 않고 스킵 플래그를 기록한 결과를 반환합니다.
 *
 * 스킵 조건 (3가지):
 *   1. 이미 요청됨 (already_requested):
 *      hasPreviouslyRequested === true — 이전에 리뷰 요청 이력이 있음.
 *      → requestReview() 호출 없이 skip 플래그 기록.
 *
 *   2. 조건 미충족 (conditions_not_met):
 *      paymentCompleted === false 또는 usageCount < minimumUsageCount.
 *      → requestReview() 호출 없이 skip 플래그 기록.
 *
 *   3. Apple 연간 횟수 초과 (apple_annual_limit):
 *      Apple의 연간 3회 제한 초과 시 isAvailableAsync()가 false를 반환.
 *      requestReview()가 { available: false }를 반환하는 케이스.
 *      → requestReview() 네이티브 다이얼로그는 표시되지 않음. skip 플래그 기록.
 *
 * 파이프라인 위치:
 *   shouldRequestReview(input) → [skip 판단] → (스킵 시 종료)
 *                                             → (진행 시) requestReview()
 *                                               → [available 판단] → (스킵 시 종료)
 *                                                                  → (진행 시 결과 반환)
 *
 * 설계 원칙:
 *   - shouldRequestReview(순수 함수)를 먼저 호출하여 순수 로직으로 스킵 여부 결정.
 *   - 네이티브 호출(requestReview)은 조건 통과 후에만 발생.
 *   - 모든 결과는 Object.freeze 불변 객체로 반환.
 *   - requestReview를 의존성 주입(required)으로 받아 네이티브 모듈 결합 배제.
 *   - 결과 타입은 구조적 인터페이스(structural interface)로 정의 —
 *     StoreReviewOutcome 같은 네이티브 모듈 타입에 직접 의존하지 않음.
 *
 * @module gated-review-request
 */

import { shouldRequestReview } from 'core-ts/funnel';
import type { ReviewRequestDecision, ShouldRequestReviewInput } from 'core-ts/funnel';

// ---------------------------------------------------------------------------
// Outcome shape (structural interface — no native module dependency)
// ---------------------------------------------------------------------------

/**
 * requestReview() 함수가 반환하는 최소 형태.
 * `available` 필드로 Apple 연간 횟수 초과(rate-limit) 여부를 판단.
 * StoreReviewOutcome과 구조적으로 호환 가능.
 */
export interface ReviewableOutcome {
  /** 네이티브 다이얼로그 표시 가능 여부. false이면 apple_annual_limit 스킵. */
  readonly available: boolean;
  /** 네이티브 requestReview() 디스패치 여부. */
  readonly attempted: boolean;
  /** 플랫폼 식별자. */
  readonly platform: string;
}

// ---------------------------------------------------------------------------
// Skip reason enum
// ---------------------------------------------------------------------------

/**
 * 스킵 이유 식별자.
 *
 *   - 'already_requested'  — hasPreviouslyRequested === true (이전 요청 이력 있음)
 *   - 'conditions_not_met' — paymentCompleted=false 또는 usageCount < minimum
 *   - 'apple_annual_limit' — Apple 연간 3회 제한 초과 (isAvailableAsync false)
 */
export type ReviewRequestSkipReason =
  | 'already_requested'
  | 'conditions_not_met'
  | 'apple_annual_limit';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/**
 * 스킵 경로 결과.  `skipped: true`이며 `reason`으로 이유를 식별 가능.
 */
export interface ReviewRequestSkipRecord {
  /** 스킵 여부 판별자. 항상 true. */
  readonly skipped: true;
  /** 스킵 이유. */
  readonly reason: ReviewRequestSkipReason;
  /** 스킵 기록 시각 (ISO-8601). */
  readonly skippedAt: string;
  /**
   * 조건 평가 결과 객체. 어떤 조건이 false였는지 세부 정보를 포함.
   * apple_annual_limit 스킵의 경우 decision.shouldRequest === true
   * (순수 함수 조건은 통과했으나 네이티브 SDK가 rate-limit 반환).
   */
  readonly decision: ReviewRequestDecision;
}

/**
 * 진행 경로 결과.  `skipped: false`이며 네이티브 요청이 완료됨.
 */
export interface ReviewRequestProceedRecord<
  T extends ReviewableOutcome = ReviewableOutcome,
> {
  /** 스킵 여부 판별자. 항상 false. */
  readonly skipped: false;
  /** requestReview() 반환 결과. */
  readonly outcome: T;
  /** 조건 평가 결과 객체 (모든 조건 충족). */
  readonly decision: ReviewRequestDecision;
}

/** 스킵 또는 진행 중 하나를 담는 유니온 결과. */
export type GatedReviewRequestResult<T extends ReviewableOutcome = ReviewableOutcome> =
  | ReviewRequestSkipRecord
  | ReviewRequestProceedRecord<T>;

// ---------------------------------------------------------------------------
// Options / injectable deps
// ---------------------------------------------------------------------------

/**
 * {@link gatedReviewRequest} 의존성 주입 옵션.
 *
 * `requestReview`는 필수 파라미터입니다. 의존성을 명시적으로 주입받아
 * 네이티브 모듈 결합을 배제하고 테스트 용이성을 보장합니다.
 *
 * 전형적인 사용:
 * ```ts
 * import { requestStoreReview } from './request-store-review';
 * const result = await gatedReviewRequest(input, { requestReview: requestStoreReview });
 * ```
 */
export interface GatedReviewRequestOptions<
  T extends ReviewableOutcome = ReviewableOutcome,
> {
  /**
   * 실제 네이티브 리뷰 요청 함수 (필수).
   * 프로덕션: `requestStoreReview` (expo-store-review 래퍼)
   * 테스트: vi.fn()으로 대체
   */
  readonly requestReview: () => Promise<T>;
  /**
   * 스킵 타임스탬프 생성 함수 (선택).
   * 기본값: `() => new Date().toISOString()`
   * 테스트: `() => '2026-01-01T00:00:00.000Z'` 등 고정값
   */
  readonly now?: () => string;
}

// ---------------------------------------------------------------------------
// 핵심 함수
// ---------------------------------------------------------------------------

function defaultNow(): string {
  return new Date().toISOString();
}

/**
 * 스킵 조건 3가지를 순서대로 검사하고, 해당 시 스킵 플래그를 기록한 결과를 반환합니다.
 * 스킵 조건을 모두 통과한 경우에만 네이티브 리뷰 요청을 실행합니다.
 *
 * 스킵 우선순위 (순서대로):
 *   1. 이미 요청됨 (hasPreviouslyRequested === true) → 즉시 스킵, 네이티브 호출 없음
 *   2. 조건 미충족 (paymentCompleted=false 또는 사용 횟수 미달) → 즉시 스킵, 네이티브 호출 없음
 *   3. Apple 연간 횟수 초과 (requestReview() 호출 후 available=false) → 스킵 기록
 *
 * @param input - shouldRequestReview에 전달할 조건 데이터
 * @param options - 의존성 주입 옵션 (requestReview 필수, now 선택)
 * @returns 동결된(frozen) {@link GatedReviewRequestResult}
 * @throws {ReviewRequestGateError} 입력이 유효하지 않을 때 (shouldRequestReview에서 throw)
 */
export async function gatedReviewRequest<
  T extends ReviewableOutcome = ReviewableOutcome,
>(
  input: ShouldRequestReviewInput,
  options: GatedReviewRequestOptions<T>,
): Promise<GatedReviewRequestResult<T>> {
  const now = options.now ?? defaultNow;
  const { requestReview } = options;

  // ---------- 단계 1: 순수 함수로 조건 평가 ----------
  const decision = shouldRequestReview(input);

  if (!decision.shouldRequest) {
    // 스킵 이유 분류:
    //   noPreviousRequest === false → 이미 요청됨
    //   그 외 → 결제 미완료 또는 사용 횟수 미달 (조건 미충족)
    const reason: ReviewRequestSkipReason = !decision.noPreviousRequest
      ? 'already_requested'
      : 'conditions_not_met';

    return Object.freeze({
      skipped: true,
      reason,
      skippedAt: now(),
      decision,
    });
  }

  // ---------- 단계 2: 네이티브 리뷰 요청 ----------
  const outcome = await requestReview();

  // Apple 연간 횟수 초과 또는 디바이스 미지원: available=false
  if (!outcome.available) {
    return Object.freeze({
      skipped: true,
      reason: 'apple_annual_limit',
      skippedAt: now(),
      decision,
    });
  }

  // ---------- 단계 3: 진행 결과 반환 ----------
  return Object.freeze({
    skipped: false,
    outcome,
    decision,
  });
}
