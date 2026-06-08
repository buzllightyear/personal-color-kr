/**
 * 결제 마일스톤 이벤트 함수 — Sub-AC 4c
 *
 * 두 마일스톤 이벤트 발행 함수:
 *   - `trackPaymentAttempt`  — 결제 시도 시 호출 (`payment_attempt`)
 *   - `trackPaymentComplete` — 결제 완료 시 호출 (`payment_complete`)
 *
 * 설계 원칙:
 *   - `publishEvent` (Sub-AC 4a)를 단일 발행 경로로 사용.
 *     → 두 함수는 publishEvent를 직접 호출하며, 생짜 어댑터 dispatch를 건드리지 않음.
 *   - 결제 전용 필드(planId·amount·currency·transactionId)를 `properties`에
 *     조립해 publishEvent에 전달.
 *   - `planId`는 `stepId`가 아닌 `properties`에 배치 — 결제 전용 필드이므로
 *     최상위 stepId(퍼널 단계 ID)와 혼용하지 않음.
 *   - `transactionId`는 완료 이벤트에서만 필수. 시도 이벤트에서는 선택.
 *   - AnalyticsAdapter는 주입 — vi.fn 레코더나 인-메모리 배열로 교체 가능.
 *   - `now` 클록은 PublishEventOptions로 주입 — 테스트에서 타임스탬프 결정론적 제어.
 *
 * 이 모듈은 프레임워크 무관(React/RN import 없음).
 */

import {
  publishEvent,
  type AnalyticsAdapter,
  type AnalyticsEventPayload,
  type PublishEventOptions,
} from '../analytics/event-publisher.js';
import type { PaymentPlanId } from './checkout.js';

// ---------------------------------------------------------------------------
// 이벤트 이름 상수
// ---------------------------------------------------------------------------

/** 결제 시도 마일스톤 이벤트 이름 */
export const PAYMENT_ATTEMPT_EVENT = 'payment_attempt' as const;

/** 결제 완료 마일스톤 이벤트 이름 */
export const PAYMENT_COMPLETE_EVENT = 'payment_complete' as const;

export type PaymentMilestoneEventName =
  | typeof PAYMENT_ATTEMPT_EVENT
  | typeof PAYMENT_COMPLETE_EVENT;

// ---------------------------------------------------------------------------
// 입력 타입
// ---------------------------------------------------------------------------

/**
 * `trackPaymentAttempt` 입력.
 *
 * - `userId`        — 사용자 식별자 (비어 있으면 publishEvent가 throw)
 * - `planId`        — 결제 플랜 ID ('monthly' | 'annual')
 * - `amount`        — 결제 금액 (숫자)
 * - `currency`      — 통화 코드 (예: 'USD', 'KRW')
 * - `transactionId` — 결제 시도 거래 ID (선택 — 제공업체가 시도 단계에서 ID를 발급하는 경우)
 */
export interface TrackPaymentAttemptInput {
  readonly userId: string;
  readonly planId: PaymentPlanId;
  readonly amount: number;
  readonly currency: string;
  readonly transactionId?: string;
}

/**
 * `trackPaymentComplete` 입력.
 *
 * - `userId`        — 사용자 식별자 (비어 있으면 publishEvent가 throw)
 * - `planId`        — 결제 플랜 ID ('monthly' | 'annual')
 * - `amount`        — 실제 결제 금액 (숫자)
 * - `currency`      — 통화 코드 (예: 'USD', 'KRW')
 * - `transactionId` — 결제 완료 거래 ID — **필수** (north star 지표 추적의 핵심 키)
 */
export interface TrackPaymentCompleteInput {
  readonly userId: string;
  readonly planId: PaymentPlanId;
  readonly amount: number;
  readonly currency: string;
  readonly transactionId: string;
}

// ---------------------------------------------------------------------------
// trackPaymentAttempt
// ---------------------------------------------------------------------------

/**
 * 결제 시도 이벤트(`payment_attempt`)를 publishEvent를 통해 발행한다.
 *
 * publishEvent에 전달되는 페이로드:
 *   - `eventName`              : `'payment_attempt'`
 *   - `userId`                 : 입력 그대로
 *   - `stepId`                 : `'payment_model'` (결제 단계 고정)
 *   - `properties.planId`      : 결제 플랜 ID
 *   - `properties.amount`      : 결제 금액
 *   - `properties.currency`    : 통화 코드
 *   - `properties.transactionId`: 거래 ID (있을 때만 포함)
 *
 * @returns 조립된(frozen) AnalyticsEventPayload — 호출자가 즉시 검사·로깅 가능
 */
export function trackPaymentAttempt(
  adapter: AnalyticsAdapter,
  input: TrackPaymentAttemptInput,
  options: PublishEventOptions = {},
): AnalyticsEventPayload {
  const properties: Record<string, unknown> = {
    planId: input.planId,
    amount: input.amount,
    currency: input.currency,
  };

  if (input.transactionId !== undefined) {
    properties['transactionId'] = input.transactionId;
  }

  return publishEvent(
    adapter,
    {
      eventName: PAYMENT_ATTEMPT_EVENT,
      userId: input.userId,
      stepId: 'payment_model',
      properties,
    },
    options,
  );
}

// ---------------------------------------------------------------------------
// trackPaymentComplete
// ---------------------------------------------------------------------------

/**
 * 결제 완료 이벤트(`payment_complete`)를 publishEvent를 통해 발행한다.
 *
 * publishEvent에 전달되는 페이로드:
 *   - `eventName`              : `'payment_complete'`
 *   - `userId`                 : 입력 그대로
 *   - `stepId`                 : `'payment_model'` (결제 단계 고정)
 *   - `properties.planId`      : 결제 플랜 ID
 *   - `properties.amount`      : 실제 결제 금액
 *   - `properties.currency`    : 통화 코드
 *   - `properties.transactionId`: 결제 완료 거래 ID — **항상 포함**
 *
 * @returns 조립된(frozen) AnalyticsEventPayload — 호출자가 즉시 검사·로깅 가능
 */
export function trackPaymentComplete(
  adapter: AnalyticsAdapter,
  input: TrackPaymentCompleteInput,
  options: PublishEventOptions = {},
): AnalyticsEventPayload {
  return publishEvent(
    adapter,
    {
      eventName: PAYMENT_COMPLETE_EVENT,
      userId: input.userId,
      stepId: 'payment_model',
      properties: {
        planId: input.planId,
        amount: input.amount,
        currency: input.currency,
        transactionId: input.transactionId,
      },
    },
    options,
  );
}
