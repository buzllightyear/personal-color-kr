/**
 * `createFunnelState` — 팩토리 함수 (Sub-AC 1)
 *
 * Glam Up 12단계 결제 깔때기의 초기 상태 객체를 반환하는 순수 함수.
 *
 * - `step: 0`     — 아직 어떤 단계도 시작하지 않은 상태.
 * - `status: 'idle'` — 퍼널이 아직 진입 전임을 나타냄.
 *
 * 설계 원칙:
 *   1. 순수 함수 (Pure function): 인자·외부 상태 없음, 동일 입력 → 동일 출력.
 *   2. 불변(Immutable) 반환: `Object.freeze`로 반환 객체를 고정하여 후방 코드가
 *      직접 수정하는 실수를 런타임에서 조기 차단한다.
 *   3. 최소 shape: 이 팩토리는 *초기* 상태만 책임지며, 상태 전이(transition)는
 *      `state-machine.ts`의 `advanceStep` / `skipStep` 등에 위임한다.
 *      두 모듈을 분리함으로써 "초기화 로직"과 "전이 로직"의 책임 경계가 명확해진다.
 *
 * `FunnelStatusValue` union 설계:
 *   - 'idle'      — 시작 전 (초기값, step === 0)
 *   - 'active'    — 1단계 이상 진행 중 (step 1–12)
 *   - 'completed' — 결제 완료 (step 12 통과)
 *   - 'abandoned' — 사용자 이탈
 *
 * 이 파일에는 런타임 값만 export한다. 타입 선언은 consumers가 import type으로
 * 가져갈 수 있도록 함께 export한다.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Funnel status — 퍼널 진행 상태를 나타내는 string literal union.
 *
 * - 'idle'      — 퍼널 진입 전 (초기 상태)
 * - 'active'    — 1단계 이상 진행 중
 * - 'completed' — 결제 완료 (12단계 통과)
 * - 'abandoned' — 사용자 이탈
 */
export type FunnelStatusValue = 'idle' | 'active' | 'completed' | 'abandoned';

/**
 * 퍼널 상태 객체 shape.
 *
 * - `step`   — 현재 단계 번호 (0 = 시작 전, 1–12 = 각 단계)
 * - `status` — 퍼널 진행 상태 {@link FunnelStatusValue}
 */
export interface FunnelStateObject {
  readonly step: number;
  readonly status: FunnelStatusValue;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * 퍼널 초기 상태 객체를 반환하는 순수 팩토리 함수 (Sub-AC 1).
 *
 * @returns 불변(frozen) 초기 상태 `{ step: 0, status: 'idle' }`.
 *
 * @example
 * ```ts
 * const state = createFunnelState();
 * // => { step: 0, status: 'idle' }
 * ```
 */
export function createFunnelState(): FunnelStateObject {
  return Object.freeze<FunnelStateObject>({ step: 0, status: 'idle' });
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Total number of funnel steps (12단계). */
const TOTAL_STEPS = 12 as const;

// ---------------------------------------------------------------------------
// Transition — advance (Sub-AC 2)
// ---------------------------------------------------------------------------

/**
 * `advance(state)` — 전진 전이 순수 함수 (Sub-AC 2).
 *
 * Glam Up 12단계 결제 깔때기의 forward-only step 전이 로직.
 * 항상 새 불변 객체를 반환하며, 입력 상태를 변이하지 않는다.
 *
 * 전이 규칙:
 *   - `status === 'completed'`  → 무효(no-op): 동일 상태 반환 (완료 후 추가 advance 방지)
 *   - `step < TOTAL_STEPS`     → `{ step: step + 1, status: 'active' }` (0→1 포함)
 *   - `step === TOTAL_STEPS`   → `{ step: TOTAL_STEPS, status: 'completed' }` (12→완료)
 *
 * 경계값:
 *   - 0 → 1     : idle 상태에서 첫 번째 단계 진입
 *   - 11 → 12   : 12번째 단계 진입 (step+1)
 *   - 12 → 완료  : status 'completed' 전환 (step 유지)
 *   - 완료 → 무효 : 이미 완료된 퍼널에서 추가 advance 금지(no-op)
 *
 * @param state - 현재 퍼널 상태 (불변 {@link FunnelStateObject})
 * @returns 새 불변 `FunnelStateObject` (전이 후 상태)
 *
 * @example
 * ```ts
 * const s0 = createFunnelState();          // { step: 0, status: 'idle' }
 * const s1 = advance(s0);                  // { step: 1, status: 'active' }
 * const s12 = advance({ step: 11, status: 'active' }); // { step: 12, status: 'active' }
 * const done = advance({ step: 12, status: 'active' }); // { step: 12, status: 'completed' }
 * const noop = advance(done);              // { step: 12, status: 'completed' } (unchanged)
 * ```
 */
export function advance(state: FunnelStateObject): FunnelStateObject {
  // No-op guard: completed state is a dead end — further advances are silently ignored.
  if (state.status === 'completed') {
    return state;
  }

  // Step 12 → completed: the final step has been cleared; flip the status.
  if (state.step >= TOTAL_STEPS) {
    return Object.freeze<FunnelStateObject>({ step: TOTAL_STEPS, status: 'completed' });
  }

  // Any step 0..11 → step + 1, always active.
  return Object.freeze<FunnelStateObject>({ step: state.step + 1, status: 'active' });
}

// ---------------------------------------------------------------------------
// Transition — reset (Sub-AC 4)
// ---------------------------------------------------------------------------

/**
 * `reset(state)` — 초기화 전이 순수 함수 (Sub-AC 4).
 *
 * 임의 스텝/상태에서 초기 상태(`{ step: 0, status: 'idle' }`)로 즉시 복귀하는
 * 순수 함수.  단순 retreat 루프와 달리 중간 단계를 거치지 않고 직접 초기화한다.
 * (예: 12단계 완료 상태 → 한 번의 reset으로 idle 복귀)
 *
 * 전이 규칙:
 *   - `step === 0 && status === 'idle'` → 이미 초기 상태(idempotent): 동일 참조 반환
 *   - 모든 다른 상태 → 새 불변 초기 상태 `{ step: 0, status: 'idle' }` 반환
 *
 * 경계값:
 *   - 중간 스텝(step 1–11, active) → 초기화
 *   - 완료 상태(step 12, completed) → 초기화 (retreat 와 달리 단말 상태도 복귀 허용)
 *   - 이탈 상태(abandoned)           → 초기화
 *   - 이미 초기 상태(step 0, idle)    → 동일 참조 반환 (no-op, 추가 할당 없음)
 *
 * 왜 completed 상태에서도 reset이 허용되는가:
 *   `retreat`는 completed를 단말 상태로 취급(no-op)하지만, `reset`의 의미는
 *   "퍼널 전체를 처음으로 되감기"이므로 completed·abandoned 포함 모든 상태에서
 *   `idle` 복귀를 허용한다.  이는 사용자가 결제 완료 후 앱을 다시 시작하거나
 *   테스트 코드가 픽스처를 재설정하는 시나리오를 지원한다.
 *
 * @param state - 현재 퍼널 상태 (불변 {@link FunnelStateObject})
 * @returns 불변 초기 상태 `{ step: 0, status: 'idle' }` 또는 동일 참조 (이미 초기 상태인 경우)
 *
 * @example
 * ```ts
 * const mid = { step: 5, status: 'active' } as const;
 * const back = reset(mid);          // { step: 0, status: 'idle' }
 *
 * const done = { step: 12, status: 'completed' } as const;
 * const fresh = reset(done);        // { step: 0, status: 'idle' }
 *
 * const initial = createFunnelState();
 * const same = reset(initial);      // 동일 참조 반환 (no-op)
 * same === initial;                  // true
 * ```
 */
export function reset(state: FunnelStateObject): FunnelStateObject {
  // Already at initial state — return the same reference (idempotent, no allocation).
  if (state.step === 0 && state.status === 'idle') {
    return state;
  }
  // Any other state (active, completed, abandoned) → fresh frozen initial state.
  return Object.freeze<FunnelStateObject>({ step: 0, status: 'idle' });
}

// ---------------------------------------------------------------------------
// Transition — retreat (Sub-AC 3)
// ---------------------------------------------------------------------------

/**
 * `retreat(state)` — 후퇴 전이 순수 함수 (Sub-AC 3).
 *
 * Glam Up 12단계 결제 깔때기의 backward step 전이 로직.
 * 항상 새 불변 객체를 반환하며, 입력 상태를 변이하지 않는다.
 * (예외: step 0 또는 completed 단말 상태에서는 동일 참조를 no-op으로 반환한다.)
 *
 * 전이 규칙:
 *   - `step === 0`             → 후퇴 불가(no-op): 동일 상태 반환 (시작 전 경계)
 *   - `status === 'completed'` → 후퇴 불가(no-op): 동일 상태 반환 (완료는 단말 상태)
 *   - `step === 1`             → `{ step: 0, status: 'idle' }` (첫 단계 → 시작 전 복귀)
 *   - `step 2..12`             → `{ step: step - 1, status: 'active' }` (전 단계로 후퇴)
 *
 * 경계값:
 *   - step 1 → 0 : 첫 번째 단계에서 idle(시작 전)으로 복귀 — 상태도 'idle'로 리셋.
 *   - step 0 불가 : 이미 시작 전 → 후퇴 불가(no-op), 상태 불변, 동일 참조 반환.
 *   - 완료 불가   : completed는 단말 상태 → retreat 허용 안 됨(no-op), 동일 참조 반환.
 *                  (advance()가 completed를 no-op으로 처리하는 것과 대칭적 설계)
 *
 * @param state - 현재 퍼널 상태 (불변 {@link FunnelStateObject})
 * @returns 새 불변 `FunnelStateObject` (전이 후 상태), 또는 동일 참조 (no-op 경우)
 *
 * @example
 * ```ts
 * const s1 = advance(createFunnelState());              // { step: 1, status: 'active' }
 * const s0 = retreat(s1);                               // { step: 0, status: 'idle' }
 * const same = retreat(s0);                             // { step: 0, status: 'idle' } (no-op)
 * const completed: FunnelStateObject = { step: 12, status: 'completed' };
 * const still = retreat(completed);                     // { step: 12, status: 'completed' } (no-op)
 * ```
 */
export function retreat(state: FunnelStateObject): FunnelStateObject {
  // No-op guard: step 0 is the start boundary — retreat before the funnel is impossible.
  if (state.step === 0) {
    return state;
  }

  // No-op guard: completed state is a terminal dead end — retreat is not allowed.
  // Mirrors advance()'s treatment of 'completed' for symmetry.
  if (state.status === 'completed') {
    return state;
  }

  // Step 1 → back to the initial state (idle, step 0).
  if (state.step === 1) {
    return Object.freeze<FunnelStateObject>({ step: 0, status: 'idle' });
  }

  // Any step 2..12 → step - 1, always active.
  return Object.freeze<FunnelStateObject>({ step: state.step - 1, status: 'active' });
}
