/**
 * Unit tests — Sub-AC 2.3: ScanAnimation 단계 전이 상태 매퍼.
 *
 * 검증 포커스:
 *   1. 매핑 함수가 단일 사상으로서 길이 8 의 프로즌 배열을 돌려준다.
 *   2. 각 단계 전이 경계값(0/12/13/25/37/38/50/63/75/88/99/100) 에서 정확히
 *      어느 단계가 `active` 인지, 이전/이후 단계가 `done`/`pending` 인지 검증.
 *   3. 잘못된 입력(NaN / 음수 / 100 초과 / 비정수) 처리 규약.
 *   4. 진행 로직(`scan-animation.ts`) 이 산출하는 실제 `progressPercent`
 *      값과의 정합성 — `start` 직후 elapsedMs 별 progressPercent 를 그대로
 *      매퍼에 흘려넣어도 컴포넌트 뷰모델의 분할과 일치하는지 sanity-check.
 *
 * 본 테스트는 매퍼의 *순수성* 검증만 다룬다 — 타이머/스케줄러 / DOM /
 * React 등에는 일체 의존하지 않는다.
 */
import { describe, expect, it } from 'vitest';

import {
  SCAN_ANIMATION_TOTAL_STAGES,
  createScanAnimation,
  startScanAnimation,
  tickScanAnimation,
} from '../../src/scan_option/scan-animation.js';
import type { ScanAnimationStageStatus } from '../../src/scan_option/scan-animation-component.js';
import {
  SCAN_ANIMATION_PROGRESS_MAX_PERCENT,
  SCAN_ANIMATION_PROGRESS_MIN_PERCENT,
  mapScanAnimationProgressToStageStatuses,
} from '../../src/scan_option/scan-animation-progress-mapper.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** 정확히 한 단계만 `active` 인 8-원소 시퀀스를 생성. */
function expectActivePattern(
  statuses: readonly ScanAnimationStageStatus[],
  activeIndex: number,
): void {
  expect(statuses).toHaveLength(SCAN_ANIMATION_TOTAL_STAGES);
  for (let i = 0; i < SCAN_ANIMATION_TOTAL_STAGES; i += 1) {
    if (i < activeIndex) {
      expect(statuses[i]).toBe('done');
    } else if (i === activeIndex) {
      expect(statuses[i]).toBe('active');
    } else {
      expect(statuses[i]).toBe('pending');
    }
  }
}

// ---------------------------------------------------------------------------
// 기본 계약
// ---------------------------------------------------------------------------

describe('mapScanAnimationProgressToStageStatuses — 기본 계약', () => {
  it('항상 길이 8 의 배열을 돌려준다 (모든 합리적 입력)', () => {
    for (const p of [0, 1, 12, 13, 50, 87, 88, 99, 100, -10, 250, 0.5]) {
      const out = mapScanAnimationProgressToStageStatuses(p);
      expect(out).toHaveLength(SCAN_ANIMATION_TOTAL_STAGES);
    }
  });

  it('반환 배열은 Object.freeze 처리된다', () => {
    const out = mapScanAnimationProgressToStageStatuses(50);
    expect(Object.isFrozen(out)).toBe(true);
  });

  it('출력 원소는 모두 pending|active|done 셋 중 하나다', () => {
    const allowed = new Set<ScanAnimationStageStatus>([
      'pending',
      'active',
      'done',
    ]);
    for (let p = 0; p <= 100; p += 1) {
      const out = mapScanAnimationProgressToStageStatuses(p);
      for (const s of out) {
        expect(allowed.has(s)).toBe(true);
      }
    }
  });

  it('상수 SCAN_ANIMATION_PROGRESS_MIN/MAX_PERCENT 는 0/100 이다', () => {
    expect(SCAN_ANIMATION_PROGRESS_MIN_PERCENT).toBe(0);
    expect(SCAN_ANIMATION_PROGRESS_MAX_PERCENT).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// 경계값 매핑 — 핵심 테스트
// ---------------------------------------------------------------------------

describe('mapScanAnimationProgressToStageStatuses — 단계 전이 경계값', () => {
  // [입력 progress%, 기대되는 활성 단계 인덱스]
  // floor(progress * 8 / 100) 규약으로부터 도출.  각 단계의 *직전/직후*
  // 경계 (단계 i 의 마지막 정수 퍼센트와 단계 i+1 의 첫 정수 퍼센트) 를
  // 모두 포함하여 회귀 시 어느 쪽으로 깨지는지 즉시 드러나게 한다.
  const cases: ReadonlyArray<readonly [number, number]> = [
    [0, 0],
    [1, 0],
    [12, 0], //   stage 0 의 마지막 정수 퍼센트 (= 12.49…)
    [13, 1], //   stage 1 의 첫 정수 퍼센트
    [24, 1],
    [25, 2], //   25% 정확히 boundary — floor(2.0) = 2
    [37, 2],
    [38, 3],
    [49, 3],
    [50, 4], //   50% 정확히 boundary — floor(4.0) = 4
    [62, 4],
    [63, 5],
    [74, 5],
    [75, 6], //   75% 정확히 boundary — floor(6.0) = 6
    [87, 6],
    [88, 7],
    [99, 7], //   stage 7 의 마지막 정수 퍼센트
  ] as const;

  for (const [pct, expectedActive] of cases) {
    it(`progress=${pct}% → stage ${expectedActive} 가 active`, () => {
      const out = mapScanAnimationProgressToStageStatuses(pct);
      expectActivePattern(out, expectedActive);
      // 정확히 한 단계만 active.
      expect(out.filter((s) => s === 'active')).toHaveLength(1);
      // 100% 미만에서는 done 의 개수가 active 인덱스와 일치.
      expect(out.filter((s) => s === 'done')).toHaveLength(expectedActive);
      // pending 의 개수가 일치.
      expect(out.filter((s) => s === 'pending')).toHaveLength(
        SCAN_ANIMATION_TOTAL_STAGES - expectedActive - 1,
      );
    });
  }

  it('progress=100% → 8단계 모두 done, active/pending 없음', () => {
    const out = mapScanAnimationProgressToStageStatuses(100);
    expect(out).toHaveLength(SCAN_ANIMATION_TOTAL_STAGES);
    expect(out.every((s) => s === 'done')).toBe(true);
    expect(out.filter((s) => s === 'active')).toHaveLength(0);
    expect(out.filter((s) => s === 'pending')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 잘못된 입력 — 클램핑 규약
// ---------------------------------------------------------------------------

describe('mapScanAnimationProgressToStageStatuses — 잘못된 입력 클램핑', () => {
  it('음수 입력은 0 으로 클램핑된다 (= stage 0 active)', () => {
    for (const p of [-1, -10, -100, Number.NEGATIVE_INFINITY]) {
      const out = mapScanAnimationProgressToStageStatuses(p);
      expectActivePattern(out, 0);
    }
  });

  it('100 초과 입력은 100 으로 클램핑된다 (= 전체 done)', () => {
    for (const p of [101, 200, 9999, Number.POSITIVE_INFINITY]) {
      const out = mapScanAnimationProgressToStageStatuses(p);
      expect(out.every((s) => s === 'done')).toBe(true);
    }
  });

  it('NaN 입력은 0 으로 취급된다 (= stage 0 active)', () => {
    const out = mapScanAnimationProgressToStageStatuses(Number.NaN);
    expectActivePattern(out, 0);
  });

  it('비정수 입력도 floor 후 매핑된다 (경계 근처 fractional)', () => {
    // 12.999% → activeIdx = floor(12.999 * 8 / 100) = floor(1.03992) = 1
    expectActivePattern(mapScanAnimationProgressToStageStatuses(12.999), 1);
    // 12.4% → activeIdx = floor(0.992) = 0
    expectActivePattern(mapScanAnimationProgressToStageStatuses(12.4), 0);
    // 87.49% → activeIdx = floor(6.9992) = 6
    expectActivePattern(mapScanAnimationProgressToStageStatuses(87.49), 6);
    // 99.999% → activeIdx = floor(7.99992) = 7 (still active, not complete)
    expectActivePattern(mapScanAnimationProgressToStageStatuses(99.999), 7);
  });
});

// ---------------------------------------------------------------------------
// 진행 로직과의 정합성 — sanity check
// ---------------------------------------------------------------------------

describe('mapScanAnimationProgressToStageStatuses — scan-animation.ts 정합성', () => {
  it('start 직후 progress=0 → stage 0 active', () => {
    const started = startScanAnimation(createScanAnimation(), 0);
    const out = mapScanAnimationProgressToStageStatuses(
      started.progressPercent,
    );
    expectActivePattern(out, 0);
  });

  it('완료 시 progress=100 → 8단계 모두 done', () => {
    const started = startScanAnimation(createScanAnimation(), 0);
    const done = tickScanAnimation(started, 5_000); // > 3200 ms
    expect(done.phase).toBe('complete');
    expect(done.progressPercent).toBe(100);
    const out = mapScanAnimationProgressToStageStatuses(done.progressPercent);
    expect(out.every((s) => s === 'done')).toBe(true);
  });
});
