/**
 * 단위 테스트 — 결제 마일스톤 이벤트 함수 (Sub-AC 4c)
 *
 * 검증 항목:
 *   1. 이벤트 이름 상수(PAYMENT_ATTEMPT_EVENT, PAYMENT_COMPLETE_EVENT) 계약
 *   2. trackPaymentAttempt — publishEvent 호출 시 올바른 페이로드 전달
 *      - eventName: 'payment_attempt'
 *      - stepId: 'payment_model' (결제 단계 고정)
 *      - userId
 *      - properties.planId (필수)
 *      - properties.amount (필수)
 *      - properties.currency (필수)
 *      - properties.transactionId (있을 때만 포함)
 *   3. trackPaymentComplete — publishEvent 호출 시 올바른 페이로드 전달
 *      - eventName: 'payment_complete'
 *      - stepId: 'payment_model' (결제 단계 고정)
 *      - userId
 *      - properties.planId (필수)
 *      - properties.amount (필수)
 *      - properties.currency (필수)
 *      - properties.transactionId (필수)
 *   4. 두 함수 모두 now 주입 가능 (타임스탬프 결정론적 제어)
 *   5. 두 함수 모두 frozen 페이로드 반환
 *   6. 어댑터에 페이로드가 정확히 1회 전달됨
 *   7. attempt vs complete 이벤트 이름 구분
 */
import { describe, expect, it } from 'vitest';

import {
  PAYMENT_ATTEMPT_EVENT,
  PAYMENT_COMPLETE_EVENT,
  trackPaymentAttempt,
  trackPaymentComplete,
  type TrackPaymentAttemptInput,
  type TrackPaymentCompleteInput,
} from '../../src/funnel/payment-events.js';
import {
  type AnalyticsAdapter,
  type AnalyticsEventPayload,
} from '../../src/analytics/event-publisher.js';

// ---------------------------------------------------------------------------
// 테스트 헬퍼
// ---------------------------------------------------------------------------

const FIXED_NOW = 1_715_000_000_000; // 2024-05-06T11:33:20Z — 결정론적 고정값
const USER_ID = 'user_kr_payment_test_01';

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
  it('PAYMENT_ATTEMPT_EVENT 상수가 "payment_attempt"이다', () => {
    expect(PAYMENT_ATTEMPT_EVENT).toBe('payment_attempt');
  });

  it('PAYMENT_COMPLETE_EVENT 상수가 "payment_complete"이다', () => {
    expect(PAYMENT_COMPLETE_EVENT).toBe('payment_complete');
  });

  it('두 이벤트 이름이 서로 다르다 (이름 충돌 없음)', () => {
    expect(PAYMENT_ATTEMPT_EVENT).not.toBe(PAYMENT_COMPLETE_EVENT);
  });
});

// ---------------------------------------------------------------------------
// 2. trackPaymentAttempt — 이벤트 이름
// ---------------------------------------------------------------------------

describe('trackPaymentAttempt — eventName', () => {
  it('publishEvent에 eventName="payment_attempt"를 전달한다', () => {
    const adapter = makeRecordingAdapter();
    trackPaymentAttempt(
      adapter,
      { userId: USER_ID, planId: 'annual', amount: 59, currency: 'USD' },
      { now: () => FIXED_NOW },
    );

    expect(adapter.received).toHaveLength(1);
    expect(adapter.received[0]?.eventName).toBe(PAYMENT_ATTEMPT_EVENT);
    expect(adapter.received[0]?.eventName).toBe('payment_attempt');
  });
});

// ---------------------------------------------------------------------------
// 3. trackPaymentAttempt — stepId 전달
// ---------------------------------------------------------------------------

describe('trackPaymentAttempt — stepId', () => {
  it('stepId가 "payment_model"로 고정된다', () => {
    const adapter = makeRecordingAdapter();
    trackPaymentAttempt(
      adapter,
      { userId: USER_ID, planId: 'monthly', amount: 12, currency: 'USD' },
      { now: () => FIXED_NOW },
    );

    expect(adapter.received[0]?.stepId).toBe('payment_model');
  });
});

// ---------------------------------------------------------------------------
// 4. trackPaymentAttempt — 결제 전용 필드 (planId·amount·currency)
// ---------------------------------------------------------------------------

describe('trackPaymentAttempt — 결제 전용 필드', () => {
  it('properties.planId에 입력 planId가 포함된다 (annual)', () => {
    const adapter = makeRecordingAdapter();
    trackPaymentAttempt(
      adapter,
      { userId: USER_ID, planId: 'annual', amount: 59, currency: 'USD' },
      { now: () => FIXED_NOW },
    );

    const props = adapter.received[0]?.properties as Record<string, unknown> | undefined;
    expect(props?.['planId']).toBe('annual');
  });

  it('properties.planId에 입력 planId가 포함된다 (monthly)', () => {
    const adapter = makeRecordingAdapter();
    trackPaymentAttempt(
      adapter,
      { userId: USER_ID, planId: 'monthly', amount: 12, currency: 'USD' },
      { now: () => FIXED_NOW },
    );

    const props = adapter.received[0]?.properties as Record<string, unknown> | undefined;
    expect(props?.['planId']).toBe('monthly');
  });

  it('properties.amount에 입력 amount가 포함된다', () => {
    const adapter = makeRecordingAdapter();
    trackPaymentAttempt(
      adapter,
      { userId: USER_ID, planId: 'annual', amount: 59, currency: 'USD' },
      { now: () => FIXED_NOW },
    );

    const props = adapter.received[0]?.properties as Record<string, unknown> | undefined;
    expect(props?.['amount']).toBe(59);
  });

  it('properties.currency에 입력 currency가 포함된다', () => {
    const adapter = makeRecordingAdapter();
    trackPaymentAttempt(
      adapter,
      { userId: USER_ID, planId: 'annual', amount: 59, currency: 'USD' },
      { now: () => FIXED_NOW },
    );

    const props = adapter.received[0]?.properties as Record<string, unknown> | undefined;
    expect(props?.['currency']).toBe('USD');
  });

  it('한국 원화(KRW) currency도 올바르게 전달된다', () => {
    const adapter = makeRecordingAdapter();
    trackPaymentAttempt(
      adapter,
      { userId: USER_ID, planId: 'monthly', amount: 15900, currency: 'KRW' },
      { now: () => FIXED_NOW },
    );

    const props = adapter.received[0]?.properties as Record<string, unknown> | undefined;
    expect(props?.['currency']).toBe('KRW');
    expect(props?.['amount']).toBe(15900);
  });
});

// ---------------------------------------------------------------------------
// 5. trackPaymentAttempt — transactionId 필드 (선택)
// ---------------------------------------------------------------------------

describe('trackPaymentAttempt — transactionId', () => {
  it('transactionId가 있으면 properties.transactionId에 포함된다', () => {
    const adapter = makeRecordingAdapter();
    trackPaymentAttempt(
      adapter,
      {
        userId: USER_ID,
        planId: 'annual',
        amount: 59,
        currency: 'USD',
        transactionId: 'txn_attempt_001',
      },
      { now: () => FIXED_NOW },
    );

    const props = adapter.received[0]?.properties as Record<string, unknown> | undefined;
    expect(props?.['transactionId']).toBe('txn_attempt_001');
  });

  it('transactionId가 없으면 properties에 transactionId 키가 없다', () => {
    const adapter = makeRecordingAdapter();
    trackPaymentAttempt(
      adapter,
      { userId: USER_ID, planId: 'annual', amount: 59, currency: 'USD' },
      { now: () => FIXED_NOW },
    );

    const props = adapter.received[0]?.properties as Record<string, unknown> | undefined;
    expect(props?.['transactionId']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 6. trackPaymentAttempt — 완전한 페이로드 정합성
// ---------------------------------------------------------------------------

describe('trackPaymentAttempt — 완전한 페이로드', () => {
  it('planId·amount·currency·transactionId를 모두 포함한 완전한 페이로드를 publishEvent로 전달한다', () => {
    const adapter = makeRecordingAdapter();
    const input: TrackPaymentAttemptInput = {
      userId: USER_ID,
      planId: 'annual',
      amount: 59,
      currency: 'USD',
      transactionId: 'txn_full_001',
    };
    const payload = trackPaymentAttempt(adapter, input, { now: () => FIXED_NOW });

    expect(payload.eventName).toBe('payment_attempt');
    expect(payload.userId).toBe(USER_ID);
    expect(payload.stepId).toBe('payment_model');
    expect(payload.timestamp).toBe(FIXED_NOW);
    const props = payload.properties as Record<string, unknown>;
    expect(props['planId']).toBe('annual');
    expect(props['amount']).toBe(59);
    expect(props['currency']).toBe('USD');
    expect(props['transactionId']).toBe('txn_full_001');
  });

  it('어댑터에 전달된 페이로드와 반환값이 동일한 객체다', () => {
    const adapter = makeRecordingAdapter();
    const returned = trackPaymentAttempt(
      adapter,
      { userId: USER_ID, planId: 'annual', amount: 59, currency: 'USD' },
      { now: () => FIXED_NOW },
    );
    expect(returned).toBe(adapter.received[0]);
  });

  it('어댑터에 이벤트가 정확히 1회 전달된다', () => {
    const adapter = makeRecordingAdapter();
    trackPaymentAttempt(
      adapter,
      { userId: USER_ID, planId: 'monthly', amount: 12, currency: 'USD' },
      { now: () => FIXED_NOW },
    );
    expect(adapter.received).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 7. trackPaymentAttempt — userId 전달
// ---------------------------------------------------------------------------

describe('trackPaymentAttempt — userId', () => {
  it('입력 userId가 페이로드에 그대로 전달된다', () => {
    const adapter = makeRecordingAdapter();
    trackPaymentAttempt(
      adapter,
      { userId: 'user_payment_777', planId: 'annual', amount: 59, currency: 'USD' },
      { now: () => FIXED_NOW },
    );
    expect(adapter.received[0]?.userId).toBe('user_payment_777');
  });
});

// ---------------------------------------------------------------------------
// 8. trackPaymentAttempt — 타임스탬프 주입
// ---------------------------------------------------------------------------

describe('trackPaymentAttempt — 타임스탬프', () => {
  it('now 옵션의 반환값이 타임스탬프로 사용된다', () => {
    const adapter = makeRecordingAdapter();
    const customTs = 9_999_999_999;
    trackPaymentAttempt(
      adapter,
      { userId: USER_ID, planId: 'annual', amount: 59, currency: 'USD' },
      { now: () => customTs },
    );
    expect(adapter.received[0]?.timestamp).toBe(customTs);
  });
});

// ---------------------------------------------------------------------------
// 9. trackPaymentAttempt — 불변성
// ---------------------------------------------------------------------------

describe('trackPaymentAttempt — 불변성', () => {
  it('반환된 페이로드는 freeze되어 있다', () => {
    const adapter = makeRecordingAdapter();
    const payload = trackPaymentAttempt(
      adapter,
      { userId: USER_ID, planId: 'annual', amount: 59, currency: 'USD' },
      { now: () => FIXED_NOW },
    );
    expect(Object.isFrozen(payload)).toBe(true);
  });

  it('어댑터에 전달된 페이로드도 freeze되어 있다', () => {
    const adapter = makeRecordingAdapter();
    trackPaymentAttempt(
      adapter,
      { userId: USER_ID, planId: 'annual', amount: 59, currency: 'USD' },
      { now: () => FIXED_NOW },
    );
    expect(Object.isFrozen(adapter.received[0])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 10. trackPaymentComplete — 이벤트 이름
// ---------------------------------------------------------------------------

describe('trackPaymentComplete — eventName', () => {
  it('publishEvent에 eventName="payment_complete"를 전달한다', () => {
    const adapter = makeRecordingAdapter();
    trackPaymentComplete(
      adapter,
      {
        userId: USER_ID,
        planId: 'annual',
        amount: 59,
        currency: 'USD',
        transactionId: 'txn_complete_001',
      },
      { now: () => FIXED_NOW },
    );

    expect(adapter.received).toHaveLength(1);
    expect(adapter.received[0]?.eventName).toBe(PAYMENT_COMPLETE_EVENT);
    expect(adapter.received[0]?.eventName).toBe('payment_complete');
  });
});

// ---------------------------------------------------------------------------
// 11. trackPaymentComplete — stepId 전달
// ---------------------------------------------------------------------------

describe('trackPaymentComplete — stepId', () => {
  it('stepId가 "payment_model"로 고정된다', () => {
    const adapter = makeRecordingAdapter();
    trackPaymentComplete(
      adapter,
      {
        userId: USER_ID,
        planId: 'annual',
        amount: 59,
        currency: 'USD',
        transactionId: 'txn_001',
      },
      { now: () => FIXED_NOW },
    );

    expect(adapter.received[0]?.stepId).toBe('payment_model');
  });
});

// ---------------------------------------------------------------------------
// 12. trackPaymentComplete — 결제 전용 필드 (planId·amount·currency·transactionId)
// ---------------------------------------------------------------------------

describe('trackPaymentComplete — 결제 전용 필드', () => {
  it('properties.planId에 입력 planId가 포함된다 (annual)', () => {
    const adapter = makeRecordingAdapter();
    trackPaymentComplete(
      adapter,
      {
        userId: USER_ID,
        planId: 'annual',
        amount: 59,
        currency: 'USD',
        transactionId: 'txn_001',
      },
      { now: () => FIXED_NOW },
    );

    const props = adapter.received[0]?.properties as Record<string, unknown> | undefined;
    expect(props?.['planId']).toBe('annual');
  });

  it('properties.planId에 입력 planId가 포함된다 (monthly)', () => {
    const adapter = makeRecordingAdapter();
    trackPaymentComplete(
      adapter,
      {
        userId: USER_ID,
        planId: 'monthly',
        amount: 12,
        currency: 'USD',
        transactionId: 'txn_monthly_001',
      },
      { now: () => FIXED_NOW },
    );

    const props = adapter.received[0]?.properties as Record<string, unknown> | undefined;
    expect(props?.['planId']).toBe('monthly');
  });

  it('properties.amount에 입력 amount가 포함된다', () => {
    const adapter = makeRecordingAdapter();
    trackPaymentComplete(
      adapter,
      {
        userId: USER_ID,
        planId: 'annual',
        amount: 59,
        currency: 'USD',
        transactionId: 'txn_001',
      },
      { now: () => FIXED_NOW },
    );

    const props = adapter.received[0]?.properties as Record<string, unknown> | undefined;
    expect(props?.['amount']).toBe(59);
  });

  it('properties.currency에 입력 currency가 포함된다', () => {
    const adapter = makeRecordingAdapter();
    trackPaymentComplete(
      adapter,
      {
        userId: USER_ID,
        planId: 'annual',
        amount: 59,
        currency: 'USD',
        transactionId: 'txn_001',
      },
      { now: () => FIXED_NOW },
    );

    const props = adapter.received[0]?.properties as Record<string, unknown> | undefined;
    expect(props?.['currency']).toBe('USD');
  });

  it('properties.transactionId에 입력 transactionId가 포함된다 — 항상 필수', () => {
    const adapter = makeRecordingAdapter();
    trackPaymentComplete(
      adapter,
      {
        userId: USER_ID,
        planId: 'annual',
        amount: 59,
        currency: 'USD',
        transactionId: 'toss_payment_txn_999',
      },
      { now: () => FIXED_NOW },
    );

    const props = adapter.received[0]?.properties as Record<string, unknown> | undefined;
    expect(props?.['transactionId']).toBe('toss_payment_txn_999');
  });

  it('properties에 transactionId 키가 항상 존재한다', () => {
    const adapter = makeRecordingAdapter();
    trackPaymentComplete(
      adapter,
      {
        userId: USER_ID,
        planId: 'monthly',
        amount: 12,
        currency: 'USD',
        transactionId: 'txn_required',
      },
      { now: () => FIXED_NOW },
    );

    const props = adapter.received[0]?.properties as Record<string, unknown> | undefined;
    expect(props).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(props, 'transactionId')).toBe(true);
  });

  it('한국 원화(KRW) 결제 완료도 올바르게 전달된다', () => {
    const adapter = makeRecordingAdapter();
    trackPaymentComplete(
      adapter,
      {
        userId: USER_ID,
        planId: 'monthly',
        amount: 15900,
        currency: 'KRW',
        transactionId: 'toss_kr_txn_001',
      },
      { now: () => FIXED_NOW },
    );

    const props = adapter.received[0]?.properties as Record<string, unknown> | undefined;
    expect(props?.['currency']).toBe('KRW');
    expect(props?.['amount']).toBe(15900);
    expect(props?.['transactionId']).toBe('toss_kr_txn_001');
  });
});

// ---------------------------------------------------------------------------
// 13. trackPaymentComplete — 완전한 페이로드 정합성
// ---------------------------------------------------------------------------

describe('trackPaymentComplete — 완전한 페이로드', () => {
  it('planId·amount·currency·transactionId를 모두 포함한 완전한 페이로드를 publishEvent로 전달한다', () => {
    const adapter = makeRecordingAdapter();
    const input: TrackPaymentCompleteInput = {
      userId: USER_ID,
      planId: 'annual',
      amount: 59,
      currency: 'USD',
      transactionId: 'txn_complete_full_001',
    };
    const payload = trackPaymentComplete(adapter, input, { now: () => FIXED_NOW });

    expect(payload.eventName).toBe('payment_complete');
    expect(payload.userId).toBe(USER_ID);
    expect(payload.stepId).toBe('payment_model');
    expect(payload.timestamp).toBe(FIXED_NOW);
    const props = payload.properties as Record<string, unknown>;
    expect(props['planId']).toBe('annual');
    expect(props['amount']).toBe(59);
    expect(props['currency']).toBe('USD');
    expect(props['transactionId']).toBe('txn_complete_full_001');
  });

  it('어댑터에 전달된 페이로드와 반환값이 동일한 객체다', () => {
    const adapter = makeRecordingAdapter();
    const returned = trackPaymentComplete(
      adapter,
      {
        userId: USER_ID,
        planId: 'annual',
        amount: 59,
        currency: 'USD',
        transactionId: 'txn_ref_001',
      },
      { now: () => FIXED_NOW },
    );
    expect(returned).toBe(adapter.received[0]);
  });

  it('어댑터에 이벤트가 정확히 1회 전달된다', () => {
    const adapter = makeRecordingAdapter();
    trackPaymentComplete(
      adapter,
      {
        userId: USER_ID,
        planId: 'annual',
        amount: 59,
        currency: 'USD',
        transactionId: 'txn_once',
      },
      { now: () => FIXED_NOW },
    );
    expect(adapter.received).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 14. trackPaymentComplete — userId 전달
// ---------------------------------------------------------------------------

describe('trackPaymentComplete — userId', () => {
  it('입력 userId가 페이로드에 그대로 전달된다', () => {
    const adapter = makeRecordingAdapter();
    trackPaymentComplete(
      adapter,
      {
        userId: 'user_complete_777',
        planId: 'annual',
        amount: 59,
        currency: 'USD',
        transactionId: 'txn_777',
      },
      { now: () => FIXED_NOW },
    );
    expect(adapter.received[0]?.userId).toBe('user_complete_777');
  });
});

// ---------------------------------------------------------------------------
// 15. trackPaymentComplete — 타임스탬프 주입
// ---------------------------------------------------------------------------

describe('trackPaymentComplete — 타임스탬프', () => {
  it('now 옵션의 반환값이 타임스탬프로 사용된다', () => {
    const adapter = makeRecordingAdapter();
    const customTs = 1_600_000_000_000;
    trackPaymentComplete(
      adapter,
      {
        userId: USER_ID,
        planId: 'annual',
        amount: 59,
        currency: 'USD',
        transactionId: 'txn_ts_test',
      },
      { now: () => customTs },
    );
    expect(adapter.received[0]?.timestamp).toBe(customTs);
  });
});

// ---------------------------------------------------------------------------
// 16. trackPaymentComplete — 불변성
// ---------------------------------------------------------------------------

describe('trackPaymentComplete — 불변성', () => {
  it('반환된 페이로드는 freeze되어 있다', () => {
    const adapter = makeRecordingAdapter();
    const payload = trackPaymentComplete(
      adapter,
      {
        userId: USER_ID,
        planId: 'annual',
        amount: 59,
        currency: 'USD',
        transactionId: 'txn_freeze_test',
      },
      { now: () => FIXED_NOW },
    );
    expect(Object.isFrozen(payload)).toBe(true);
  });

  it('어댑터에 전달된 페이로드도 freeze되어 있다', () => {
    const adapter = makeRecordingAdapter();
    trackPaymentComplete(
      adapter,
      {
        userId: USER_ID,
        planId: 'annual',
        amount: 59,
        currency: 'USD',
        transactionId: 'txn_freeze_adapter',
      },
      { now: () => FIXED_NOW },
    );
    expect(Object.isFrozen(adapter.received[0])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 17. attempt vs complete 이벤트 구분
// ---------------------------------------------------------------------------

describe('trackPaymentAttempt vs trackPaymentComplete — 이벤트 이름 구분', () => {
  it('같은 planId에 대해 attempt와 complete 이벤트가 서로 다른 eventName을 갖는다', () => {
    const adapterAttempt = makeRecordingAdapter();
    const adapterComplete = makeRecordingAdapter();

    trackPaymentAttempt(
      adapterAttempt,
      { userId: USER_ID, planId: 'annual', amount: 59, currency: 'USD' },
      { now: () => FIXED_NOW },
    );
    trackPaymentComplete(
      adapterComplete,
      {
        userId: USER_ID,
        planId: 'annual',
        amount: 59,
        currency: 'USD',
        transactionId: 'txn_final',
      },
      { now: () => FIXED_NOW },
    );

    expect(adapterAttempt.received[0]?.eventName).toBe('payment_attempt');
    expect(adapterComplete.received[0]?.eventName).toBe('payment_complete');
    expect(adapterAttempt.received[0]?.eventName).not.toBe(
      adapterComplete.received[0]?.eventName,
    );
  });

  it('두 이벤트 모두 같은 stepId("payment_model")를 갖는다', () => {
    const adapterAttempt = makeRecordingAdapter();
    const adapterComplete = makeRecordingAdapter();

    trackPaymentAttempt(
      adapterAttempt,
      { userId: USER_ID, planId: 'annual', amount: 59, currency: 'USD' },
      { now: () => FIXED_NOW },
    );
    trackPaymentComplete(
      adapterComplete,
      {
        userId: USER_ID,
        planId: 'annual',
        amount: 59,
        currency: 'USD',
        transactionId: 'txn_stepid_check',
      },
      { now: () => FIXED_NOW },
    );

    expect(adapterAttempt.received[0]?.stepId).toBe('payment_model');
    expect(adapterComplete.received[0]?.stepId).toBe('payment_model');
  });
});

// ---------------------------------------------------------------------------
// 18. 연속 이벤트 순서 보장
// ---------------------------------------------------------------------------

describe('결제 흐름 순서 보장', () => {
  it('attempt 후 complete 순서로 어댑터에 이벤트가 도착한다 (단일 어댑터)', () => {
    const adapter = makeRecordingAdapter();

    trackPaymentAttempt(
      adapter,
      { userId: USER_ID, planId: 'annual', amount: 59, currency: 'USD' },
      { now: () => FIXED_NOW },
    );
    trackPaymentComplete(
      adapter,
      {
        userId: USER_ID,
        planId: 'annual',
        amount: 59,
        currency: 'USD',
        transactionId: 'txn_sequence_001',
      },
      { now: () => FIXED_NOW },
    );

    expect(adapter.received).toHaveLength(2);
    expect(adapter.received[0]?.eventName).toBe('payment_attempt');
    expect(adapter.received[1]?.eventName).toBe('payment_complete');
  });

  it('두 이벤트 모두 동일한 planId를 공유한다', () => {
    const adapter = makeRecordingAdapter();

    trackPaymentAttempt(
      adapter,
      { userId: USER_ID, planId: 'monthly', amount: 12, currency: 'USD' },
      { now: () => FIXED_NOW },
    );
    trackPaymentComplete(
      adapter,
      {
        userId: USER_ID,
        planId: 'monthly',
        amount: 12,
        currency: 'USD',
        transactionId: 'txn_monthly_seq',
      },
      { now: () => FIXED_NOW },
    );

    const attemptProps = adapter.received[0]?.properties as Record<string, unknown>;
    const completeProps = adapter.received[1]?.properties as Record<string, unknown>;
    expect(attemptProps['planId']).toBe('monthly');
    expect(completeProps['planId']).toBe('monthly');
  });
});
