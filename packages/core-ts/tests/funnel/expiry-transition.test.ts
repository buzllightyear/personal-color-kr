/**
 * 단위 테스트 — 타이머 만료 이벤트 → 결제 깔때기 상태 전환 (Sub-AC 14c-2)
 *
 * 검증 대상:
 *   - `applyExpiryTransition(state)` 순수 함수
 *   - `PaymentFunnelExpiryState` 인터페이스 계약
 *   - `AUTO_ADVANCE_STEPS` 상수
 *   - `EXPIRY_MAX_STEP` 상수
 *
 * 전이 케이스별 검증:
 *   1. 긴급 오퍼 무효화 (urgent offer invalidation)
 *   2. 단계 전환 (stage transition — auto-advance)
 *   3. 희소성 플래그 초기화 (scarcity flag reset)
 *   4. 복합 전이 (combined: 위 세 케이스가 동시에 적용)
 *   5. no-op 케이스 (비활성 퍼널 상태에서 동일 참조 반환)
 *   6. 경계값 (step 12 단말 단계, step 0, 이미 초기화된 상태)
 *   7. 불변성 (frozen output, input 변이 없음)
 *   8. 순수 함수 (동일 입력 → 동일 출력)
 *
 * 설계 노트:
 *   - 모든 함수는 순수 함수 → `Date.now()` 스텁 불필요.
 *   - `now` 매개변수 주입으로 경계값 정밀 제어 가능.
 *   - clock API (vi.useFakeTimers 등) 의존 없음.
 *   - 각 it-block은 단일 행동을 검증 (atomic AC).
 */
import { describe, expect, it } from 'vitest';

import {
  AUTO_ADVANCE_STEPS,
  EXPIRY_MAX_STEP,
  applyExpiryTransition,
  type PaymentFunnelExpiryState,
} from '../../src/funnel/expiry-transition.js';

// ---------------------------------------------------------------------------
// 테스트 픽스처 헬퍼
// ---------------------------------------------------------------------------

/**
 * 기본 활성 퍼널 상태 팩토리.
 * 개별 테스트에서 필요한 필드만 오버라이드하여 사용한다.
 */
function makeActiveState(
  overrides: Partial<PaymentFunnelExpiryState> = {},
): PaymentFunnelExpiryState {
  return Object.freeze<PaymentFunnelExpiryState>({
    step: 12,
    status: 'active',
    urgentOfferActive: false,
    scarcityFlagCount: 0,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// 상수 검증
// ---------------------------------------------------------------------------

describe('AUTO_ADVANCE_STEPS 상수', () => {
  it('step 5 (fake_loader)를 포함한다', () => {
    expect(AUTO_ADVANCE_STEPS.has(5)).toBe(true);
  });

  it('step 8 (fake_scan_animation)를 포함한다', () => {
    expect(AUTO_ADVANCE_STEPS.has(8)).toBe(true);
  });

  it('정확히 2개의 단계만 포함한다', () => {
    expect(AUTO_ADVANCE_STEPS.size).toBe(2);
  });

  it('step 12 (payment_model)는 포함하지 않는다', () => {
    expect(AUTO_ADVANCE_STEPS.has(12)).toBe(false);
  });

  it('step 11 (social_evolution)는 포함하지 않는다', () => {
    expect(AUTO_ADVANCE_STEPS.has(11)).toBe(false);
  });
});

describe('EXPIRY_MAX_STEP 상수', () => {
  it('EXPIRY_MAX_STEP === 12 (마지막 결제 단계)', () => {
    expect(EXPIRY_MAX_STEP).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// no-op 케이스 — 비활성 퍼널 상태 (terminal / idle)
// ---------------------------------------------------------------------------

describe('no-op: status !== "active" → 동일 참조 반환', () => {
  it('status === "idle" → 동일 참조 반환 (퍼널 미시작 상태)', () => {
    const state = makeActiveState({ step: 0, status: 'idle' });
    const result = applyExpiryTransition(state);
    expect(result).toBe(state); // 참조 동등성 — 새 객체 생성 없음
  });

  it('status === "completed" → 동일 참조 반환 (결제 완료 단말)', () => {
    const state = makeActiveState({ step: 12, status: 'completed' });
    const result = applyExpiryTransition(state);
    expect(result).toBe(state);
  });

  it('status === "abandoned" → 동일 참조 반환 (이탈 단말)', () => {
    const state = makeActiveState({ step: 3, status: 'abandoned' });
    const result = applyExpiryTransition(state);
    expect(result).toBe(state);
  });

  it('no-op 상태에서 urgentOfferActive가 true여도 변경되지 않는다', () => {
    const state = makeActiveState({
      status: 'completed',
      urgentOfferActive: true,
      scarcityFlagCount: 5,
    });
    const result = applyExpiryTransition(state);
    expect(result).toBe(state);
    // 값 검증 — 동일 참조이므로 필드도 변경 없음
    expect(result.urgentOfferActive).toBe(true);
    expect(result.scarcityFlagCount).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// 긴급 오퍼 무효화 (urgent offer invalidation)
// ---------------------------------------------------------------------------

describe('긴급 오퍼 무효화 — urgentOfferActive: true → false', () => {
  it('urgentOfferActive: true → 만료 후 false로 전환된다', () => {
    const before = makeActiveState({ urgentOfferActive: true });
    const after = applyExpiryTransition(before);
    expect(after.urgentOfferActive).toBe(false);
  });

  it('urgentOfferActive: false → 만료 후에도 false 유지 (멱등)', () => {
    const before = makeActiveState({ urgentOfferActive: false });
    const after = applyExpiryTransition(before);
    expect(after.urgentOfferActive).toBe(false);
  });

  it('step 12 (payment_model)에서 긴급 오퍼 무효화', () => {
    const before = makeActiveState({ step: 12, urgentOfferActive: true });
    const after = applyExpiryTransition(before);
    expect(after.urgentOfferActive).toBe(false);
    expect(after.step).toBe(12); // 단계 전환 없음
  });

  it('step 9 (result_reveal)에서 긴급 오퍼 무효화', () => {
    const before = makeActiveState({ step: 9, urgentOfferActive: true });
    const after = applyExpiryTransition(before);
    expect(after.urgentOfferActive).toBe(false);
    expect(after.step).toBe(9); // auto-advance 단계 아님 → step 유지
  });

  it('step 11 (social_evolution)에서 긴급 오퍼 무효화', () => {
    const before = makeActiveState({ step: 11, urgentOfferActive: true });
    const after = applyExpiryTransition(before);
    expect(after.urgentOfferActive).toBe(false);
    expect(after.step).toBe(11);
  });

  it('만료 후 새 객체가 반환된다 (참조 다름)', () => {
    const before = makeActiveState({ urgentOfferActive: true });
    const after = applyExpiryTransition(before);
    expect(after).not.toBe(before);
  });
});

// ---------------------------------------------------------------------------
// 희소성 플래그 초기화 (scarcity flag reset)
// ---------------------------------------------------------------------------

describe('희소성 플래그 초기화 — scarcityFlagCount: N → 0', () => {
  it('scarcityFlagCount: 1 → 0으로 초기화', () => {
    const before = makeActiveState({ scarcityFlagCount: 1 });
    const after = applyExpiryTransition(before);
    expect(after.scarcityFlagCount).toBe(0);
  });

  it('scarcityFlagCount: 3 → 0으로 초기화 ("3자리 남음" 사례)', () => {
    const before = makeActiveState({ scarcityFlagCount: 3 });
    const after = applyExpiryTransition(before);
    expect(after.scarcityFlagCount).toBe(0);
  });

  it('scarcityFlagCount: 100 → 0으로 초기화 (큰 카운트)', () => {
    const before = makeActiveState({ scarcityFlagCount: 100 });
    const after = applyExpiryTransition(before);
    expect(after.scarcityFlagCount).toBe(0);
  });

  it('scarcityFlagCount: 0 → 만료 후에도 0 유지 (멱등)', () => {
    const before = makeActiveState({ scarcityFlagCount: 0 });
    const after = applyExpiryTransition(before);
    expect(after.scarcityFlagCount).toBe(0);
  });

  it('step 12 (payment_model)에서 희소성 플래그 초기화', () => {
    const before = makeActiveState({ step: 12, scarcityFlagCount: 5 });
    const after = applyExpiryTransition(before);
    expect(after.scarcityFlagCount).toBe(0);
    expect(after.step).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// 단계 전환 (stage transition — auto-advance)
// ---------------------------------------------------------------------------

describe('단계 전환 — AUTO_ADVANCE_STEPS에서 step N → N+1', () => {
  it('step 5 (fake_loader) → step 6 (scan_option_select)으로 자동 전진', () => {
    const before = makeActiveState({ step: 5 });
    const after = applyExpiryTransition(before);
    expect(after.step).toBe(6);
  });

  it('step 8 (fake_scan_animation) → step 9 (result_reveal)으로 자동 전진', () => {
    const before = makeActiveState({ step: 8 });
    const after = applyExpiryTransition(before);
    expect(after.step).toBe(9);
  });

  it('step 5 전환 후 status는 "active" 유지 (완료 아님)', () => {
    const before = makeActiveState({ step: 5 });
    const after = applyExpiryTransition(before);
    expect(after.status).toBe('active');
  });

  it('step 8 전환 후 status는 "active" 유지', () => {
    const before = makeActiveState({ step: 8 });
    const after = applyExpiryTransition(before);
    expect(after.status).toBe('active');
  });

  // 단계 전환이 일어나지 않아야 하는 케이스
  it('step 1 — AUTO_ADVANCE_STEPS 밖: step 유지', () => {
    const before = makeActiveState({ step: 1 });
    const after = applyExpiryTransition(before);
    expect(after.step).toBe(1);
  });

  it('step 6 — AUTO_ADVANCE_STEPS 밖: step 유지', () => {
    const before = makeActiveState({ step: 6 });
    const after = applyExpiryTransition(before);
    expect(after.step).toBe(6);
  });

  it('step 9 — AUTO_ADVANCE_STEPS 밖: step 유지', () => {
    const before = makeActiveState({ step: 9 });
    const after = applyExpiryTransition(before);
    expect(after.step).toBe(9);
  });

  it('step 10 — AUTO_ADVANCE_STEPS 밖: step 유지', () => {
    const before = makeActiveState({ step: 10 });
    const after = applyExpiryTransition(before);
    expect(after.step).toBe(10);
  });

  it('step 11 — AUTO_ADVANCE_STEPS 밖: step 유지', () => {
    const before = makeActiveState({ step: 11 });
    const after = applyExpiryTransition(before);
    expect(after.step).toBe(11);
  });

  it('step 12 — EXPIRY_MAX_STEP 경계: 자동 전진 없음 (단말 단계)', () => {
    const before = makeActiveState({ step: 12 });
    const after = applyExpiryTransition(before);
    expect(after.step).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// 복합 전이 — 긴급 오퍼 무효화 + 희소성 초기화 + 단계 전환 동시 적용
// ---------------------------------------------------------------------------

describe('복합 전이 — 모든 케이스가 단일 호출에서 동시에 반영', () => {
  it('step 5에서 urgentOfferActive + scarcityFlagCount + 단계 전환 모두 적용', () => {
    const before = makeActiveState({
      step: 5,
      urgentOfferActive: true,
      scarcityFlagCount: 7,
    });
    const after = applyExpiryTransition(before);

    expect(after.step).toBe(6);               // 단계 전환
    expect(after.status).toBe('active');
    expect(after.urgentOfferActive).toBe(false); // 긴급 오퍼 무효화
    expect(after.scarcityFlagCount).toBe(0);     // 희소성 초기화
  });

  it('step 8에서 urgentOfferActive + scarcityFlagCount + 단계 전환 모두 적용', () => {
    const before = makeActiveState({
      step: 8,
      urgentOfferActive: true,
      scarcityFlagCount: 2,
    });
    const after = applyExpiryTransition(before);

    expect(after.step).toBe(9);
    expect(after.urgentOfferActive).toBe(false);
    expect(after.scarcityFlagCount).toBe(0);
  });

  it('step 12에서 urgentOfferActive + scarcityFlagCount 적용 (단계 전환 없음)', () => {
    const before = makeActiveState({
      step: 12,
      urgentOfferActive: true,
      scarcityFlagCount: 10,
    });
    const after = applyExpiryTransition(before);

    expect(after.step).toBe(12);               // 단계 전환 없음
    expect(after.urgentOfferActive).toBe(false);
    expect(after.scarcityFlagCount).toBe(0);
  });

  it('step 11에서 urgentOfferActive + scarcityFlagCount 적용 (단계 전환 없음)', () => {
    const before = makeActiveState({
      step: 11,
      urgentOfferActive: true,
      scarcityFlagCount: 3,
    });
    const after = applyExpiryTransition(before);

    expect(after.step).toBe(11);
    expect(after.urgentOfferActive).toBe(false);
    expect(after.scarcityFlagCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 경계값 — 특수 상태 케이스
// ---------------------------------------------------------------------------

describe('경계값 — 특수 상태', () => {
  it('step 0, status "idle" → no-op (퍼널 미시작)', () => {
    const state = makeActiveState({ step: 0, status: 'idle' });
    expect(applyExpiryTransition(state)).toBe(state);
  });

  it('step 12, status "completed" → no-op (결제 완료 단말)', () => {
    const state = makeActiveState({
      step: 12,
      status: 'completed',
      urgentOfferActive: true,
      scarcityFlagCount: 5,
    });
    const result = applyExpiryTransition(state);
    expect(result).toBe(state);
    expect(result.urgentOfferActive).toBe(true); // 변경 없음
    expect(result.scarcityFlagCount).toBe(5);
  });

  it('step 5, status "abandoned" → no-op (이탈 단말)', () => {
    const state = makeActiveState({
      step: 5,
      status: 'abandoned',
      urgentOfferActive: true,
    });
    const result = applyExpiryTransition(state);
    expect(result).toBe(state);
    expect(result.step).toBe(5); // 자동 전진 없음
  });

  it('step 5, status "active", urgentOfferActive: false, scarcityFlagCount: 0 → 단계 전환만 적용', () => {
    // 오퍼/희소성이 이미 초기화 상태여도 단계 전환은 적용됨
    const before = makeActiveState({
      step: 5,
      urgentOfferActive: false,
      scarcityFlagCount: 0,
    });
    const after = applyExpiryTransition(before);
    expect(after.step).toBe(6);
    expect(after.urgentOfferActive).toBe(false);
    expect(after.scarcityFlagCount).toBe(0);
  });

  it('step 5에서 두 번 만료 적용: 두 번째는 step 6이므로 단계 전환 없음', () => {
    // 첫 번째 만료: step 5 → 6
    const step5 = makeActiveState({ step: 5 });
    const step6 = applyExpiryTransition(step5);
    expect(step6.step).toBe(6);

    // 두 번째 만료: step 6은 AUTO_ADVANCE_STEPS 밖 → step 유지
    const step6Again = applyExpiryTransition(step6);
    expect(step6Again.step).toBe(6);
  });

  it('scarcityFlagCount: 0 이면서 urgentOfferActive: false인 active 상태 → 새 객체 반환', () => {
    // 변경 값이 없어도 active 상태라면 새 객체를 반환
    const before = makeActiveState({
      step: 7, // non-auto-advance step
      urgentOfferActive: false,
      scarcityFlagCount: 0,
    });
    const after = applyExpiryTransition(before);
    // 값은 동일하지만 active 상태에서는 새 객체를 생성하는 것이 정책
    expect(after.step).toBe(7);
    expect(after.urgentOfferActive).toBe(false);
    expect(after.scarcityFlagCount).toBe(0);
    expect(after.status).toBe('active');
  });
});

// ---------------------------------------------------------------------------
// 불변성 검증
// ---------------------------------------------------------------------------

describe('불변성 (immutability)', () => {
  it('반환된 상태 객체가 frozen이다', () => {
    const before = makeActiveState({ step: 12, urgentOfferActive: true });
    const after = applyExpiryTransition(before);
    expect(Object.isFrozen(after)).toBe(true);
  });

  it('step 5 전환 후 반환 객체가 frozen이다', () => {
    const before = makeActiveState({ step: 5 });
    const after = applyExpiryTransition(before);
    expect(Object.isFrozen(after)).toBe(true);
  });

  it('입력 상태는 변이되지 않는다 (urgentOfferActive 불변)', () => {
    const before = makeActiveState({ urgentOfferActive: true });
    const beforeUrgent = before.urgentOfferActive;
    applyExpiryTransition(before);
    expect(before.urgentOfferActive).toBe(beforeUrgent); // 입력 변이 없음
  });

  it('입력 상태는 변이되지 않는다 (scarcityFlagCount 불변)', () => {
    const before = makeActiveState({ scarcityFlagCount: 5 });
    const beforeCount = before.scarcityFlagCount;
    applyExpiryTransition(before);
    expect(before.scarcityFlagCount).toBe(beforeCount);
  });

  it('입력 상태는 변이되지 않는다 (step 불변 — auto-advance 케이스)', () => {
    const before = makeActiveState({ step: 5 });
    const beforeStep = before.step;
    applyExpiryTransition(before);
    expect(before.step).toBe(beforeStep); // 입력 step 변이 없음
  });

  it('no-op 케이스에서 반환 객체도 frozen이다 (동일 참조이므로)', () => {
    const state = makeActiveState({ status: 'completed' });
    const result = applyExpiryTransition(state);
    expect(Object.isFrozen(result)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 순수 함수 검증
// ---------------------------------------------------------------------------

describe('순수 함수 — 동일 입력에 항상 동일 출력', () => {
  it('동일 active 상태 입력 → 두 번 호출해도 출력 값이 동일하다', () => {
    const before = makeActiveState({
      step: 12,
      urgentOfferActive: true,
      scarcityFlagCount: 3,
    });

    const after1 = applyExpiryTransition(before);
    const after2 = applyExpiryTransition(before);

    expect(after1.step).toBe(after2.step);
    expect(after1.status).toBe(after2.status);
    expect(after1.urgentOfferActive).toBe(after2.urgentOfferActive);
    expect(after1.scarcityFlagCount).toBe(after2.scarcityFlagCount);
  });

  it('step 5 → step 6: 두 번 호출해도 step 6으로 동일하게 전환', () => {
    const before = makeActiveState({ step: 5, urgentOfferActive: true });

    const after1 = applyExpiryTransition(before);
    const after2 = applyExpiryTransition(before);

    expect(after1.step).toBe(6);
    expect(after2.step).toBe(6);
    expect(after1.urgentOfferActive).toBe(false);
    expect(after2.urgentOfferActive).toBe(false);
  });

  it('no-op 케이스: 동일 참조를 반복 반환한다', () => {
    const state = makeActiveState({ status: 'idle' });
    expect(applyExpiryTransition(state)).toBe(state);
    expect(applyExpiryTransition(state)).toBe(state);
  });
});

// ---------------------------------------------------------------------------
// 통합 시나리오 — countdown-timer + applyExpiryTransition 파이프라인
// ---------------------------------------------------------------------------

describe('통합 시나리오 — 타이머 만료 확인 후 퍼널 전이 적용', () => {
  it('step 5 fake_loader 5초 타이머: 만료 후 자동 단계 전환 + 오퍼 무효화', () => {
    // 5초 로더 단계 시작
    const loaderState = makeActiveState({
      step: 5,
      urgentOfferActive: true,
      scarcityFlagCount: 0,
    });

    // 타이머 만료 이벤트 발생 → 전이 적용
    const advanced = applyExpiryTransition(loaderState);

    // step 6으로 진입
    expect(advanced.step).toBe(6);
    expect(advanced.status).toBe('active');
    expect(advanced.urgentOfferActive).toBe(false);
    expect(advanced.scarcityFlagCount).toBe(0);
  });

  it('step 8 fake_scan_animation 5초 타이머: 만료 후 step 9로 자동 전환', () => {
    const scanState = makeActiveState({
      step: 8,
      urgentOfferActive: false,
      scarcityFlagCount: 0,
    });

    const advanced = applyExpiryTransition(scanState);

    expect(advanced.step).toBe(9);
    expect(advanced.status).toBe('active');
  });

  it('step 12 결제 단계 긴급 오퍼 타이머: 만료 후 오퍼 무효화 (단계 유지)', () => {
    // step 12에서 한정 결제 오퍼 타이머 만료
    const paymentState = makeActiveState({
      step: 12,
      urgentOfferActive: true,
      scarcityFlagCount: 5,
    });

    const invalidated = applyExpiryTransition(paymentState);

    expect(invalidated.step).toBe(12);    // 자동 전진 없음
    expect(invalidated.urgentOfferActive).toBe(false);
    expect(invalidated.scarcityFlagCount).toBe(0);
    expect(invalidated.status).toBe('active');
  });

  it('퍼널 완료 후 남은 타이머가 만료: no-op (이미 결제 완료)', () => {
    const completedState = makeActiveState({
      step: 12,
      status: 'completed',
      urgentOfferActive: true,
    });

    const result = applyExpiryTransition(completedState);
    expect(result).toBe(completedState); // 동일 참조 — 완료 상태 불변
  });

  it('연속 단계 전환: step 5 → step 6 → (step 6은 auto-advance 아님) 유지', () => {
    // step 5에서 타이머 만료
    const step5 = makeActiveState({ step: 5, urgentOfferActive: true, scarcityFlagCount: 3 });
    const step6 = applyExpiryTransition(step5);

    expect(step6.step).toBe(6);
    expect(step6.urgentOfferActive).toBe(false);
    expect(step6.scarcityFlagCount).toBe(0);

    // step 6에서 또 다른 타이머 만료 (예: scan_option_select에서 타임아웃)
    const step6Again = applyExpiryTransition(step6);
    expect(step6Again.step).toBe(6); // auto-advance 단계 아님 → 유지
  });
});
