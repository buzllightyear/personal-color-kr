/**
 * 단위 테스트 — 타이머 상태 → 표시 레이블 파생 (Sub-AC 14c-3)
 *
 * 검증 대상:
 *   - `deriveUrgencyDisplay(remainingMs)` 순수 함수
 *
 * 검증 항목:
 *   1. "X분 남음" 구간 경계 (interval boundaries)
 *      — 구간 끝(N × 60_000ms), 구간 끝+1ms, 구간 끝-1ms 정밀 검증
 *   2. "만료됨" 전환 임계값 (expired transition threshold)
 *      — 1ms(남음) / 0ms(만료됨) 경계 전환 검증
 *   3. 0 이하 처리 (zero and negative handling)
 *      — 0, -1, 큰 음수 모두 "만료됨" 반환
 *
 * 설계 노트:
 *   - 순수 함수 → clock 스텁 불필요. 입력값을 직접 주입.
 *   - `Date.now()` 의존 없음.
 *   - 각 it-block은 단일 경계 또는 동작을 원자적으로 검증한다.
 */
import { describe, it, expect } from 'vitest';

import { deriveUrgencyDisplay } from '../../src/funnel/urgency-display.js';

// ---------------------------------------------------------------------------
// 상수 — 테스트 가독성용 로컬 정의
// ---------------------------------------------------------------------------

/** 1분 = 60_000ms */
const MIN = 60_000;

// ---------------------------------------------------------------------------
// "만료됨" 전환 임계값 — 0ms 및 이하
// ---------------------------------------------------------------------------

describe('"만료됨" 전환 임계값', () => {
  it('remainingMs === 0 → "만료됨" (정확히 0ms, 만료 경계)', () => {
    expect(deriveUrgencyDisplay(0)).toBe('만료됨');
  });

  it('remainingMs === -1 → "만료됨" (1ms 초과 만료)', () => {
    expect(deriveUrgencyDisplay(-1)).toBe('만료됨');
  });

  it('remainingMs === 1 → "1분 남음" (0ms 직후, 만료 경계 바로 위)', () => {
    // 만료 전환 임계값 = 0. 1ms는 아직 만료 아님 → "1분 남음"
    expect(deriveUrgencyDisplay(1)).toBe('1분 남음');
  });
});

// ---------------------------------------------------------------------------
// 0 이하 처리 — 0, 음수, 큰 음수
// ---------------------------------------------------------------------------

describe('0 이하 처리 — 모두 "만료됨" 반환', () => {
  it('remainingMs === 0 → "만료됨"', () => {
    expect(deriveUrgencyDisplay(0)).toBe('만료됨');
  });

  it('remainingMs === -1 → "만료됨"', () => {
    expect(deriveUrgencyDisplay(-1)).toBe('만료됨');
  });

  it('remainingMs === -59_999 → "만료됨" (1분 미만 만료 후 경과)', () => {
    expect(deriveUrgencyDisplay(-59_999)).toBe('만료됨');
  });

  it('remainingMs === -60_000 → "만료됨" (정확히 1분 만료 후 경과)', () => {
    expect(deriveUrgencyDisplay(-60_000)).toBe('만료됨');
  });

  it('remainingMs === -1_000_000 → "만료됨" (큰 음수)', () => {
    expect(deriveUrgencyDisplay(-1_000_000)).toBe('만료됨');
  });

  it('remainingMs === Number.NEGATIVE_INFINITY → "만료됨"', () => {
    expect(deriveUrgencyDisplay(Number.NEGATIVE_INFINITY)).toBe('만료됨');
  });
});

// ---------------------------------------------------------------------------
// "X분 남음" 구간 경계 — 1분 구간
// ---------------------------------------------------------------------------

describe('"1분 남음" 구간: (0, 60_000] ms', () => {
  it('remainingMs === 1 → "1분 남음" (구간 하한, 0 초과 최솟값)', () => {
    expect(deriveUrgencyDisplay(1)).toBe('1분 남음');
  });

  it('remainingMs === 30_000 → "1분 남음" (구간 중간, 30초)', () => {
    expect(deriveUrgencyDisplay(30_000)).toBe('1분 남음');
  });

  it('remainingMs === 59_999 → "1분 남음" (구간 상한 -1ms)', () => {
    expect(deriveUrgencyDisplay(59_999)).toBe('1분 남음');
  });

  it('remainingMs === 60_000 → "1분 남음" (구간 상한, 정확히 1분)', () => {
    // ceil(60_000 / 60_000) = ceil(1.0) = 1
    expect(deriveUrgencyDisplay(60_000)).toBe('1분 남음');
  });
});

// ---------------------------------------------------------------------------
// "X분 남음" 구간 경계 — 1분→2분 전환 경계
// ---------------------------------------------------------------------------

describe('"1분 남음" → "2분 남음" 전환 경계 (60_000ms / 60_001ms)', () => {
  it('remainingMs === 60_000 → "1분 남음" (전환 직전)', () => {
    expect(deriveUrgencyDisplay(60_000)).toBe('1분 남음');
  });

  it('remainingMs === 60_001 → "2분 남음" (전환 직후)', () => {
    // ceil(60_001 / 60_000) = ceil(1.0000166...) = 2
    expect(deriveUrgencyDisplay(60_001)).toBe('2분 남음');
  });
});

// ---------------------------------------------------------------------------
// "X분 남음" 구간 경계 — 2분 구간
// ---------------------------------------------------------------------------

describe('"2분 남음" 구간: (60_000, 120_000] ms', () => {
  it('remainingMs === 60_001 → "2분 남음" (구간 하한 +1ms)', () => {
    expect(deriveUrgencyDisplay(60_001)).toBe('2분 남음');
  });

  it('remainingMs === 90_000 → "2분 남음" (구간 중간, 1분 30초)', () => {
    expect(deriveUrgencyDisplay(90_000)).toBe('2분 남음');
  });

  it('remainingMs === 119_999 → "2분 남음" (구간 상한 -1ms)', () => {
    expect(deriveUrgencyDisplay(119_999)).toBe('2분 남음');
  });

  it('remainingMs === 120_000 → "2분 남음" (구간 상한, 정확히 2분)', () => {
    // ceil(120_000 / 60_000) = ceil(2.0) = 2
    expect(deriveUrgencyDisplay(120_000)).toBe('2분 남음');
  });
});

// ---------------------------------------------------------------------------
// "X분 남음" 구간 경계 — 2분→3분 전환 경계
// ---------------------------------------------------------------------------

describe('"2분 남음" → "3분 남음" 전환 경계 (120_000ms / 120_001ms)', () => {
  it('remainingMs === 120_000 → "2분 남음" (전환 직전)', () => {
    expect(deriveUrgencyDisplay(120_000)).toBe('2분 남음');
  });

  it('remainingMs === 120_001 → "3분 남음" (전환 직후)', () => {
    expect(deriveUrgencyDisplay(120_001)).toBe('3분 남음');
  });
});

// ---------------------------------------------------------------------------
// "X분 남음" 구간 경계 — 5분, 10분, 30분 검증
// ---------------------------------------------------------------------------

describe('대표 분(minute) 값 검증', () => {
  it('remainingMs === 5 * MIN → "5분 남음" (정확히 5분)', () => {
    expect(deriveUrgencyDisplay(5 * MIN)).toBe('5분 남음');
  });

  it('remainingMs === 5 * MIN + 1 → "6분 남음" (5분 초과 1ms)', () => {
    expect(deriveUrgencyDisplay(5 * MIN + 1)).toBe('6분 남음');
  });

  it('remainingMs === 5 * MIN - 1 → "5분 남음" (5분 미만 1ms)', () => {
    expect(deriveUrgencyDisplay(5 * MIN - 1)).toBe('5분 남음');
  });

  it('remainingMs === 10 * MIN → "10분 남음"', () => {
    expect(deriveUrgencyDisplay(10 * MIN)).toBe('10분 남음');
  });

  it('remainingMs === 30 * MIN → "30분 남음"', () => {
    expect(deriveUrgencyDisplay(30 * MIN)).toBe('30분 남음');
  });

  it('remainingMs === 60 * MIN → "60분 남음" (1시간)', () => {
    // 함수는 분(minute) 단위만 다루므로 1시간 = 60분 남음
    expect(deriveUrgencyDisplay(60 * MIN)).toBe('60분 남음');
  });
});

// ---------------------------------------------------------------------------
// 구간 경계 배열 기반 파라미터 검증 — N분 경계 10개
// ---------------------------------------------------------------------------

describe('N분 경계 파라미터 검증 (N = 1..10)', () => {
  it.each(
    Array.from({ length: 10 }, (_, i) => {
      const n = i + 1;
      return { n, exactMs: n * MIN, overMs: n * MIN + 1 };
    }),
  )(
    'N=$n: $exactMs ms → "$n분 남음", $overMs ms → "${n+1}분 남음"',
    ({ n, exactMs, overMs }) => {
      expect(deriveUrgencyDisplay(exactMs)).toBe(`${n}분 남음`);
      expect(deriveUrgencyDisplay(overMs)).toBe(`${n + 1}분 남음`);
    },
  );
});

// ---------------------------------------------------------------------------
// 순수 함수 — 동일 입력 동일 출력
// ---------------------------------------------------------------------------

describe('순수 함수 — 동일 입력 동일 출력', () => {
  it('같은 입력으로 두 번 호출해도 결과가 동일하다 (양수 입력)', () => {
    const ms = 180_000;
    expect(deriveUrgencyDisplay(ms)).toBe(deriveUrgencyDisplay(ms));
  });

  it('같은 입력으로 두 번 호출해도 결과가 동일하다 (0)', () => {
    expect(deriveUrgencyDisplay(0)).toBe(deriveUrgencyDisplay(0));
  });

  it('같은 입력으로 두 번 호출해도 결과가 동일하다 (음수 입력)', () => {
    const ms = -5_000;
    expect(deriveUrgencyDisplay(ms)).toBe(deriveUrgencyDisplay(ms));
  });
});

// ---------------------------------------------------------------------------
// 반환 타입 검증
// ---------------------------------------------------------------------------

describe('반환 타입', () => {
  it('양수 입력 반환값은 string이다', () => {
    expect(typeof deriveUrgencyDisplay(60_000)).toBe('string');
  });

  it('0 입력 반환값은 string이다', () => {
    expect(typeof deriveUrgencyDisplay(0)).toBe('string');
  });

  it('음수 입력 반환값은 string이다', () => {
    expect(typeof deriveUrgencyDisplay(-1)).toBe('string');
  });

  it('양수 입력 반환값은 "분 남음"으로 끝난다', () => {
    expect(deriveUrgencyDisplay(120_000)).toMatch(/분 남음$/);
  });

  it('양수 입력 반환값은 숫자로 시작한다 (X분 남음 형식)', () => {
    expect(deriveUrgencyDisplay(120_000)).toMatch(/^\d+분 남음$/);
  });
});

// ---------------------------------------------------------------------------
// 통합 시나리오 — countdown-timer.getRemainingMs 와의 연계
// ---------------------------------------------------------------------------

describe('통합 시나리오 — getRemainingMs 출력 → deriveUrgencyDisplay 파이프라인', () => {
  it('만료 1ms 전: remainingMs=1 → "1분 남음"', () => {
    // countdown-timer.getRemainingMs 가 1을 반환하는 시점
    expect(deriveUrgencyDisplay(1)).toBe('1분 남음');
  });

  it('만료 순간: remainingMs=0 → "만료됨"', () => {
    // isExpired(state, now) === true 이 되는 순간과 동일한 경계
    expect(deriveUrgencyDisplay(0)).toBe('만료됨');
  });

  it('만료 1ms 후: remainingMs=-1 → "만료됨"', () => {
    expect(deriveUrgencyDisplay(-1)).toBe('만료됨');
  });

  it('5분 타이머 25% 경과 (3분 45초 = 225_000ms 남음) → "4분 남음"', () => {
    // ceil(225_000 / 60_000) = ceil(3.75) = 4
    expect(deriveUrgencyDisplay(225_000)).toBe('4분 남음');
  });

  it('5분 타이머 75% 경과 (1분 15초 = 75_000ms 남음) → "2분 남음"', () => {
    // ceil(75_000 / 60_000) = ceil(1.25) = 2
    expect(deriveUrgencyDisplay(75_000)).toBe('2분 남음');
  });

  it('결제 깔때기 5단계 긴급 오퍼 30분 타이머 (1_800_000ms 남음) → "30분 남음"', () => {
    expect(deriveUrgencyDisplay(30 * MIN)).toBe('30분 남음');
  });
});
