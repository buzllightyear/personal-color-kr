/**
 * 단위 테스트 — 이벤트 퍼블리셔 코어 모듈 (Sub-AC 4a)
 *
 * 검증 항목:
 *   1. publishEvent가 올바른 구조의 페이로드를 어댑터에 전달하는지 확인.
 *   2. 공통 페이로드 필드(eventName, timestamp, userId, stepId, properties)가
 *      모두 올바르게 조립되는지 확인.
 *   3. now 주입으로 타임스탬프가 결정론적으로 제어되는지 확인.
 *   4. 페이로드가 freeze되어 외부 변조가 불가능한지 확인.
 *   5. 잘못된 eventName / userId 입력 시 EventPublisherError를 던지는지 확인.
 *   6. 어댑터 내부 오류가 EventPublisherError('adapter_failure')로 전파되는지
 *      확인.
 *   7. stepId·properties 선택 필드의 존재/부재가 올바르게 처리되는지 확인.
 *   8. publishEvent가 조립한 페이로드를 반환하는지 확인(호출자 활용 가능).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  EventPublisherError,
  publishEvent,
  type AnalyticsAdapter,
  type AnalyticsEventPayload,
} from '../../src/analytics/event-publisher.js';

// ---------------------------------------------------------------------------
// 테스트 헬퍼
// ---------------------------------------------------------------------------

const FIXED_NOW = 1_715_000_000_000; // 2024-05-06T11:33:20Z — 결정론적 고정값
const USER_ID = 'user_test_42';

/** 수신된 페이로드를 배열에 기록하는 인-메모리 어댑터 */
function makeRecordingAdapter(): AnalyticsAdapter & {
  readonly received: readonly AnalyticsEventPayload[];
} {
  const received: AnalyticsEventPayload[] = [];
  return {
    dispatch(payload: AnalyticsEventPayload) {
      received.push(payload);
    },
    get received(): readonly AnalyticsEventPayload[] {
      return received;
    },
  };
}

/** 기본 옵션으로 publishEvent를 호출하는 헬퍼 */
function publish(
  adapter: AnalyticsAdapter,
  overrides: Partial<Parameters<typeof publishEvent>[1]> = {},
): AnalyticsEventPayload {
  return publishEvent(
    adapter,
    { eventName: 'test_event', userId: USER_ID, ...overrides },
    { now: () => FIXED_NOW },
  );
}

// ---------------------------------------------------------------------------
// 1. 기본 페이로드 구조 검증
// ---------------------------------------------------------------------------

describe('publishEvent — 기본 페이로드 조립', () => {
  it('올바른 공통 필드를 갖는 페이로드를 어댑터에 전달한다', () => {
    const adapter = makeRecordingAdapter();
    publish(adapter);

    expect(adapter.received).toHaveLength(1);
    const payload = adapter.received[0] as AnalyticsEventPayload;
    expect(payload).toMatchObject({
      eventName: 'test_event',
      timestamp: FIXED_NOW,
      userId: USER_ID,
    });
  });

  it('stepId를 포함한 경우 페이로드에 stepId가 존재한다', () => {
    const adapter = makeRecordingAdapter();
    publish(adapter, { stepId: 'payment_model' });

    const payload = adapter.received[0] as AnalyticsEventPayload;
    expect(payload.stepId).toBe('payment_model');
  });

  it('stepId를 생략한 경우 페이로드에 stepId 키가 없다', () => {
    const adapter = makeRecordingAdapter();
    publish(adapter);

    const payload = adapter.received[0] as AnalyticsEventPayload;
    expect(payload).not.toHaveProperty('stepId');
  });

  it('properties를 포함한 경우 페이로드에 올바르게 병합된다', () => {
    const adapter = makeRecordingAdapter();
    publish(adapter, {
      properties: { trend_id: 'tr_2024_spring', source: 'trend_drop' },
    });

    const payload = adapter.received[0] as AnalyticsEventPayload;
    expect(payload.properties).toEqual({
      trend_id: 'tr_2024_spring',
      source: 'trend_drop',
    });
  });

  it('properties를 생략한 경우 페이로드에 properties 키가 없다', () => {
    const adapter = makeRecordingAdapter();
    publish(adapter);

    const payload = adapter.received[0] as AnalyticsEventPayload;
    expect(payload).not.toHaveProperty('properties');
  });
});

// ---------------------------------------------------------------------------
// 2. 전체 페이로드 구조 — 완전한 필드 집합
// ---------------------------------------------------------------------------

describe('publishEvent — 전체 페이로드 정합성', () => {
  it('stepId와 properties가 모두 있을 때 완전한 페이로드를 조립한다', () => {
    const adapter = makeRecordingAdapter();
    const payload = publishEvent(
      adapter,
      {
        eventName: 'funnel_step_view',
        userId: 'user_kr_001',
        stepId: 'referral_gate',
        properties: { variant: 'kr_variant', referral_count: 0 },
      },
      { now: () => FIXED_NOW },
    );

    const expected: AnalyticsEventPayload = {
      eventName: 'funnel_step_view',
      timestamp: FIXED_NOW,
      userId: 'user_kr_001',
      stepId: 'referral_gate',
      properties: { variant: 'kr_variant', referral_count: 0 },
    };
    expect(payload).toEqual(expected);
    expect(adapter.received[0]).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// 3. 반환값 — 조립된 페이로드
// ---------------------------------------------------------------------------

describe('publishEvent — 반환값', () => {
  it('publishEvent가 어댑터에 전달한 페이로드와 동일한 객체를 반환한다', () => {
    const adapter = makeRecordingAdapter();
    const returned = publish(adapter);

    expect(returned).toBe(adapter.received[0]);
  });

  it('반환된 페이로드로 호출자가 이벤트 내용을 즉시 검사할 수 있다', () => {
    const adapter = makeRecordingAdapter();
    const result = publishEvent(
      adapter,
      {
        eventName: 'trend_drop_push',
        userId: 'user_kr_002',
        stepId: 'welcome_hook',
        properties: { trend_id: 'tr_2024_summer' },
      },
      { now: () => FIXED_NOW },
    );

    expect(result.eventName).toBe('trend_drop_push');
    expect(result.userId).toBe('user_kr_002');
    expect(result.stepId).toBe('welcome_hook');
    expect(result.timestamp).toBe(FIXED_NOW);
  });
});

// ---------------------------------------------------------------------------
// 4. 타임스탬프 주입
// ---------------------------------------------------------------------------

describe('publishEvent — 타임스탬프 주입', () => {
  it('now 옵션의 반환값이 타임스탬프로 사용된다', () => {
    const adapter = makeRecordingAdapter();
    const customTs = 1_700_000_000_000;
    publishEvent(adapter, { eventName: 'ev', userId: USER_ID }, { now: () => customTs });

    expect((adapter.received[0] as AnalyticsEventPayload).timestamp).toBe(customTs);
  });

  it('연속 호출 시 each now() 호출 결과가 각 페이로드의 타임스탬프로 기록된다', () => {
    const adapter = makeRecordingAdapter();
    let t = 2000;
    const clockFn = () => t++;

    publishEvent(adapter, { eventName: 'ev_1', userId: USER_ID }, { now: clockFn });
    publishEvent(adapter, { eventName: 'ev_2', userId: USER_ID }, { now: clockFn });
    publishEvent(adapter, { eventName: 'ev_3', userId: USER_ID }, { now: clockFn });

    expect(adapter.received.map((p) => p.timestamp)).toEqual([2000, 2001, 2002]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('now를 생략하면 Date.now()를 기본값으로 사용한다', () => {
    vi.useFakeTimers();
    const FAKE = new Date('2026-06-08T09:00:00Z').getTime();
    vi.setSystemTime(FAKE);

    const adapter = makeRecordingAdapter();
    publishEvent(adapter, { eventName: 'ev', userId: USER_ID });

    expect((adapter.received[0] as AnalyticsEventPayload).timestamp).toBe(FAKE);
  });
});

// ---------------------------------------------------------------------------
// 5. 페이로드 불변성(freeze)
// ---------------------------------------------------------------------------

describe('publishEvent — 페이로드 불변성', () => {
  it('반환된 페이로드는 freeze된 객체다', () => {
    const adapter = makeRecordingAdapter();
    const payload = publish(adapter);
    expect(Object.isFrozen(payload)).toBe(true);
  });

  it('어댑터에 전달된 페이로드도 freeze되어 있다', () => {
    const adapter = makeRecordingAdapter();
    publish(adapter);
    expect(Object.isFrozen(adapter.received[0])).toBe(true);
  });

  it('properties 내부도 freeze되어 외부 변조가 불가능하다', () => {
    const adapter = makeRecordingAdapter();
    const payload = publish(adapter, { properties: { key: 'value' } });
    expect(Object.isFrozen(payload.properties)).toBe(true);
  });

  it('입력 properties 객체를 변조해도 페이로드에 영향을 주지 않는다', () => {
    const adapter = makeRecordingAdapter();
    const originalProps: Record<string, unknown> = { key: 'original' };
    const payload = publish(adapter, { properties: originalProps });

    // 입력 객체를 직접 변조
    originalProps['key'] = 'mutated';

    // 페이로드는 복사본이므로 변조 전 값 유지
    expect((payload.properties as Record<string, unknown>)['key']).toBe('original');
  });
});

// ---------------------------------------------------------------------------
// 6. 입력 검증 — EventPublisherError
// ---------------------------------------------------------------------------

describe('publishEvent — 잘못된 eventName', () => {
  it('빈 문자열 eventName에 대해 invalid_event_name 에러를 던진다', () => {
    const adapter = makeRecordingAdapter();
    expect(() => publish(adapter, { eventName: '' })).toThrow(EventPublisherError);
    expect(() => publish(adapter, { eventName: '' })).toThrow(/invalid_event_name|non-empty/i);
  });

  it('공백만 있는 eventName에 대해 에러를 던진다', () => {
    const adapter = makeRecordingAdapter();
    expect(() => publish(adapter, { eventName: '   ' })).toThrow(EventPublisherError);
  });

  it('잘못된 eventName 시 어댑터에 이벤트가 전달되지 않는다', () => {
    const adapter = makeRecordingAdapter();
    try {
      publish(adapter, { eventName: '' });
    } catch {
      // 에러는 예상된 것
    }
    expect(adapter.received).toHaveLength(0);
  });

  it('EventPublisherError의 reason이 invalid_event_name이다', () => {
    const adapter = makeRecordingAdapter();
    let caught: unknown;
    try {
      publish(adapter, { eventName: '' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(EventPublisherError);
    expect((caught as EventPublisherError).reason).toBe('invalid_event_name');
  });
});

describe('publishEvent — 잘못된 userId', () => {
  it('빈 문자열 userId에 대해 invalid_user_id 에러를 던진다', () => {
    const adapter = makeRecordingAdapter();
    expect(() => publish(adapter, { userId: '' })).toThrow(EventPublisherError);
  });

  it('공백만 있는 userId에 대해 에러를 던진다', () => {
    const adapter = makeRecordingAdapter();
    expect(() => publish(adapter, { userId: '  ' })).toThrow(EventPublisherError);
  });

  it('EventPublisherError의 reason이 invalid_user_id이다', () => {
    const adapter = makeRecordingAdapter();
    let caught: unknown;
    try {
      publish(adapter, { userId: '' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(EventPublisherError);
    expect((caught as EventPublisherError).reason).toBe('invalid_user_id');
  });

  it('잘못된 userId 시 어댑터에 이벤트가 전달되지 않는다', () => {
    const adapter = makeRecordingAdapter();
    try {
      publish(adapter, { userId: '' });
    } catch {
      // 에러는 예상된 것
    }
    expect(adapter.received).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 7. 어댑터 오류 전파
// ---------------------------------------------------------------------------

describe('publishEvent — 어댑터 실패 전파', () => {
  it('어댑터 dispatch가 throw하면 adapter_failure 에러로 감싸 재전파한다', () => {
    const failingAdapter: AnalyticsAdapter = {
      dispatch() {
        throw new Error('network timeout');
      },
    };

    expect(() => publish(failingAdapter)).toThrow(EventPublisherError);

    let caught: unknown;
    try {
      publish(failingAdapter);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(EventPublisherError);
    expect((caught as EventPublisherError).reason).toBe('adapter_failure');
  });

  it('원인 에러가 EventPublisherError.cause에 포함된다', () => {
    const originalError = new Error('upstream failure');
    const failingAdapter: AnalyticsAdapter = {
      dispatch() {
        throw originalError;
      },
    };

    let caught: unknown;
    try {
      publish(failingAdapter);
    } catch (e) {
      caught = e;
    }
    expect((caught as EventPublisherError).cause).toBe(originalError);
  });

  it('adapter_failure 에러 메시지에 이벤트 이름이 포함된다', () => {
    const failingAdapter: AnalyticsAdapter = {
      dispatch() {
        throw new Error('fail');
      },
    };

    let caught: unknown;
    try {
      publishEvent(
        failingAdapter,
        { eventName: 'critical_event', userId: USER_ID },
        { now: () => FIXED_NOW },
      );
    } catch (e) {
      caught = e;
    }
    expect((caught as EventPublisherError).message).toMatch(/critical_event/);
  });
});

// ---------------------------------------------------------------------------
// 8. 다중 이벤트 순서 보장
// ---------------------------------------------------------------------------

describe('publishEvent — 다중 이벤트 순서', () => {
  it('연속 publish 호출 시 어댑터는 호출 순서대로 이벤트를 수신한다', () => {
    const adapter = makeRecordingAdapter();

    publishEvent(
      adapter,
      { eventName: 'event_a', userId: USER_ID },
      { now: () => FIXED_NOW },
    );
    publishEvent(
      adapter,
      { eventName: 'event_b', userId: USER_ID },
      { now: () => FIXED_NOW },
    );
    publishEvent(
      adapter,
      { eventName: 'event_c', userId: USER_ID },
      { now: () => FIXED_NOW },
    );

    expect(adapter.received).toHaveLength(3);
    expect(adapter.received.map((p) => p.eventName)).toEqual([
      'event_a',
      'event_b',
      'event_c',
    ]);
  });
});

// ---------------------------------------------------------------------------
// 9. EventPublisherError 클래스 계약
// ---------------------------------------------------------------------------

describe('EventPublisherError — 에러 클래스 계약', () => {
  it('name이 "EventPublisherError"이다', () => {
    const err = new EventPublisherError('adapter_failure', 'test');
    expect(err.name).toBe('EventPublisherError');
  });

  it('Error를 상속한다', () => {
    const err = new EventPublisherError('adapter_failure', 'test');
    expect(err).toBeInstanceOf(Error);
  });

  it('reason이 생성자에 전달한 값과 같다', () => {
    const err = new EventPublisherError('invalid_event_name', 'bad name');
    expect(err.reason).toBe('invalid_event_name');
  });

  it('cause가 없는 경우 undefined이다', () => {
    const err = new EventPublisherError('adapter_failure', 'test');
    expect(err.cause).toBeUndefined();
  });

  it('cause를 전달하면 cause 속성에서 접근 가능하다', () => {
    const original = new Error('root');
    const err = new EventPublisherError('adapter_failure', 'wrapped', original);
    expect(err.cause).toBe(original);
  });
});
