/**
 * expiry-transition.ts — 타이머 만료 이벤트 → 결제 깔때기 상태 전환 (Sub-AC 14c-2)
 *
 * 순수 함수형 타이머 만료 전이 모델.
 * 카운트다운 타이머가 만료될 때 결제 깔때기 상태에 적용되어야 하는
 * 모든 전이를 원자적으로 처리하여 새 불변 상태를 반환한다.
 *
 * ## 처리하는 전이 케이스
 *
 *   1. **긴급 오퍼 무효화** (`urgentOfferActive: true → false`)
 *      타이머 만료 시 한정 오퍼 기간이 끝났으므로 오퍼 활성 플래그를 꺼야 한다.
 *
 *   2. **희소성 플래그 초기화** (`scarcityFlagCount: N → 0`)
 *      타이머 만료 시 "N자리 남음" 등 희소성 표시 카운트를 0으로 초기화한다.
 *
 *   3. **단계 전환** (`step: N → N+1`, auto-advance 단계에서만)
 *      `AUTO_ADVANCE_STEPS` (5, 8)에 해당하는 단계에서 타이머 만료 시
 *      다음 단계로 자동 진입한다.
 *      - step 5 (`fake_loader`, 5초 로더): 단계 완료 → step 6 진입
 *      - step 8 (`fake_scan_animation`, 5초 스캔 애니메이션): step 9 진입
 *
 * ## 설계 원칙
 *
 *   1. 순수 함수 (Pure function): 동일 입력 → 동일 출력. 외부 상태·I/O 없음.
 *   2. 불변성 (Immutability): 반환 객체는 `Object.freeze`로 고정된 새 인스턴스.
 *   3. No-op guard: `status !== 'active'`이면 동일 참조를 반환한다.
 *      (완료·이탈·미시작 퍼널에서는 타이머 만료가 의미 없음)
 *   4. 원자성: 모든 전이가 단일 호출에서 동시에 반영된다.
 *
 * ## `countdown-timer.ts`와의 관계
 *
 * `countdown-timer.ts` (Sub-AC 14c-1)는 타이머 상태(`TimerState`)를 관리하고
 * 만료 여부(`isExpired`)를 판단한다.
 * 이 모듈은 "만료가 확인된 후" 퍼널 상태에 적용할 전이 로직을 담당한다.
 *
 * 호출 흐름:
 *   isExpired(timer, now) === true
 *     → applyExpiryTransition(funnelState)
 *     → 새 funnelState 반환
 */

import type { FunnelStatusValue } from './funnel-state.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * 타이머 만료 전이 로직이 조작하는 결제 깔때기 상태.
 *
 * 핵심 퍼널 위치(`step`, `status`) + 긴급성·희소성 메타데이터로 구성된다.
 * 불변(readonly) 필드만 포함하여 accidental mutation을 방지한다.
 */
export interface PaymentFunnelExpiryState {
  /**
   * 현재 단계 번호 (0-12).
   * 0 = 퍼널 진입 전 (idle), 1–12 = 각 단계, 12 = 결제 단계.
   */
  readonly step: number;

  /**
   * 퍼널 진행 상태.
   * 'idle' | 'active' | 'completed' | 'abandoned'
   */
  readonly status: FunnelStatusValue;

  /**
   * 긴급 오퍼 활성 여부.
   * 타이머 기반 한정 오퍼가 현재 노출 중이면 `true`.
   * 타이머 만료 시 `false`로 전환된다 (긴급 오퍼 무효화).
   */
  readonly urgentOfferActive: boolean;

  /**
   * 희소성 카운트 (예: "3자리 남음").
   * 0 이상의 정수; 0 = 희소성 UI 미노출.
   * 타이머 만료 시 0으로 초기화된다 (희소성 플래그 초기화).
   */
  readonly scarcityFlagCount: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * 타이머 만료 시 자동으로 다음 단계로 진입하는 단계 번호 집합.
 *
 * - 5: `fake_loader` (5초 가짜 로더, price_anchoring 자리)
 *   → 타이머 완료 시 step 6(`scan_option_select`)으로 자동 진입.
 * - 8: `fake_scan_animation` (5초 셀카 스캔 애니메이션)
 *   → 타이머 완료 시 step 9(`result_reveal`)으로 자동 진입.
 *
 * 두 단계 모두 `screens.ts`에서 `autoAdvance: true, action: 'auto_advance'`로
 * 선언되어 있어 사용자 CTA 없이 타이머가 전진을 구동한다.
 */
export const AUTO_ADVANCE_STEPS: ReadonlySet<number> = new Set([5, 8]);

/**
 * 최대 유효 단계 번호 (12단계 = payment_model).
 * 이 단계 이후로는 자동 진입이 발생하지 않는다.
 */
export const EXPIRY_MAX_STEP = 12 as const;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * `applyExpiryTransition(state)` — 타이머 만료 이벤트 → 퍼널 상태 전환 순수 함수.
 *
 * 카운트다운 타이머가 만료되었을 때 현재 퍼널 상태에 적용할 모든 전이를
 * 원자적으로 처리하고 새 불변 상태를 반환한다.
 *
 * ## 전이 규칙 (전이 적용 순서)
 *
 *   1. `status !== 'active'` → **no-op**: 동일 참조 반환.
 *      (idle / completed / abandoned 상태에서는 타이머 만료가 의미 없음)
 *
 *   2. `urgentOfferActive` → `false` (**긴급 오퍼 무효화**).
 *      오퍼 기간 종료. 이미 `false`여도 `false`를 유지한다.
 *
 *   3. `scarcityFlagCount` → `0` (**희소성 플래그 초기화**).
 *      타이머 만료로 희소성 카운트를 초기화한다. 이미 0이어도 0을 유지한다.
 *
 *   4. `step ∈ AUTO_ADVANCE_STEPS && step < EXPIRY_MAX_STEP`
 *      → `step + 1` (**단계 전환**).
 *      auto-advance 단계에서만 자동 전진; 그 외 단계는 step 유지.
 *
 * ## 경계값 동작
 *
 *   | 상태                               | 결과                        |
 *   | ---------------------------------- | --------------------------- |
 *   | status === 'idle'                  | 동일 참조 반환 (no-op)      |
 *   | status === 'completed'             | 동일 참조 반환 (no-op)      |
 *   | status === 'abandoned'             | 동일 참조 반환 (no-op)      |
 *   | status === 'active', step 5        | step → 6, offers cleared    |
 *   | status === 'active', step 8        | step → 9, offers cleared    |
 *   | status === 'active', step 12       | step 유지, offers cleared   |
 *   | urgentOfferActive: true            | false                       |
 *   | urgentOfferActive: false (이미)     | false (변화 없음)           |
 *   | scarcityFlagCount: N > 0           | 0                           |
 *   | scarcityFlagCount: 0 (이미)         | 0 (변화 없음)              |
 *
 * @param state - 현재 퍼널 상태 (불변 `PaymentFunnelExpiryState`).
 * @returns 새 불변 `PaymentFunnelExpiryState` (전이 후 상태),
 *          또는 동일 참조 (no-op 경우 — `status !== 'active'`).
 *
 * @example
 * ```ts
 * // 긴급 오퍼 무효화 + 희소성 초기화 (step 12에서)
 * const before = Object.freeze({
 *   step: 12, status: 'active',
 *   urgentOfferActive: true, scarcityFlagCount: 3,
 * });
 * const after = applyExpiryTransition(before);
 * // → { step: 12, status: 'active', urgentOfferActive: false, scarcityFlagCount: 0 }
 *
 * // 단계 전환 (step 5 auto-advance)
 * const loader = Object.freeze({
 *   step: 5, status: 'active',
 *   urgentOfferActive: false, scarcityFlagCount: 0,
 * });
 * const advanced = applyExpiryTransition(loader);
 * // → { step: 6, status: 'active', urgentOfferActive: false, scarcityFlagCount: 0 }
 * ```
 */
export function applyExpiryTransition(
  state: PaymentFunnelExpiryState,
): PaymentFunnelExpiryState {
  // Rule 1 — no-op guard: terminal and idle states do not respond to timer expiry.
  if (state.status !== 'active') {
    return state;
  }

  // Rule 4 — 단계 전환: auto-advance steps move to the next step on expiry.
  const nextStep =
    AUTO_ADVANCE_STEPS.has(state.step) && state.step < EXPIRY_MAX_STEP
      ? state.step + 1
      : state.step;

  // Rules 2 & 3 — 긴급 오퍼 무효화 + 희소성 플래그 초기화 always applied.
  return Object.freeze<PaymentFunnelExpiryState>({
    step: nextStep,
    status: state.status, // 'active' — unchanged; auto-advance keeps funnel active
    urgentOfferActive: false, // 긴급 오퍼 무효화
    scarcityFlagCount: 0, // 희소성 플래그 초기화
  });
}
