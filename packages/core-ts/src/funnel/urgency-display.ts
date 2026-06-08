/**
 * urgency-display.ts — 타이머 잔여 시간 → 긴급성 표시 레이블 파생 (Sub-AC 14c-3)
 *
 * 순수 함수. 밀리초 단위 잔여 시간을 받아 한국어 표시 레이블을 반환한다.
 *
 * ## 변환 규칙
 *
 *   | 잔여 시간 (remainingMs) | 반환 레이블          |
 *   | ----------------------- | -------------------- |
 *   | > 0                     | "X분 남음" (X ≥ 1)   |
 *   | ≤ 0                     | "만료됨"             |
 *
 * ## 분(minute) 계산 방식
 *
 *   `Math.ceil(remainingMs / 60_000)`
 *
 *   올림(ceiling) 방식을 사용하므로, 잔여 시간이 1ms 이상 60_000ms 이하이면
 *   "1분 남음"이 표시된다. 60_001ms부터 "2분 남음"이 된다.
 *   즉, "(N-1)분 초과 ~ N분 이하" 구간 → "N분 남음".
 *
 *   구간 경계:
 *     (0,       60_000] → "1분 남음"
 *     (60_000, 120_000] → "2분 남음"
 *     (120_000, 180_000] → "3분 남음"
 *     …
 *
 * ## 설계 원칙
 *
 *   1. 순수 함수 (Pure function): 동일 입력 → 동일 출력. 외부 상태·I/O 없음.
 *   2. clock 독립: `Date.now()` 를 읽지 않는다.
 *      호출부(`countdown-timer.ts`의 `getRemainingMs`)에서 잔여 ms를 계산해
 *      이 함수에 주입한다.
 *   3. 만료 경계(0ms)는 "만료됨"으로 처리: "0분 남음"이 아닌 "만료됨" 표시.
 *      `isExpired`의 경계값 정의(`≤ 0 → expired`)와 동일하다.
 *
 * ## 패키지 내 위치
 *
 * `funnel/` 디렉터리: 결제 깔때기 5단계 긴급성·희소성 UI와 Sub-AC 14c 시리즈의
 * 레이블 렌더링 레이어가 이 모듈을 공유한다.
 */

// ---------------------------------------------------------------------------
// 상수
// ---------------------------------------------------------------------------

/**
 * 1분을 밀리초로 표현한 값.
 * `Math.ceil(remainingMs / MINUTE_MS)` 로 잔여 분(minute)을 계산한다.
 */
const MINUTE_MS = 60_000 as const;

/**
 * 잔여 시간 0 이하일 때 표시하는 만료 레이블.
 */
const EXPIRED_LABEL = '만료됨' as const;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * `deriveUrgencyDisplay(remainingMs)` — 잔여 밀리초 → 표시 레이블 파생 순수 함수.
 *
 * 카운트다운 타이머의 잔여 시간(`getRemainingMs` 반환값)을 받아
 * 사용자에게 보여줄 한국어 긴급성 레이블을 반환한다.
 *
 * @param remainingMs - 잔여 시간 (밀리초). 음수 허용 (타이머 만료 후 경과 시간).
 * @returns
 *   - `remainingMs > 0`: `"X분 남음"` (X = `Math.ceil(remainingMs / 60_000)`, X ≥ 1)
 *   - `remainingMs ≤ 0`: `"만료됨"`
 *
 * @example
 * deriveUrgencyDisplay(300_000)  // → "5분 남음"  (5분 정확)
 * deriveUrgencyDisplay(299_999)  // → "5분 남음"  (4분 59.999초 → ceil → 5분)
 * deriveUrgencyDisplay(240_001)  // → "5분 남음"  (4분 0.001초 초과 → ceil → 5분)
 * deriveUrgencyDisplay(240_000)  // → "4분 남음"  (정확히 4분)
 * deriveUrgencyDisplay(1)        // → "1분 남음"  (1ms → ceil → 1분)
 * deriveUrgencyDisplay(0)        // → "만료됨"
 * deriveUrgencyDisplay(-1_000)   // → "만료됨"
 */
export function deriveUrgencyDisplay(remainingMs: number): string {
  if (remainingMs <= 0) {
    return EXPIRED_LABEL;
  }

  const minutes = Math.ceil(remainingMs / MINUTE_MS);
  return `${minutes}분 남음`;
}
