/**
 * 카운트다운 타이머 핵심 연산 단위 테스트 (Sub-AC 14c-1)
 *
 * 검증 대상:
 *   - createTimer(expiresAt)
 *   - getRemainingMs(timerState, now)
 *   - isExpired(timerState, now)
 *
 * 경계값 커버리지:
 *   - 잔여 시간 정확히 0ms (만료 경계)
 *   - 잔여 시간 음수 (이미 만료된 상태)
 *   - 잔여 시간 양수 (미래 만료 시각)
 *
 * 설계 노트:
 *   - 모든 함수는 순수 함수 → `Date.now()` 스텁 불필요.
 *     `now` 매개변수를 직접 주입하여 경계값을 정밀하게 제어한다.
 *   - clock API (vi.useFakeTimers 등) 의존 없음.
 */
import { describe, it, expect } from 'vitest';

import {
  createTimer,
  getRemainingMs,
  isExpired,
  type TimerState,
} from '../../src/funnel/countdown-timer.js';

// ---------------------------------------------------------------------------
// createTimer
// ---------------------------------------------------------------------------

describe('createTimer', () => {
  it('반환값이 주어진 expiresAt을 그대로 보존한다', () => {
    const expiresAt = 1_000_000;
    const state = createTimer(expiresAt);
    expect(state.expiresAt).toBe(expiresAt);
  });

  it('반환된 TimerState가 frozen(불변)이다', () => {
    const state = createTimer(500);
    expect(Object.isFrozen(state)).toBe(true);
  });

  it('0을 expiresAt으로 허용한다 (즉시 만료 타이머)', () => {
    const state = createTimer(0);
    expect(state.expiresAt).toBe(0);
  });

  it('음수 expiresAt도 에러 없이 생성된다 (이미 만료된 타이머)', () => {
    const state = createTimer(-1_000);
    expect(state.expiresAt).toBe(-1_000);
  });

  it('큰 양수 expiresAt도 손실 없이 보존된다', () => {
    // 실제 UTC epoch ms 범위 값 (2040년대 이상의 미래)
    const farFuture = 2_208_988_800_000; // 2040-01-01T00:00:00Z 부근
    const state = createTimer(farFuture);
    expect(state.expiresAt).toBe(farFuture);
  });

  it('호출마다 새 객체를 반환한다 (참조 동등성 없음)', () => {
    const a = createTimer(1_000);
    const b = createTimer(1_000);
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// getRemainingMs
// ---------------------------------------------------------------------------

describe('getRemainingMs', () => {
  // --- 경계값: 미래 만료 (양수 잔여) ---

  it('[미래] now < expiresAt → 양수 잔여 밀리초 반환', () => {
    const state = createTimer(1_000);
    expect(getRemainingMs(state, 600)).toBe(400);
  });

  it('[미래] 잔여 시간이 1ms이면 1을 반환한다', () => {
    const state = createTimer(1_000);
    expect(getRemainingMs(state, 999)).toBe(1);
  });

  it('[미래] expiresAt이 아직 훨씬 먼 미래이면 큰 양수를 반환한다', () => {
    const state = createTimer(100_000);
    expect(getRemainingMs(state, 0)).toBe(100_000);
  });

  // --- 경계값: 정확히 0ms (만료 경계) ---

  it('[경계] now === expiresAt → 정확히 0을 반환한다', () => {
    const expiresAt = 5_000;
    const state = createTimer(expiresAt);
    expect(getRemainingMs(state, expiresAt)).toBe(0);
  });

  it('[경계] expiresAt = 0, now = 0 → 0을 반환한다', () => {
    const state = createTimer(0);
    expect(getRemainingMs(state, 0)).toBe(0);
  });

  // --- 경계값: 음수 잔여 시간 (만료 후) ---

  it('[만료] now > expiresAt → 음수 잔여 밀리초 반환 (클램핑 없음)', () => {
    const state = createTimer(1_000);
    expect(getRemainingMs(state, 1_500)).toBe(-500);
  });

  it('[만료] now가 expiresAt보다 1ms 뒤이면 -1을 반환한다', () => {
    const state = createTimer(1_000);
    expect(getRemainingMs(state, 1_001)).toBe(-1);
  });

  it('[만료] 만료 후 경과 시간이 길면 큰 음수를 반환한다', () => {
    const state = createTimer(1_000);
    expect(getRemainingMs(state, 100_000)).toBe(-99_000);
  });

  // --- 순수 함수 불변성 ---

  it('동일 입력에 항상 동일 출력을 반환한다 (순수 함수)', () => {
    const state = createTimer(2_000);
    const now = 1_500;
    expect(getRemainingMs(state, now)).toBe(500);
    expect(getRemainingMs(state, now)).toBe(500);
  });

  it('state를 변이하지 않는다 (호출 후 expiresAt 불변)', () => {
    const state = createTimer(3_000);
    getRemainingMs(state, 1_000);
    expect(state.expiresAt).toBe(3_000);
  });
});

// ---------------------------------------------------------------------------
// isExpired
// ---------------------------------------------------------------------------

describe('isExpired', () => {
  // --- 경계값: 미래 만료 (false) ---

  it('[미래] now < expiresAt → false (아직 만료 전)', () => {
    const state = createTimer(1_000);
    expect(isExpired(state, 999)).toBe(false);
  });

  it('[미래] 잔여 시간이 1ms이면 false를 반환한다', () => {
    const state = createTimer(1_000);
    expect(isExpired(state, 999)).toBe(false);
  });

  it('[미래] expiresAt이 훨씬 먼 미래이면 false를 반환한다', () => {
    const state = createTimer(100_000);
    expect(isExpired(state, 0)).toBe(false);
  });

  // --- 경계값: 정확히 0ms (만료 경계 → true) ---

  it('[경계] now === expiresAt → true (정확히 0ms, 만료로 처리)', () => {
    const expiresAt = 5_000;
    const state = createTimer(expiresAt);
    expect(isExpired(state, expiresAt)).toBe(true);
  });

  it('[경계] expiresAt = 0, now = 0 → true', () => {
    const state = createTimer(0);
    expect(isExpired(state, 0)).toBe(true);
  });

  it('[경계] expiresAt = 0, now = 1 → true (now가 1ms 뒤)', () => {
    const state = createTimer(0);
    expect(isExpired(state, 1)).toBe(true);
  });

  // --- 경계값: 음수 잔여 시간 (만료 후 → true) ---

  it('[만료] now > expiresAt → true (이미 만료)', () => {
    const state = createTimer(1_000);
    expect(isExpired(state, 1_500)).toBe(true);
  });

  it('[만료] now가 expiresAt보다 1ms 뒤이면 true를 반환한다', () => {
    const state = createTimer(1_000);
    expect(isExpired(state, 1_001)).toBe(true);
  });

  it('[만료] expiresAt이 음수(과거 시각)이고 now = 0이면 true를 반환한다', () => {
    const state = createTimer(-1_000);
    expect(isExpired(state, 0)).toBe(true);
  });

  // --- 전환 지점 전후 검증 ---

  it('만료 1ms 전후로 false→true 전환을 정확히 한다', () => {
    const expiresAt = 1_000;
    const state = createTimer(expiresAt);

    // 만료 직전
    expect(isExpired(state, expiresAt - 1)).toBe(false);
    // 만료 순간 (경계)
    expect(isExpired(state, expiresAt)).toBe(true);
    // 만료 직후
    expect(isExpired(state, expiresAt + 1)).toBe(true);
  });

  // --- getRemainingMs와의 일관성 검증 ---

  it('isExpired(state, now) === getRemainingMs(state, now) <= 0 (정의 일관성)', () => {
    const cases: Array<{ expiresAt: number; now: number }> = [
      { expiresAt: 1_000, now: 500 },   // 미래
      { expiresAt: 1_000, now: 1_000 }, // 경계
      { expiresAt: 1_000, now: 1_500 }, // 만료
    ];

    for (const { expiresAt, now } of cases) {
      const state = createTimer(expiresAt);
      const remaining = getRemainingMs(state, now);
      const expired = isExpired(state, now);
      expect(expired).toBe(remaining <= 0);
    }
  });

  // --- 순수 함수 불변성 ---

  it('동일 입력에 항상 동일 출력을 반환한다 (순수 함수)', () => {
    const state = createTimer(2_000);
    expect(isExpired(state, 2_000)).toBe(true);
    expect(isExpired(state, 2_000)).toBe(true);
  });

  it('state를 변이하지 않는다 (호출 후 expiresAt 불변)', () => {
    const state: TimerState = createTimer(3_000);
    isExpired(state, 5_000);
    expect(state.expiresAt).toBe(3_000);
  });
});

// ---------------------------------------------------------------------------
// 통합 시나리오: createTimer → getRemainingMs → isExpired 파이프라인
// ---------------------------------------------------------------------------

describe('타이머 파이프라인 통합 시나리오', () => {
  it('30초 타이머: 생성 → 15초 후 잔여 확인 → 30초 후 만료 확인', () => {
    const startMs = 1_000_000;
    const durationMs = 30_000;
    const expiresAt = startMs + durationMs;

    const timer = createTimer(expiresAt);

    // 15초 후
    const halfwayMs = startMs + 15_000;
    expect(getRemainingMs(timer, halfwayMs)).toBe(15_000);
    expect(isExpired(timer, halfwayMs)).toBe(false);

    // 정확히 30초 후 (만료 경계)
    expect(getRemainingMs(timer, expiresAt)).toBe(0);
    expect(isExpired(timer, expiresAt)).toBe(true);

    // 31초 후 (만료 후 1초)
    const afterMs = expiresAt + 1_000;
    expect(getRemainingMs(timer, afterMs)).toBe(-1_000);
    expect(isExpired(timer, afterMs)).toBe(true);
  });

  it('즉시 만료 타이머 (expiresAt = now): 생성 즉시 isExpired = true', () => {
    const now = 999_999;
    const timer = createTimer(now);
    expect(isExpired(timer, now)).toBe(true);
    expect(getRemainingMs(timer, now)).toBe(0);
  });

  it('이미 만료된 타이머 (expiresAt < now): 생성 후 이미 만료 상태', () => {
    const now = 2_000;
    const expiresAt = 1_000; // now보다 1초 이전
    const timer = createTimer(expiresAt);
    expect(isExpired(timer, now)).toBe(true);
    expect(getRemainingMs(timer, now)).toBe(-1_000);
  });
});
