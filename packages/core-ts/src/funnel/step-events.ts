/**
 * 퍼널 스텝 마일스톤 이벤트 — Sub-AC 4b
 *
 * 두 마일스톤 이벤트 발행 함수:
 *   - `trackStepEnter`   — 스텝 진입 시 호출 (`funnel_step_enter`)
 *   - `trackStepAbandon` — 스텝 이탈(포기) 시 호출 (`funnel_step_abandon`)
 *
 * 설계 원칙:
 *   - `publishEvent` (Sub-AC 4a)를 단일 발행 경로로 사용.
 *     → 두 함수는 publishEvent를 직접 호출하며, 생짜 어댑터 dispatch를 건드리지 않음.
 *   - 각 함수는 마일스톤 전용 필드(stepId, previousStep, durationMs)를
 *     조립해 publishEvent에 전달.
 *   - `stepId`는 AnalyticsEventPayload 최상위 필드로 전달 — 어댑터·PostHog 쿼리에서
 *     직접 필터링 가능.
 *   - `previousStep`·`durationMs`는 `properties`에 위치 — 마일스톤마다 필요 여부
 *     다르므로 확장성 있는 맵으로 처리.
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
import type { FunnelStepId } from './types.js';

// ---------------------------------------------------------------------------
// 이벤트 이름 상수
// ---------------------------------------------------------------------------

/** 스텝 진입 마일스톤 이벤트 이름 */
export const FUNNEL_STEP_ENTER_EVENT = 'funnel_step_enter' as const;

/** 스텝 이탈(포기) 마일스톤 이벤트 이름 */
export const FUNNEL_STEP_ABANDON_EVENT = 'funnel_step_abandon' as const;

export type FunnelStepMilestoneEventName =
  | typeof FUNNEL_STEP_ENTER_EVENT
  | typeof FUNNEL_STEP_ABANDON_EVENT;

// ---------------------------------------------------------------------------
// 입력 타입
// ---------------------------------------------------------------------------

/**
 * `trackStepEnter` 입력.
 *
 * - `userId`       — 사용자 식별자 (비어 있으면 publishEvent가 throw)
 * - `stepId`       — 진입한 스텝
 * - `previousStep` — 직전 스텝 (선택 — 첫 번째 스텝 진입 시 undefined)
 * - `durationMs`   — 직전 스텝에서 이 스텝으로 전이하는 데 걸린 시간(ms)
 *                   (선택 — 측정 불가 시 생략)
 */
export interface TrackStepEnterInput {
  readonly userId: string;
  readonly stepId: FunnelStepId;
  readonly previousStep?: FunnelStepId;
  readonly durationMs?: number;
}

/**
 * `trackStepAbandon` 입력.
 *
 * - `userId`       — 사용자 식별자 (비어 있으면 publishEvent가 throw)
 * - `stepId`       — 이탈한 스텝
 * - `durationMs`   — 해당 스텝에 머문 시간(ms) — **필수**
 *                   (이탈 분석의 핵심 지표)
 * - `previousStep` — 직전 스텝 (선택 — 문맥 정보)
 */
export interface TrackStepAbandonInput {
  readonly userId: string;
  readonly stepId: FunnelStepId;
  readonly durationMs: number;
  readonly previousStep?: FunnelStepId;
}

// ---------------------------------------------------------------------------
// trackStepEnter
// ---------------------------------------------------------------------------

/**
 * 스텝 진입 이벤트(`funnel_step_enter`)를 publishEvent를 통해 발행한다.
 *
 * publishEvent에 전달되는 페이로드:
 *   - `eventName`              : `'funnel_step_enter'`
 *   - `userId`                 : 입력 그대로
 *   - `stepId`                 : 진입한 스텝 (최상위 필드)
 *   - `properties.previousStep`: 직전 스텝 (있을 때만 포함)
 *   - `properties.durationMs`  : 전이 시간 (있을 때만 포함)
 *
 * @returns 조립된(frozen) AnalyticsEventPayload — 호출자가 즉시 검사·로깅 가능
 */
export function trackStepEnter(
  adapter: AnalyticsAdapter,
  input: TrackStepEnterInput,
  options: PublishEventOptions = {},
): AnalyticsEventPayload {
  const properties: Record<string, unknown> = {};

  if (input.previousStep !== undefined) {
    properties['previousStep'] = input.previousStep;
  }
  if (input.durationMs !== undefined) {
    properties['durationMs'] = input.durationMs;
  }

  return publishEvent(
    adapter,
    {
      eventName: FUNNEL_STEP_ENTER_EVENT,
      userId: input.userId,
      stepId: input.stepId,
      ...(Object.keys(properties).length > 0 ? { properties } : {}),
    },
    options,
  );
}

// ---------------------------------------------------------------------------
// trackStepAbandon
// ---------------------------------------------------------------------------

/**
 * 스텝 이탈 이벤트(`funnel_step_abandon`)를 publishEvent를 통해 발행한다.
 *
 * publishEvent에 전달되는 페이로드:
 *   - `eventName`              : `'funnel_step_abandon'`
 *   - `userId`                 : 입력 그대로
 *   - `stepId`                 : 이탈한 스텝 (최상위 필드)
 *   - `properties.durationMs`  : 해당 스텝에 머문 시간(ms) — 항상 포함
 *   - `properties.previousStep`: 직전 스텝 (있을 때만 포함)
 *
 * @returns 조립된(frozen) AnalyticsEventPayload — 호출자가 즉시 검사·로깅 가능
 */
export function trackStepAbandon(
  adapter: AnalyticsAdapter,
  input: TrackStepAbandonInput,
  options: PublishEventOptions = {},
): AnalyticsEventPayload {
  const properties: Record<string, unknown> = {
    durationMs: input.durationMs,
  };

  if (input.previousStep !== undefined) {
    properties['previousStep'] = input.previousStep;
  }

  return publishEvent(
    adapter,
    {
      eventName: FUNNEL_STEP_ABANDON_EVENT,
      userId: input.userId,
      stepId: input.stepId,
      properties,
    },
    options,
  );
}
