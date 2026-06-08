/**
 * 이벤트 퍼블리셔 코어 모듈 — Sub-AC 4a
 *
 * 분석 이벤트를 외부 수신처(analytics adapter)로 디스패치하는 핵심 함수
 * `publishEvent`와 공통 페이로드 스키마를 제공한다.
 *
 * 설계 원칙:
 *   - `AnalyticsAdapter`는 단일 `dispatch` 메서드를 갖는 인터페이스로 정의해
 *     프로덕션(PostHog, Mixpanel 등)과 테스트(vi.fn 레코더) 모두에서
 *     교체 가능하다.
 *   - `publishEvent`는 공통 페이로드(`eventName`, `timestamp`, `userId`,
 *     `stepId` 등)를 자동으로 조립하고 freeze한 뒤 어댑터로 전달한다.
 *   - `now` 클록은 주입 가능 — 테스트에서 타임스탬프를 결정론적으로 고정.
 *   - 이벤트 이름이 비어 있거나 userId가 비어 있으면 즉시 throw.
 *   - 어댑터가 throw하면 `EventPublisherError`로 감싸 재전파 — 이벤트를
 *     조용히 삼키지 않는다.
 *
 * 이 모듈은 프레임워크 무관(React/RN import 없음).
 * 상위 도메인(funnel, trend-drop, payment 추적 등)에서 공통 기반으로 사용한다.
 */

// ---------------------------------------------------------------------------
// 공통 페이로드 스키마
// ---------------------------------------------------------------------------

/**
 * 모든 분석 이벤트가 공통으로 갖는 필드.
 *
 * - `eventName` : 이벤트 이름 (비어 있으면 안 됨)
 * - `timestamp` : Unix epoch, 밀리초
 * - `userId`    : 사용자 식별자 (비어 있으면 안 됨)
 * - `stepId`    : 결제 깔때기·생성 퍼널 단계 ID (선택 — 단계 무관 이벤트는 생략)
 * - `properties`: 이벤트별 추가 메타데이터 (선택, 얕은 복사 후 동결)
 */
export interface AnalyticsEventPayload {
  readonly eventName: string;
  readonly timestamp: number;
  readonly userId: string;
  readonly stepId?: string;
  readonly properties?: Readonly<Record<string, unknown>>;
}

/**
 * `publishEvent`에 전달하는 입력.
 * `timestamp`는 자동 주입(`now` 옵션)이므로 여기서는 생략.
 */
export interface PublishEventInput {
  readonly eventName: string;
  readonly userId: string;
  readonly stepId?: string;
  readonly properties?: Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// 어댑터 계약
// ---------------------------------------------------------------------------

/**
 * 외부 분석 수신처(analytics adapter)의 최소 계약.
 *
 * 프로덕션: PostHog, Mixpanel, BigQuery 스트림 등 어디든 이 인터페이스를
 * 구현하면 된다.
 * 테스트: `vi.fn` 레코더나 인-메모리 배열 기록기로 교체 가능.
 */
export interface AnalyticsAdapter {
  dispatch(payload: AnalyticsEventPayload): void;
}

// ---------------------------------------------------------------------------
// 옵션
// ---------------------------------------------------------------------------

export interface PublishEventOptions {
  /**
   * 주입 가능한 클록 — `Date.now`를 기본값으로 사용.
   * 테스트에서 타임스탬프를 결정론적으로 고정하려면 `() => FIXED_TS`를 전달.
   */
  readonly now?: () => number;
}

// ---------------------------------------------------------------------------
// 에러 타입
// ---------------------------------------------------------------------------

export type EventPublisherErrorReason =
  | 'invalid_event_name'
  | 'invalid_user_id'
  | 'adapter_failure';

export class EventPublisherError extends Error {
  public override readonly name = 'EventPublisherError';
  public readonly reason: EventPublisherErrorReason;
  public override readonly cause?: unknown;

  constructor(reason: EventPublisherErrorReason, message: string, cause?: unknown) {
    super(message);
    this.reason = reason;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

// ---------------------------------------------------------------------------
// 내부 헬퍼
// ---------------------------------------------------------------------------

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function buildPayload(
  input: PublishEventInput,
  timestamp: number,
): AnalyticsEventPayload {
  const payload: {
    eventName: string;
    timestamp: number;
    userId: string;
    stepId?: string;
    properties?: Readonly<Record<string, unknown>>;
  } = {
    eventName: input.eventName,
    timestamp,
    userId: input.userId,
  };

  if (input.stepId !== undefined) {
    payload.stepId = input.stepId;
  }

  if (input.properties !== undefined) {
    // 얕은 복사 후 동결 — 호출자 객체 변조 방지
    payload.properties = Object.freeze({ ...input.properties });
  }

  return Object.freeze(payload) as AnalyticsEventPayload;
}

// ---------------------------------------------------------------------------
// 핵심 퍼블리시 함수
// ---------------------------------------------------------------------------

/**
 * 분석 이벤트를 조립하고 어댑터로 디스패치한다.
 *
 * 1. `eventName`과 `userId`의 비어-있음 여부를 즉시 검증.
 * 2. `now()`로 타임스탬프를 생성하고 공통 페이로드를 조립(freeze).
 * 3. 어댑터의 `dispatch`를 호출.
 * 4. 조립된 페이로드를 반환 — 호출자가 이벤트 내용을 검사·로깅 가능.
 *
 * @throws EventPublisherError('invalid_event_name') — eventName이 비었을 때
 * @throws EventPublisherError('invalid_user_id')    — userId가 비었을 때
 * @throws EventPublisherError('adapter_failure')    — 어댑터가 throw할 때
 */
export function publishEvent(
  adapter: AnalyticsAdapter,
  input: PublishEventInput,
  options: PublishEventOptions = {},
): AnalyticsEventPayload {
  if (!isNonEmptyString(input.eventName)) {
    throw new EventPublisherError(
      'invalid_event_name',
      `eventName must be a non-empty string (got: ${String(input.eventName)})`,
    );
  }

  if (!isNonEmptyString(input.userId)) {
    throw new EventPublisherError(
      'invalid_user_id',
      `userId must be a non-empty string (got: ${String(input.userId)})`,
    );
  }

  const clock = options.now ?? Date.now;
  const payload = buildPayload(input, clock());

  try {
    adapter.dispatch(payload);
  } catch (cause) {
    throw new EventPublisherError(
      'adapter_failure',
      `Analytics adapter failed while dispatching event "${input.eventName}"`,
      cause,
    );
  }

  return payload;
}
