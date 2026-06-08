/**
 * countdown-timer.ts — 카운트다운 타이머 핵심 연산 (Sub-AC 14c-1)
 *
 * 순수 함수형 타이머 상태 모델. 모든 함수는 side-effect 없이 새 값을 반환한다.
 * 시스템 clock(`Date.now()`)을 직접 읽지 않으므로 테스트에서 주입 가능하다.
 *
 * ## 설계 원칙
 *
 *   1. 순수 함수 (Pure functions): 모든 함수는 동일 입력에 동일 출력을 보장한다.
 *   2. 불변성 (Immutability): `TimerState` 객체는 생성 후 변이하지 않는다 (frozen).
 *   3. 주입 가능한 clock: `now` 매개변수로 현재 시각을 주입한다.
 *      → 테스트에서 `Date.now()` 을 스텁 없이 경계값을 정밀하게 지정 가능하다.
 *
 * ## Public API
 *
 *   - `TimerState`             — 불변 타이머 상태 (expiresAt epoch ms 단 하나)
 *   - `createTimer(expiresAt)` — 타이머 생성
 *   - `getRemainingMs(state, now)` — 잔여 밀리초 (음수 허용 — 만료 후 경과 시간)
 *   - `isExpired(state, now)` — 만료 여부 (잔여 ≤ 0)
 *
 * ## 경계값 동작
 *
 *   | 조건                    | getRemainingMs | isExpired |
 *   | ----------------------- | -------------- | --------- |
 *   | now < expiresAt (미래)  | 양수           | false     |
 *   | now === expiresAt (정확) | 0              | true      |
 *   | now > expiresAt (과거)  | 음수           | true      |
 *
 * ## 패키지 내 위치
 *
 * `funnel/` 디렉터리: 결제 깔때기 5단계 긴급성·희소성 타이머와 14단계
 * 카운트다운 UI가 이 모듈을 공유한다.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * 불변 타이머 상태.
 *
 * `expiresAt`: Unix epoch 밀리초 기준 만료 시각.
 * 이 값만 갖고 있으면 "지금 얼마나 남았는지" / "만료됐는지"를 계산할 수 있다.
 */
export interface TimerState {
  /** 만료 시각 (Unix epoch ms). */
  readonly expiresAt: number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * `createTimer(expiresAt)` — 타이머 상태 생성.
 *
 * `expiresAt`이 과거 시각이어도 에러를 throw하지 않는다.
 * 이미 만료된 타이머도 유효한 `TimerState`이다 — `isExpired`가 즉시 `true`를
 * 반환하는 것으로 충분하다.
 *
 * @param expiresAt - 만료 시각 (Unix epoch ms, 정수 권장).
 * @returns Frozen `TimerState` 객체.
 *
 * @example
 * const timer = createTimer(Date.now() + 30_000); // 30초 후 만료
 */
export function createTimer(expiresAt: number): TimerState {
  return Object.freeze({ expiresAt });
}

/**
 * `getRemainingMs(timerState, now)` — 잔여 밀리초 반환.
 *
 * 반환값이 음수이면 타이머가 이미 만료됐음을 의미한다.
 * 음수 값을 클램핑하지 않는다 — 음수 그대로 반환하여 호출부에서 만료 후
 * 경과 시간을 알 수 있게 한다.
 *
 * @param timerState - `createTimer`로 생성한 불변 타이머 상태.
 * @param now - 현재 시각 (Unix epoch ms). 주입 매개변수 — 직접 `Date.now()` 를 읽지 않는다.
 * @returns `timerState.expiresAt - now` (양수: 아직 남음, 0: 방금 만료, 음수: 이미 만료).
 *
 * @example
 * const state = createTimer(1_000);
 * getRemainingMs(state, 600);  // → 400 (400ms 남음)
 * getRemainingMs(state, 1_000); // → 0 (정확히 만료)
 * getRemainingMs(state, 1_500); // → -500 (500ms 전에 만료)
 */
export function getRemainingMs(timerState: TimerState, now: number): number {
  return timerState.expiresAt - now;
}

/**
 * `isExpired(timerState, now)` — 타이머 만료 여부.
 *
 * 잔여 시간이 정확히 0이거나 음수이면 만료로 판단한다.
 * UI 렌더링 시 "00:00" 표시 직후 만료 처리가 필요한 경우를 위해
 * 정확히 0ms 시점을 만료로 처리한다.
 *
 * @param timerState - `createTimer`로 생성한 불변 타이머 상태.
 * @param now - 현재 시각 (Unix epoch ms). 주입 매개변수.
 * @returns 잔여 시간 ≤ 0이면 `true`, 잔여 시간 > 0이면 `false`.
 *
 * @example
 * const state = createTimer(1_000);
 * isExpired(state, 999);  // → false (1ms 남음)
 * isExpired(state, 1_000); // → true (정확히 0ms)
 * isExpired(state, 1_001); // → true (1ms 초과)
 */
export function isExpired(timerState: TimerState, now: number): boolean {
  return getRemainingMs(timerState, now) <= 0;
}
