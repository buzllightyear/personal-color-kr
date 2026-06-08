/**
 * 단위 테스트 — 퍼널 스텝 마일스톤 이벤트 함수 (Sub-AC 4b)
 *
 * 검증 항목:
 *   1. trackStepEnter — publishEvent 호출 시 올바른 페이로드 전달
 *      - eventName: 'funnel_step_enter'
 *      - stepId (최상위 필드)
 *      - userId
 *      - properties.previousStep (있을 때만 포함)
 *      - properties.durationMs (있을 때만 포함)
 *   2. trackStepAbandon — publishEvent 호출 시 올바른 페이로드 전달
 *      - eventName: 'funnel_step_abandon'
 *      - stepId (최상위 필드)
 *      - userId
 *      - properties.durationMs (필수)
 *      - properties.previousStep (있을 때만 포함)
 *   3. 두 함수 모두 now 주입 가능 (타임스탬프 결정론적 제어)
 *   4. 두 함수 모두 frozen 페이로드 반환
 *   5. 어댑터에 페이로드가 정확히 1회 전달됨
 *   6. 이벤트 이름 상수(FUNNEL_STEP_ENTER_EVENT, FUNNEL_STEP_ABANDON_EVENT) 계약
 *   7. enter vs abandon 이벤트 이름 구분
 */
import { describe, expect, it } from 'vitest';

import {
  FUNNEL_STEP_ABANDON_EVENT,
  FUNNEL_STEP_ENTER_EVENT,
  trackStepAbandon,
  trackStepEnter,
  type TrackStepAbandonInput,
  type TrackStepEnterInput,
} from '../../src/funnel/step-events.js';
import {
  type AnalyticsAdapter,
  type AnalyticsEventPayload,
} from '../../src/analytics/event-publisher.js';

// ---------------------------------------------------------------------------
// 테스트 헬퍼
// ---------------------------------------------------------------------------

const FIXED_NOW = 1_715_000_000_000; // 2024-05-06T11:33:20Z — 결정론적 고정값
const USER_ID = 'user_kr_step_test_01';

/**
 * 수신된 페이로드를 배열에 기록하는 인-메모리 어댑터.
 * publishEvent가 실제로 어댑터의 dispatch를 호출하므로,
 * 어댑터가 수신한 페이로드 = publishEvent에 전달된 최종 페이로드.
 */
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

// ---------------------------------------------------------------------------
// 1. 이벤트 이름 상수 계약
// ---------------------------------------------------------------------------

describe('이벤트 이름 상수 계약', () => {
  it('FUNNEL_STEP_ENTER_EVENT 상수가 "funnel_step_enter"이다', () => {
    expect(FUNNEL_STEP_ENTER_EVENT).toBe('funnel_step_enter');
  });

  it('FUNNEL_STEP_ABANDON_EVENT 상수가 "funnel_step_abandon"이다', () => {
    expect(FUNNEL_STEP_ABANDON_EVENT).toBe('funnel_step_abandon');
  });

  it('두 이벤트 이름이 서로 다르다 (이름 충돌 없음)', () => {
    expect(FUNNEL_STEP_ENTER_EVENT).not.toBe(FUNNEL_STEP_ABANDON_EVENT);
  });
});

// ---------------------------------------------------------------------------
// 2. trackStepEnter — 이벤트 이름
// ---------------------------------------------------------------------------

describe('trackStepEnter — eventName', () => {
  it('publishEvent에 eventName="funnel_step_enter"를 전달한다', () => {
    const adapter = makeRecordingAdapter();
    trackStepEnter(
      adapter,
      { userId: USER_ID, stepId: 'welcome_hook' },
      { now: () => FIXED_NOW },
    );

    expect(adapter.received).toHaveLength(1);
    expect(adapter.received[0]?.eventName).toBe(FUNNEL_STEP_ENTER_EVENT);
    expect(adapter.received[0]?.eventName).toBe('funnel_step_enter');
  });
});

// ---------------------------------------------------------------------------
// 3. trackStepEnter — stepId 전달
// ---------------------------------------------------------------------------

describe('trackStepEnter — stepId', () => {
  it('입력 stepId가 페이로드의 stepId 필드로 전달된다', () => {
    const adapter = makeRecordingAdapter();
    trackStepEnter(
      adapter,
      { userId: USER_ID, stepId: 'value_props' },
      { now: () => FIXED_NOW },
    );

    expect(adapter.received[0]?.stepId).toBe('value_props');
  });

  it('Korean-variant stepId(referral_gate)도 올바르게 전달된다', () => {
    const adapter = makeRecordingAdapter();
    trackStepEnter(
      adapter,
      { userId: USER_ID, stepId: 'referral_gate' },
      { now: () => FIXED_NOW },
    );
    expect(adapter.received[0]?.stepId).toBe('referral_gate');
  });

  it('payment_model stepId가 올바르게 전달된다', () => {
    const adapter = makeRecordingAdapter();
    trackStepEnter(
      adapter,
      { userId: USER_ID, stepId: 'payment_model' },
      { now: () => FIXED_NOW },
    );
    expect(adapter.received[0]?.stepId).toBe('payment_model');
  });
});

// ---------------------------------------------------------------------------
// 4. trackStepEnter — previousStep 필드
// ---------------------------------------------------------------------------

describe('trackStepEnter — previousStep', () => {
  it('previousStep이 있으면 properties.previousStep에 포함된다', () => {
    const adapter = makeRecordingAdapter();
    trackStepEnter(
      adapter,
      { userId: USER_ID, stepId: 'value_props', previousStep: 'welcome_hook' },
      { now: () => FIXED_NOW },
    );

    const props = adapter.received[0]?.properties as
      | Record<string, unknown>
      | undefined;
    expect(props?.['previousStep']).toBe('welcome_hook');
  });

  it('previousStep이 없으면 properties에 previousStep 키가 없다', () => {
    const adapter = makeRecordingAdapter();
    trackStepEnter(
      adapter,
      { userId: USER_ID, stepId: 'welcome_hook' },
      { now: () => FIXED_NOW },
    );

    const props = adapter.received[0]?.properties as
      | Record<string, unknown>
      | undefined;
    expect(props?.['previousStep']).toBeUndefined();
  });

  it('Korean-variant 스텝 간 전이 시 previousStep이 올바르게 전달된다', () => {
    const adapter = makeRecordingAdapter();
    trackStepEnter(
      adapter,
      {
        userId: USER_ID,
        stepId: 'social_evolution',
        previousStep: 'referral_gate',
      },
      { now: () => FIXED_NOW },
    );

    const props = adapter.received[0]?.properties as
      | Record<string, unknown>
      | undefined;
    expect(props?.['previousStep']).toBe('referral_gate');
  });
});

// ---------------------------------------------------------------------------
// 5. trackStepEnter — durationMs 필드
// ---------------------------------------------------------------------------

describe('trackStepEnter — durationMs', () => {
  it('durationMs가 있으면 properties.durationMs에 포함된다', () => {
    const adapter = makeRecordingAdapter();
    trackStepEnter(
      adapter,
      {
        userId: USER_ID,
        stepId: 'value_props',
        previousStep: 'welcome_hook',
        durationMs: 3500,
      },
      { now: () => FIXED_NOW },
    );

    const props = adapter.received[0]?.properties as
      | Record<string, unknown>
      | undefined;
    expect(props?.['durationMs']).toBe(3500);
  });

  it('durationMs가 없으면 properties에 durationMs 키가 없다', () => {
    const adapter = makeRecordingAdapter();
    trackStepEnter(
      adapter,
      { userId: USER_ID, stepId: 'welcome_hook' },
      { now: () => FIXED_NOW },
    );

    const props = adapter.received[0]?.properties as
      | Record<string, unknown>
      | undefined;
    expect(props?.['durationMs']).toBeUndefined();
  });

  it('durationMs=0은 그대로 전달된다', () => {
    const adapter = makeRecordingAdapter();
    trackStepEnter(
      adapter,
      {
        userId: USER_ID,
        stepId: 'value_props',
        previousStep: 'welcome_hook',
        durationMs: 0,
      },
      { now: () => FIXED_NOW },
    );

    const props = adapter.received[0]?.properties as
      | Record<string, unknown>
      | undefined;
    expect(props?.['durationMs']).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 6. trackStepEnter — 완전한 페이로드 정합성
// ---------------------------------------------------------------------------

describe('trackStepEnter — 완전한 페이로드', () => {
  it('stepId·previousStep·durationMs를 모두 포함한 완전한 페이로드를 publishEvent로 전달한다', () => {
    const adapter = makeRecordingAdapter();
    const input: TrackStepEnterInput = {
      userId: USER_ID,
      stepId: 'result_reveal',
      previousStep: 'fake_scan_animation',
      durationMs: 12000,
    };
    const payload = trackStepEnter(adapter, input, { now: () => FIXED_NOW });

    expect(payload.eventName).toBe('funnel_step_enter');
    expect(payload.userId).toBe(USER_ID);
    expect(payload.stepId).toBe('result_reveal');
    expect(payload.timestamp).toBe(FIXED_NOW);
    const props = payload.properties as Record<string, unknown>;
    expect(props['previousStep']).toBe('fake_scan_animation');
    expect(props['durationMs']).toBe(12000);
  });

  it('어댑터에 전달된 페이로드와 반환값이 동일한 객체다', () => {
    const adapter = makeRecordingAdapter();
    const returned = trackStepEnter(
      adapter,
      { userId: USER_ID, stepId: 'welcome_hook' },
      { now: () => FIXED_NOW },
    );
    expect(returned).toBe(adapter.received[0]);
  });

  it('어댑터에 이벤트가 정확히 1회 전달된다', () => {
    const adapter = makeRecordingAdapter();
    trackStepEnter(
      adapter,
      { userId: USER_ID, stepId: 'welcome_hook' },
      { now: () => FIXED_NOW },
    );
    expect(adapter.received).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 7. trackStepEnter — userId 전달
// ---------------------------------------------------------------------------

describe('trackStepEnter — userId', () => {
  it('입력 userId가 페이로드에 그대로 전달된다', () => {
    const adapter = makeRecordingAdapter();
    trackStepEnter(
      adapter,
      { userId: 'user_specific_777', stepId: 'welcome_hook' },
      { now: () => FIXED_NOW },
    );
    expect(adapter.received[0]?.userId).toBe('user_specific_777');
  });
});

// ---------------------------------------------------------------------------
// 8. trackStepEnter — 타임스탬프 주입
// ---------------------------------------------------------------------------

describe('trackStepEnter — 타임스탬프', () => {
  it('now 옵션의 반환값이 타임스탬프로 사용된다', () => {
    const adapter = makeRecordingAdapter();
    const customTs = 9_999_999_999;
    trackStepEnter(
      adapter,
      { userId: USER_ID, stepId: 'welcome_hook' },
      { now: () => customTs },
    );
    expect(adapter.received[0]?.timestamp).toBe(customTs);
  });
});

// ---------------------------------------------------------------------------
// 9. trackStepEnter — 불변성
// ---------------------------------------------------------------------------

describe('trackStepEnter — 불변성', () => {
  it('반환된 페이로드는 freeze되어 있다', () => {
    const adapter = makeRecordingAdapter();
    const payload = trackStepEnter(
      adapter,
      { userId: USER_ID, stepId: 'welcome_hook' },
      { now: () => FIXED_NOW },
    );
    expect(Object.isFrozen(payload)).toBe(true);
  });

  it('어댑터에 전달된 페이로드도 freeze되어 있다', () => {
    const adapter = makeRecordingAdapter();
    trackStepEnter(
      adapter,
      { userId: USER_ID, stepId: 'welcome_hook' },
      { now: () => FIXED_NOW },
    );
    expect(Object.isFrozen(adapter.received[0])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 10. trackStepAbandon — 이벤트 이름
// ---------------------------------------------------------------------------

describe('trackStepAbandon — eventName', () => {
  it('publishEvent에 eventName="funnel_step_abandon"를 전달한다', () => {
    const adapter = makeRecordingAdapter();
    trackStepAbandon(
      adapter,
      { userId: USER_ID, stepId: 'payment_model', durationMs: 5000 },
      { now: () => FIXED_NOW },
    );

    expect(adapter.received).toHaveLength(1);
    expect(adapter.received[0]?.eventName).toBe(FUNNEL_STEP_ABANDON_EVENT);
    expect(adapter.received[0]?.eventName).toBe('funnel_step_abandon');
  });
});

// ---------------------------------------------------------------------------
// 11. trackStepAbandon — stepId 전달
// ---------------------------------------------------------------------------

describe('trackStepAbandon — stepId', () => {
  it('입력 stepId가 페이로드의 stepId 필드로 전달된다', () => {
    const adapter = makeRecordingAdapter();
    trackStepAbandon(
      adapter,
      { userId: USER_ID, stepId: 'referral_gate', durationMs: 0 },
      { now: () => FIXED_NOW },
    );
    expect(adapter.received[0]?.stepId).toBe('referral_gate');
  });

  it('welcome_hook stepId가 올바르게 전달된다', () => {
    const adapter = makeRecordingAdapter();
    trackStepAbandon(
      adapter,
      { userId: USER_ID, stepId: 'welcome_hook', durationMs: 500 },
      { now: () => FIXED_NOW },
    );
    expect(adapter.received[0]?.stepId).toBe('welcome_hook');
  });
});

// ---------------------------------------------------------------------------
// 12. trackStepAbandon — durationMs 필드 (필수)
// ---------------------------------------------------------------------------

describe('trackStepAbandon — durationMs (필수 필드)', () => {
  it('durationMs가 properties.durationMs에 포함된다', () => {
    const adapter = makeRecordingAdapter();
    trackStepAbandon(
      adapter,
      { userId: USER_ID, stepId: 'payment_model', durationMs: 8500 },
      { now: () => FIXED_NOW },
    );

    const props = adapter.received[0]?.properties as
      | Record<string, unknown>
      | undefined;
    expect(props?.['durationMs']).toBe(8500);
  });

  it('durationMs=0은 그대로 전달된다 (즉각 이탈 케이스)', () => {
    const adapter = makeRecordingAdapter();
    trackStepAbandon(
      adapter,
      { userId: USER_ID, stepId: 'payment_model', durationMs: 0 },
      { now: () => FIXED_NOW },
    );

    const props = adapter.received[0]?.properties as
      | Record<string, unknown>
      | undefined;
    expect(props?.['durationMs']).toBe(0);
  });

  it('큰 durationMs(1시간 이상)도 정확하게 전달된다', () => {
    const adapter = makeRecordingAdapter();
    const ONE_HOUR_MS = 3_600_000;
    trackStepAbandon(
      adapter,
      { userId: USER_ID, stepId: 'result_reveal', durationMs: ONE_HOUR_MS },
      { now: () => FIXED_NOW },
    );

    const props = adapter.received[0]?.properties as
      | Record<string, unknown>
      | undefined;
    expect(props?.['durationMs']).toBe(ONE_HOUR_MS);
  });

  it('durationMs가 properties에 항상 존재한다 (previousStep 없을 때도)', () => {
    const adapter = makeRecordingAdapter();
    trackStepAbandon(
      adapter,
      { userId: USER_ID, stepId: 'payment_model', durationMs: 1000 },
      { now: () => FIXED_NOW },
    );

    const props = adapter.received[0]?.properties as
      | Record<string, unknown>
      | undefined;
    expect(props).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(props, 'durationMs')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 13. trackStepAbandon — previousStep 필드
// ---------------------------------------------------------------------------

describe('trackStepAbandon — previousStep', () => {
  it('previousStep이 있으면 properties.previousStep에 포함된다', () => {
    const adapter = makeRecordingAdapter();
    trackStepAbandon(
      adapter,
      {
        userId: USER_ID,
        stepId: 'result_reveal',
        durationMs: 3000,
        previousStep: 'fake_scan_animation',
      },
      { now: () => FIXED_NOW },
    );

    const props = adapter.received[0]?.properties as
      | Record<string, unknown>
      | undefined;
    expect(props?.['previousStep']).toBe('fake_scan_animation');
  });

  it('previousStep이 없으면 properties에 previousStep 키가 없다', () => {
    const adapter = makeRecordingAdapter();
    trackStepAbandon(
      adapter,
      { userId: USER_ID, stepId: 'payment_model', durationMs: 1000 },
      { now: () => FIXED_NOW },
    );

    const props = adapter.received[0]?.properties as
      | Record<string, unknown>
      | undefined;
    expect(props?.['previousStep']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 14. trackStepAbandon — 완전한 페이로드 정합성
// ---------------------------------------------------------------------------

describe('trackStepAbandon — 완전한 페이로드', () => {
  it('stepId·previousStep·durationMs를 모두 포함한 완전한 페이로드를 publishEvent로 전달한다', () => {
    const adapter = makeRecordingAdapter();
    const input: TrackStepAbandonInput = {
      userId: USER_ID,
      stepId: 'social_evolution',
      durationMs: 15000,
      previousStep: 'referral_gate',
    };
    const payload = trackStepAbandon(adapter, input, { now: () => FIXED_NOW });

    expect(payload.eventName).toBe('funnel_step_abandon');
    expect(payload.userId).toBe(USER_ID);
    expect(payload.stepId).toBe('social_evolution');
    expect(payload.timestamp).toBe(FIXED_NOW);
    const props = payload.properties as Record<string, unknown>;
    expect(props['durationMs']).toBe(15000);
    expect(props['previousStep']).toBe('referral_gate');
  });

  it('어댑터에 전달된 페이로드와 반환값이 동일한 객체다', () => {
    const adapter = makeRecordingAdapter();
    const returned = trackStepAbandon(
      adapter,
      { userId: USER_ID, stepId: 'payment_model', durationMs: 2000 },
      { now: () => FIXED_NOW },
    );
    expect(returned).toBe(adapter.received[0]);
  });

  it('어댑터에 이벤트가 정확히 1회 전달된다', () => {
    const adapter = makeRecordingAdapter();
    trackStepAbandon(
      adapter,
      { userId: USER_ID, stepId: 'payment_model', durationMs: 1000 },
      { now: () => FIXED_NOW },
    );
    expect(adapter.received).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 15. trackStepAbandon — userId 전달
// ---------------------------------------------------------------------------

describe('trackStepAbandon — userId', () => {
  it('입력 userId가 페이로드에 그대로 전달된다', () => {
    const adapter = makeRecordingAdapter();
    trackStepAbandon(
      adapter,
      { userId: 'user_abandon_99', stepId: 'payment_model', durationMs: 500 },
      { now: () => FIXED_NOW },
    );
    expect(adapter.received[0]?.userId).toBe('user_abandon_99');
  });
});

// ---------------------------------------------------------------------------
// 16. trackStepAbandon — 타임스탬프 주입
// ---------------------------------------------------------------------------

describe('trackStepAbandon — 타임스탬프', () => {
  it('now 옵션의 반환값이 타임스탬프로 사용된다', () => {
    const adapter = makeRecordingAdapter();
    const customTs = 1_600_000_000_000;
    trackStepAbandon(
      adapter,
      { userId: USER_ID, stepId: 'payment_model', durationMs: 1000 },
      { now: () => customTs },
    );
    expect(adapter.received[0]?.timestamp).toBe(customTs);
  });
});

// ---------------------------------------------------------------------------
// 17. trackStepAbandon — 불변성
// ---------------------------------------------------------------------------

describe('trackStepAbandon — 불변성', () => {
  it('반환된 페이로드는 freeze되어 있다', () => {
    const adapter = makeRecordingAdapter();
    const payload = trackStepAbandon(
      adapter,
      { userId: USER_ID, stepId: 'payment_model', durationMs: 1000 },
      { now: () => FIXED_NOW },
    );
    expect(Object.isFrozen(payload)).toBe(true);
  });

  it('어댑터에 전달된 페이로드도 freeze되어 있다', () => {
    const adapter = makeRecordingAdapter();
    trackStepAbandon(
      adapter,
      { userId: USER_ID, stepId: 'payment_model', durationMs: 1000 },
      { now: () => FIXED_NOW },
    );
    expect(Object.isFrozen(adapter.received[0])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 18. enter vs abandon 이벤트 구분
// ---------------------------------------------------------------------------

describe('trackStepEnter vs trackStepAbandon — 이벤트 이름 구분', () => {
  it('같은 stepId에 대해 enter와 abandon 이벤트가 서로 다른 eventName을 갖는다', () => {
    const adapterEnter = makeRecordingAdapter();
    const adapterAbandon = makeRecordingAdapter();

    trackStepEnter(
      adapterEnter,
      { userId: USER_ID, stepId: 'payment_model' },
      { now: () => FIXED_NOW },
    );
    trackStepAbandon(
      adapterAbandon,
      { userId: USER_ID, stepId: 'payment_model', durationMs: 5000 },
      { now: () => FIXED_NOW },
    );

    expect(adapterEnter.received[0]?.eventName).toBe('funnel_step_enter');
    expect(adapterAbandon.received[0]?.eventName).toBe('funnel_step_abandon');
    expect(adapterEnter.received[0]?.eventName).not.toBe(
      adapterAbandon.received[0]?.eventName,
    );
  });

  it('두 이벤트 모두 같은 stepId를 갖는다', () => {
    const adapterEnter = makeRecordingAdapter();
    const adapterAbandon = makeRecordingAdapter();

    trackStepEnter(
      adapterEnter,
      { userId: USER_ID, stepId: 'referral_gate' },
      { now: () => FIXED_NOW },
    );
    trackStepAbandon(
      adapterAbandon,
      { userId: USER_ID, stepId: 'referral_gate', durationMs: 7000 },
      { now: () => FIXED_NOW },
    );

    expect(adapterEnter.received[0]?.stepId).toBe('referral_gate');
    expect(adapterAbandon.received[0]?.stepId).toBe('referral_gate');
  });
});

// ---------------------------------------------------------------------------
// 19. 연속 이벤트 순서 보장
// ---------------------------------------------------------------------------

describe('연속 이벤트 순서 보장', () => {
  it('enter 후 abandon 순서로 어댑터에 이벤트가 도착한다 (단일 어댑터)', () => {
    const adapter = makeRecordingAdapter();

    trackStepEnter(
      adapter,
      { userId: USER_ID, stepId: 'payment_model' },
      { now: () => FIXED_NOW },
    );
    trackStepAbandon(
      adapter,
      { userId: USER_ID, stepId: 'payment_model', durationMs: 3000 },
      { now: () => FIXED_NOW },
    );

    expect(adapter.received).toHaveLength(2);
    expect(adapter.received[0]?.eventName).toBe('funnel_step_enter');
    expect(adapter.received[1]?.eventName).toBe('funnel_step_abandon');
  });
});
