/**
 * 단위 테스트 — Sub-AC 14b-4: 스킵 경로 처리.
 *
 * 검증 계약:
 *   이미 요청됨·Apple 연간 횟수 초과·조건 미충족 시 `requestReview()` 네이티브 호출을
 *   하지 않고 스킵 플래그를 기록한 결과를 반환한다.
 *
 * 스킵 경로 3가지:
 *   1. 이미 요청됨 (already_requested):
 *      hasPreviouslyRequested === true
 *      → requestReview() 호출 없음 + { skipped: true, reason: 'already_requested' }
 *
 *   2. 조건 미충족 (conditions_not_met):
 *      paymentCompleted === false 또는 usageCount < minimumUsageCount
 *      → requestReview() 호출 없음 + { skipped: true, reason: 'conditions_not_met' }
 *
 *   3. Apple 연간 횟수 초과 (apple_annual_limit):
 *      isAvailableAsync()가 false 반환 → requestReview() outcome.available === false
 *      → { skipped: true, reason: 'apple_annual_limit' }
 *      (requestReview는 호출되지만 네이티브 다이얼로그는 표시되지 않음)
 *
 * 진행 경로 (proceed path):
 *   모든 조건 통과 + isAvailableAsync() true
 *   → { skipped: false, outcome: { attempted: true, available: true } }
 *
 * 모킹 전략:
 *   - `requestReview`를 `GatedReviewRequestOptions.requestReview`로 주입.
 *     vi.fn()으로 mock 제공 — 네이티브 모듈(`expo-store-review`) 모킹 불필요.
 *   - `now`를 주입하여 타임스탬프를 핀 고정.
 *   - `shouldRequestReview`는 실제 구현 사용 (순수 함수로 mock 불필요).
 *
 * 격리 경계:
 *   이 파일은 네이티브 모듈을 가져오지 않습니다.
 *   `gated-review-request.ts`는 `requestReview` 의존성을 주입받으므로
 *   `expo-store-review`, `react-native` 모킹 없이 테스트 가능.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { gatedReviewRequest } from '../src/store-review/gated-review-request';
import type { GatedReviewRequestResult, ReviewRequestSkipRecord } from '../src/store-review/gated-review-request';

// ---------------------------------------------------------------------------
// 헬퍼
// ---------------------------------------------------------------------------

const FIXED_NOW = '2026-06-08T12:00:00.000Z';

/** 모든 조건 충족인 기본 입력. 필요한 필드만 재정의. */
function makeValidInput(overrides: Record<string, unknown> = {}): {
  paymentCompleted: boolean;
  hasPreviouslyRequested: boolean;
  usageCount: number;
  minimumUsageCount: number;
} {
  return {
    paymentCompleted: true,
    hasPreviouslyRequested: false,
    usageCount: 5,
    minimumUsageCount: 1,
    ...overrides,
  };
}

/** available=true인 성공 outcome mock. */
function makeAvailableOutcome(): Promise<{ attempted: boolean; available: boolean; platform: string }> {
  return Promise.resolve({
    attempted: true,
    available: true,
    platform: 'ios',
  });
}

/** available=false인 rate-limited outcome mock (Apple 연간 횟수 초과). */
function makeUnavailableOutcome(): Promise<{ attempted: boolean; available: boolean; platform: string }> {
  return Promise.resolve({
    attempted: false,
    available: false,
    platform: 'ios',
  });
}

// ===========================================================================
// 스킵 경로 1 — 이미 요청됨 (already_requested)
// ===========================================================================

describe('gatedReviewRequest — 스킵 경로 1: 이미 요청됨 (already_requested)', () => {
  it('1. hasPreviouslyRequested=true → skipped=true, reason=already_requested', async () => {
    const requestReview = vi.fn(() => makeAvailableOutcome());

    const result = await gatedReviewRequest(
      makeValidInput({ hasPreviouslyRequested: true }),
      { requestReview, now: () => FIXED_NOW },
    );

    expect(result.skipped).toBe(true);
    if (result.skipped) {
      expect(result.reason).toBe('already_requested');
    }
  });

  it('2. already_requested 스킵 시 requestReview()가 호출되지 않음 (네이티브 호출 없음)', async () => {
    const requestReview = vi.fn(() => makeAvailableOutcome());

    await gatedReviewRequest(
      makeValidInput({ hasPreviouslyRequested: true }),
      { requestReview, now: () => FIXED_NOW },
    );

    expect(requestReview).not.toHaveBeenCalled();
  });

  it('3. already_requested 결과의 decision.noPreviousRequest는 false (스킵 이유 분류 근거)', async () => {
    const requestReview = vi.fn(() => makeAvailableOutcome());

    const result = await gatedReviewRequest(
      makeValidInput({ hasPreviouslyRequested: true }),
      { requestReview, now: () => FIXED_NOW },
    );

    // decision.noPreviousRequest === false가 'already_requested' 분류의 근거
    expect(result.decision.noPreviousRequest).toBe(false);
  });
});

// ===========================================================================
// 스킵 경로 2 — 조건 미충족 (conditions_not_met)
// ===========================================================================

describe('gatedReviewRequest — 스킵 경로 2: 조건 미충족 (conditions_not_met)', () => {
  it('4. paymentCompleted=false → skipped=true, reason=conditions_not_met', async () => {
    const requestReview = vi.fn(() => makeAvailableOutcome());

    const result = await gatedReviewRequest(
      makeValidInput({ paymentCompleted: false }),
      { requestReview, now: () => FIXED_NOW },
    );

    expect(result.skipped).toBe(true);
    if (result.skipped) {
      expect(result.reason).toBe('conditions_not_met');
    }
  });

  it('5. usageCount < minimumUsageCount → skipped=true, reason=conditions_not_met', async () => {
    const requestReview = vi.fn(() => makeAvailableOutcome());

    const result = await gatedReviewRequest(
      makeValidInput({ usageCount: 0, minimumUsageCount: 3 }),
      { requestReview, now: () => FIXED_NOW },
    );

    expect(result.skipped).toBe(true);
    if (result.skipped) {
      expect(result.reason).toBe('conditions_not_met');
    }
  });

  it('6. paymentCompleted=false + usageCount 미달 (복수 조건 불충족) → conditions_not_met', async () => {
    const requestReview = vi.fn(() => makeAvailableOutcome());

    const result = await gatedReviewRequest(
      makeValidInput({ paymentCompleted: false, usageCount: 0, minimumUsageCount: 5 }),
      { requestReview, now: () => FIXED_NOW },
    );

    expect(result.skipped).toBe(true);
    if (result.skipped) {
      expect(result.reason).toBe('conditions_not_met');
    }
  });

  it('7. conditions_not_met 스킵 시 requestReview()가 호출되지 않음 (네이티브 호출 없음)', async () => {
    const requestReview = vi.fn(() => makeAvailableOutcome());

    await gatedReviewRequest(
      makeValidInput({ paymentCompleted: false }),
      { requestReview, now: () => FIXED_NOW },
    );

    expect(requestReview).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 스킵 경로 3 — Apple 연간 횟수 초과 (apple_annual_limit)
// ===========================================================================

describe('gatedReviewRequest — 스킵 경로 3: Apple 연간 횟수 초과 (apple_annual_limit)', () => {
  it('8. outcome.available=false → skipped=true, reason=apple_annual_limit', async () => {
    const requestReview = vi.fn(() => makeUnavailableOutcome());

    const result = await gatedReviewRequest(
      makeValidInput(),
      { requestReview, now: () => FIXED_NOW },
    );

    expect(result.skipped).toBe(true);
    if (result.skipped) {
      expect(result.reason).toBe('apple_annual_limit');
    }
  });

  it('9. apple_annual_limit 시 requestReview()는 정확히 1회 호출됨 (가용성 프로브 발생)', async () => {
    // 이 스킵 경로는 네이티브 SDK 호출 후 available=false를 감지하므로
    // requestReview()가 한 번 호출되는 것이 올바른 동작임.
    const requestReview = vi.fn(() => makeUnavailableOutcome());

    await gatedReviewRequest(
      makeValidInput(),
      { requestReview, now: () => FIXED_NOW },
    );

    expect(requestReview).toHaveBeenCalledTimes(1);
  });

  it('10. apple_annual_limit 결과에 decision이 포함되며 decision.shouldRequest === true', async () => {
    // 순수 함수 조건은 모두 통과했으나 네이티브 SDK가 rate-limit 반환.
    // decision.shouldRequest === true임을 확인 (조건 자체는 충족).
    const requestReview = vi.fn(() => makeUnavailableOutcome());

    const result = await gatedReviewRequest(
      makeValidInput(),
      { requestReview, now: () => FIXED_NOW },
    );

    // 순수 함수 레벨에서는 요청 조건 충족 (shouldRequest=true)
    expect(result.decision.shouldRequest).toBe(true);
  });
});

// ===========================================================================
// 진행 경로 (proceed path)
// ===========================================================================

describe('gatedReviewRequest — 진행 경로 (proceed path)', () => {
  it('11. 모든 조건 충족 + available=true → skipped=false', async () => {
    const requestReview = vi.fn(() => makeAvailableOutcome());

    const result = await gatedReviewRequest(
      makeValidInput(),
      { requestReview, now: () => FIXED_NOW },
    );

    expect(result.skipped).toBe(false);
  });

  it('12. 진행 경로에서 requestReview()가 정확히 1회 호출됨', async () => {
    const requestReview = vi.fn(() => makeAvailableOutcome());

    await gatedReviewRequest(
      makeValidInput(),
      { requestReview, now: () => FIXED_NOW },
    );

    expect(requestReview).toHaveBeenCalledTimes(1);
  });

  it('13. 진행 결과에 outcome과 decision이 포함됨', async () => {
    const requestReview = vi.fn(() => makeAvailableOutcome());

    const result = await gatedReviewRequest(
      makeValidInput(),
      { requestReview, now: () => FIXED_NOW },
    );

    expect(result.skipped).toBe(false);
    if (!result.skipped) {
      // outcome은 requestReview()의 반환 값
      expect(result.outcome.attempted).toBe(true);
      expect(result.outcome.available).toBe(true);
      // decision은 shouldRequestReview의 반환 값
      expect(result.decision.shouldRequest).toBe(true);
    }
  });
});

// ===========================================================================
// 결과 불변성 (frozen output)
// ===========================================================================

describe('gatedReviewRequest — 결과 불변성 (frozen output)', () => {
  it('14. 스킵 결과는 Object.freeze되어 있다', async () => {
    const requestReview = vi.fn(() => makeAvailableOutcome());

    const result = await gatedReviewRequest(
      makeValidInput({ hasPreviouslyRequested: true }),
      { requestReview, now: () => FIXED_NOW },
    );

    expect(Object.isFrozen(result)).toBe(true);
  });

  it('15. 진행 결과는 Object.freeze되어 있다', async () => {
    const requestReview = vi.fn(() => makeAvailableOutcome());

    const result = await gatedReviewRequest(
      makeValidInput(),
      { requestReview, now: () => FIXED_NOW },
    );

    expect(Object.isFrozen(result)).toBe(true);
  });
});

// ===========================================================================
// skippedAt 타임스탬프
// ===========================================================================

describe('gatedReviewRequest — skippedAt 타임스탬프', () => {
  it('16. now() 주입으로 skippedAt을 고정값으로 제어할 수 있다', async () => {
    const requestReview = vi.fn(() => makeAvailableOutcome());
    const pinned = '2026-01-01T00:00:00.000Z';

    const result = await gatedReviewRequest(
      makeValidInput({ hasPreviouslyRequested: true }),
      { requestReview, now: () => pinned },
    );

    expect(result.skipped).toBe(true);
    if (result.skipped) {
      expect(result.skippedAt).toBe(pinned);
    }
  });

  it('17. 진행 경로(skipped=false)에는 now()가 호출되지 않고 skippedAt 필드가 없다', async () => {
    const requestReview = vi.fn(() => makeAvailableOutcome());
    const nowSpy = vi.fn(() => FIXED_NOW);

    const result = await gatedReviewRequest(
      makeValidInput(),
      { requestReview, now: nowSpy },
    );

    // 진행 경로에서 now()가 호출되지 않아야 함
    expect(nowSpy).not.toHaveBeenCalled();
    // 타입 가드: skipped=false일 때 skippedAt 필드가 없음
    expect(result.skipped).toBe(false);
    expect('skippedAt' in result).toBe(false);
  });
});

// ===========================================================================
// 입력 검증 패스쓰루
// ===========================================================================

describe('gatedReviewRequest — 입력 검증 패스쓰루', () => {
  it('18. 유효하지 않은 입력은 shouldRequestReview의 에러를 그대로 전파한다', async () => {
    const requestReview = vi.fn(() => makeAvailableOutcome());

    // usageCount 음수 → shouldRequestReview가 ReviewRequestGateError throw
    await expect(
      gatedReviewRequest(
        { paymentCompleted: true, hasPreviouslyRequested: false, usageCount: -1 },
        { requestReview },
      ),
    ).rejects.toThrow();

    // 에러 발생 시 requestReview는 호출되지 않음
    expect(requestReview).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 타입 판별 (discriminated union 검증)
// ===========================================================================

describe('gatedReviewRequest — 타입 판별자 (discriminated union)', () => {
  it('스킵 결과는 skipped=true로 ReviewRequestSkipRecord로 좁혀진다', async () => {
    const requestReview = vi.fn(() => makeAvailableOutcome());

    const result: GatedReviewRequestResult = await gatedReviewRequest(
      makeValidInput({ hasPreviouslyRequested: true }),
      { requestReview, now: () => FIXED_NOW },
    );

    if (result.skipped === true) {
      // 타입 시스템이 ReviewRequestSkipRecord로 좁혀짐
      const skipRecord: ReviewRequestSkipRecord = result;
      expect(skipRecord.reason).toBe('already_requested');
      expect(typeof skipRecord.skippedAt).toBe('string');
      expect(typeof skipRecord.decision).toBe('object');
    } else {
      // 이 분기에 도달하면 테스트 실패
      throw new Error('Expected skipped=true but got skipped=false');
    }
  });

  it('진행 결과는 skipped=false로 좁혀지며 outcome과 decision을 포함한다', async () => {
    const requestReview = vi.fn(() => makeAvailableOutcome());

    const result: GatedReviewRequestResult = await gatedReviewRequest(
      makeValidInput(),
      { requestReview, now: () => FIXED_NOW },
    );

    if (result.skipped === false) {
      expect(result.outcome.available).toBe(true);
      expect(result.decision.shouldRequest).toBe(true);
    } else {
      throw new Error('Expected skipped=false but got skipped=true');
    }
  });
});

// ===========================================================================
// 통합 시나리오: 3가지 스킵 + 1가지 진행 시퀀스
// ===========================================================================

describe('gatedReviewRequest — 통합 시나리오: 순서대로 3 스킵 + 1 진행', () => {
  let requestReview: ReturnType<
    typeof vi.fn<[], ReturnType<typeof makeAvailableOutcome>>
  >;

  beforeEach(() => {
    requestReview = vi
      .fn<[], ReturnType<typeof makeAvailableOutcome>>()
      .mockImplementationOnce(() => makeUnavailableOutcome()) // 3번째: apple_annual_limit
      .mockImplementationOnce(() => makeAvailableOutcome());  // 4번째: proceed
  });

  it('이미 요청됨 → 조건 미충족 → Apple 연간 초과 → 진행 순서로 올바른 결과 반환', async () => {
    // 1. 이미 요청됨
    const r1 = await gatedReviewRequest(
      makeValidInput({ hasPreviouslyRequested: true }),
      { requestReview, now: () => FIXED_NOW },
    );
    expect(r1.skipped).toBe(true);
    if (r1.skipped) expect(r1.reason).toBe('already_requested');

    // 2. 조건 미충족 (결제 미완료)
    const r2 = await gatedReviewRequest(
      makeValidInput({ paymentCompleted: false }),
      { requestReview, now: () => FIXED_NOW },
    );
    expect(r2.skipped).toBe(true);
    if (r2.skipped) expect(r2.reason).toBe('conditions_not_met');

    // 조건 1, 2에서는 requestReview 호출 없음
    expect(requestReview).toHaveBeenCalledTimes(0);

    // 3. Apple 연간 횟수 초과
    const r3 = await gatedReviewRequest(
      makeValidInput(),
      { requestReview, now: () => FIXED_NOW },
    );
    expect(r3.skipped).toBe(true);
    if (r3.skipped) expect(r3.reason).toBe('apple_annual_limit');
    expect(requestReview).toHaveBeenCalledTimes(1);

    // 4. 진행
    const r4 = await gatedReviewRequest(
      makeValidInput(),
      { requestReview, now: () => FIXED_NOW },
    );
    expect(r4.skipped).toBe(false);
    expect(requestReview).toHaveBeenCalledTimes(2);
  });
});
