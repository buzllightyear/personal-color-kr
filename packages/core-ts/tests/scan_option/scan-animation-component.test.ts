/**
 * Unit tests — Sub-AC 2.1: `ScanAnimation` 컴포넌트의 순수 렌더 함수.
 *
 * Verifies (단계별 출력 검증):
 *   - idle 상태 → 모든 행이 `pending`, `currentStageLabel === null`,
 *     `progressPercent === 0`, `ariaLive === 'off'`.
 *   - running 상태 stage 0..7 각각에 대해 `items` 가
 *       earlier → `done`, 현재 → `active`, later → `pending`
 *     순서로 분할되는지, `currentStageLabel`이 한국어 시그니처 라벨과
 *     일치하는지, `progressPercent`가 입력 그대로 반영되는지.
 *   - complete 상태 → 8개 단계 모두 `done`, 진행률 `100%` 텍스트,
 *     `ariaLive === 'assertive'`, `isComplete === true`.
 *   - 결정적 `key` / `testId` (= `scan-animation-stage-<index>` / 루트
 *     `scan-animation`).
 *   - 모든 반환 객체는 `Object.freeze` 처리.
 *   - 입력 상태(`ScanAnimationState`)는 변형되지 않는다 (순수성).
 *   - 인자를 생략하면 idle 뷰모델을 반환한다 (기본값 동작).
 */
import { describe, expect, it } from 'vitest';

import {
  CANONICAL_SCAN_ANIMATION_STAGES,
  SCAN_ANIMATION_STAGE_DURATION_MS,
  SCAN_ANIMATION_STAGE_LABELS,
  SCAN_ANIMATION_TOTAL_DURATION_MS,
  SCAN_ANIMATION_TOTAL_STAGES,
  createScanAnimation,
  startScanAnimation,
  tickScanAnimation,
  type ScanAnimationStageIndex,
} from '../../src/scan_option/scan-animation.js';
import {
  SCAN_ANIMATION_AUTO_ADVANCE_MS,
  SCAN_ANIMATION_COMPONENT_TEST_ID,
  renderScanAnimationComponent,
  scanAnimationAutoAdvanceSignal,
  type ScanAnimationStageStatus,
} from '../../src/scan_option/scan-animation-component.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** 입력 elapsed-ms로 상태 → 뷰모델 사상을 한 줄로 부른다. */
function projectAt(elapsedMs: number) {
  const started = startScanAnimation(createScanAnimation(), 0);
  const ticked = tickScanAnimation(started, elapsedMs);
  return { state: ticked, vm: renderScanAnimationComponent(ticked) };
}

/** stage 인덱스 → 기대되는 상태 라벨로 행 시퀀스를 생성. */
function expectedStatuses(
  currentIndex: ScanAnimationStageIndex,
): readonly ScanAnimationStageStatus[] {
  return Array.from({ length: SCAN_ANIMATION_TOTAL_STAGES }, (_, i) => {
    if (i < currentIndex) return 'done';
    if (i === currentIndex) return 'active';
    return 'pending';
  });
}

// ---------------------------------------------------------------------------
// 기본값 + idle
// ---------------------------------------------------------------------------

describe('renderScanAnimationComponent — idle / 기본값', () => {
  it('인자 없이 호출하면 idle 뷰모델을 반환한다', () => {
    const vm = renderScanAnimationComponent();
    expect(vm.phase).toBe('idle');
    expect(vm.isIdle).toBe(true);
    expect(vm.isRunning).toBe(false);
    expect(vm.isComplete).toBe(false);
    expect(vm.currentStageIndex).toBeNull();
    expect(vm.currentStageLabel).toBeNull();
    expect(vm.progressPercent).toBe(0);
    expect(vm.progressPercentText).toBe('0%');
    expect(vm.elapsedMs).toBe(0);
    expect(vm.ariaLive).toBe('off');
    expect(vm.totalStages).toBe(SCAN_ANIMATION_TOTAL_STAGES);
    expect(vm.totalDurationMs).toBe(SCAN_ANIMATION_TOTAL_DURATION_MS);
    expect(vm.key).toBe(SCAN_ANIMATION_COMPONENT_TEST_ID);
    expect(vm.testId).toBe(SCAN_ANIMATION_COMPONENT_TEST_ID);
  });

  it('idle 상태에서 8개 행 모두 pending이며 라벨은 시그니처와 일치한다', () => {
    const vm = renderScanAnimationComponent();
    expect(vm.items).toHaveLength(SCAN_ANIMATION_TOTAL_STAGES);
    vm.items.forEach((item, idx) => {
      expect(item.status).toBe('pending');
      expect(item.isActive).toBe(false);
      expect(item.isDone).toBe(false);
      expect(item.index).toBe(idx);
      expect(item.label).toBe(SCAN_ANIMATION_STAGE_LABELS[idx]);
      expect(item.key).toBe(`scan-animation-stage-${idx}`);
      expect(item.testId).toBe(`scan-animation-stage-${idx}`);
    });
  });

  it('명시적인 idle 상태도 같은 뷰모델로 사상된다', () => {
    const idle = createScanAnimation();
    const vm = renderScanAnimationComponent(idle);
    const def = renderScanAnimationComponent();
    expect(vm.phase).toBe(def.phase);
    expect(vm.items.map((it) => it.status)).toEqual(
      def.items.map((it) => it.status),
    );
  });
});

// ---------------------------------------------------------------------------
// running — 8 단계 각각 단계별 출력 검증
// ---------------------------------------------------------------------------

describe('renderScanAnimationComponent — running 단계 0..7 각각의 출력', () => {
  for (let stage = 0; stage < SCAN_ANIMATION_TOTAL_STAGES; stage += 1) {
    const expectedStage = stage as ScanAnimationStageIndex;
    const elapsed = stage * SCAN_ANIMATION_STAGE_DURATION_MS;

    it(`stage ${stage} (elapsed=${elapsed}ms): 라벨/상태/진행률 정확`, () => {
      const { state, vm } = projectAt(elapsed);

      // 입력 상태 — running, 정확한 stage 인덱스.
      expect(state.phase).toBe('running');
      expect(state.currentStageIndex).toBe(expectedStage);

      // 뷰모델 phase 비트.
      expect(vm.phase).toBe('running');
      expect(vm.isIdle).toBe(false);
      expect(vm.isRunning).toBe(true);
      expect(vm.isComplete).toBe(false);
      expect(vm.ariaLive).toBe('polite');

      // 현재 단계 라벨 / 진행률.
      expect(vm.currentStageIndex).toBe(expectedStage);
      expect(vm.currentStageLabel).toBe(
        SCAN_ANIMATION_STAGE_LABELS[expectedStage],
      );
      expect(vm.progressPercent).toBe(state.progressPercent);
      expect(vm.progressPercentText).toBe(`${state.progressPercent}%`);
      expect(vm.elapsedMs).toBe(state.elapsedMs);

      // items: earlier=done, current=active, later=pending.
      const statuses = vm.items.map((it) => it.status);
      expect(statuses).toEqual(expectedStatuses(expectedStage));

      // 활성 행은 정확히 하나여야 한다.
      const actives = vm.items.filter((it) => it.isActive);
      expect(actives).toHaveLength(1);
      expect(actives[0]?.index).toBe(expectedStage);

      // 라벨은 모두 시그니처(가-힣) 톤이며 결정적 식별자 유지.
      vm.items.forEach((it, idx) => {
        expect(it.label).toBe(SCAN_ANIMATION_STAGE_LABELS[idx]);
        expect(/[가-힣]/.test(it.label)).toBe(true);
        expect(it.testId).toBe(`scan-animation-stage-${idx}`);
        expect(it.key).toBe(`scan-animation-stage-${idx}`);
      });
    });
  }

  it('한 단계 안의 중간 진행 — stage 인덱스/라벨이 그 단계에 머문다', () => {
    // 정확히 boundary가 아닌, 단계 내 중간 시점.
    const elapsed = 500; // stage 1 중간
    const { vm } = projectAt(elapsed);
    expect(vm.currentStageIndex).toBe(1);
    expect(vm.currentStageLabel).toBe(SCAN_ANIMATION_STAGE_LABELS[1]);
    expect(vm.items.map((it) => it.status)).toEqual(expectedStatuses(1));
  });

  it('진행률은 단계가 진행될수록 단조 증가한다', () => {
    const percents: number[] = [];
    for (let s = 0; s < SCAN_ANIMATION_TOTAL_STAGES; s += 1) {
      const { vm } = projectAt(s * SCAN_ANIMATION_STAGE_DURATION_MS);
      percents.push(vm.progressPercent);
    }
    for (let i = 1; i < percents.length; i += 1) {
      const prev = percents[i - 1] as number;
      const cur = percents[i] as number;
      expect(cur).toBeGreaterThanOrEqual(prev);
    }
  });
});

// ---------------------------------------------------------------------------
// complete
// ---------------------------------------------------------------------------

describe('renderScanAnimationComponent — complete', () => {
  it('3200ms에 8단계 모두 done, 진행률 100%, ariaLive=assertive', () => {
    const { state, vm } = projectAt(SCAN_ANIMATION_TOTAL_DURATION_MS);
    expect(state.phase).toBe('complete');

    expect(vm.phase).toBe('complete');
    expect(vm.isIdle).toBe(false);
    expect(vm.isRunning).toBe(false);
    expect(vm.isComplete).toBe(true);
    expect(vm.ariaLive).toBe('assertive');
    expect(vm.progressPercent).toBe(100);
    expect(vm.progressPercentText).toBe('100%');
    expect(vm.elapsedMs).toBe(SCAN_ANIMATION_TOTAL_DURATION_MS);

    // 마지막 stage 라벨 노출 (latched at 7).
    expect(vm.currentStageIndex).toBe(SCAN_ANIMATION_TOTAL_STAGES - 1);
    expect(vm.currentStageLabel).toBe(
      SCAN_ANIMATION_STAGE_LABELS[SCAN_ANIMATION_TOTAL_STAGES - 1],
    );

    // 모든 행이 done.
    expect(vm.items).toHaveLength(SCAN_ANIMATION_TOTAL_STAGES);
    for (const item of vm.items) {
      expect(item.status).toBe('done');
      expect(item.isDone).toBe(true);
      expect(item.isActive).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Sub-AC 1 — 8단계 진행 + 3199ms vs 3200ms 완료 경계
// ---------------------------------------------------------------------------

describe('renderScanAnimationComponent — Sub-AC 1: 8-stage advance + 3200ms latch', () => {
  it('monotonic time inputs advance the view-model through all 8 stages in order', () => {
    // 단조 증가하는 시간 입력으로 컴포넌트 뷰모델을 구동하면
    // currentStageIndex가 0 → 7로 순서대로 전진해야 한다.
    const started = startScanAnimation(createScanAnimation(), 0);
    const visited: Array<number | null> = [];
    let state = started;
    visited.push(renderScanAnimationComponent(state).currentStageIndex);

    for (let i = 1; i < SCAN_ANIMATION_TOTAL_STAGES; i += 1) {
      state = tickScanAnimation(state, i * SCAN_ANIMATION_STAGE_DURATION_MS);
      const vm = renderScanAnimationComponent(state);
      // 모든 중간 단계는 running 이며 완료 플래그는 아직 false.
      expect(vm.isRunning).toBe(true);
      expect(vm.isComplete).toBe(false);
      visited.push(vm.currentStageIndex);
    }

    expect(visited).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('t=3199ms → 아직 stage 7 running, isComplete=false (완료 직전)', () => {
    const { state, vm } = projectAt(SCAN_ANIMATION_TOTAL_DURATION_MS - 1);
    // 상태 머신: 마지막 단계에 머무르되 아직 완료되지 않음.
    expect(state.phase).toBe('running');
    // 뷰모델 완료 플래그/단계 인덱스.
    expect(vm.phase).toBe('running');
    expect(vm.isComplete).toBe(false);
    expect(vm.isRunning).toBe(true);
    expect(vm.currentStageIndex).toBe(SCAN_ANIMATION_TOTAL_STAGES - 1);
    expect(vm.progressPercent).toBeLessThan(100);
    // 마지막 행은 아직 active (done 아님).
    const last = vm.items[SCAN_ANIMATION_TOTAL_STAGES - 1];
    expect(last?.status).toBe('active');
    expect(last?.isDone).toBe(false);
  });

  it('t=3200ms → stage 7 latched complete, isComplete=true (완료 정각)', () => {
    const { state, vm } = projectAt(SCAN_ANIMATION_TOTAL_DURATION_MS);
    expect(state.phase).toBe('complete');
    expect(vm.phase).toBe('complete');
    expect(vm.isComplete).toBe(true);
    expect(vm.isRunning).toBe(false);
    expect(vm.currentStageIndex).toBe(SCAN_ANIMATION_TOTAL_STAGES - 1);
    expect(vm.progressPercent).toBe(100);
    // 완료 시 마지막 행은 done.
    const last = vm.items[SCAN_ANIMATION_TOTAL_STAGES - 1];
    expect(last?.status).toBe('done');
    expect(last?.isDone).toBe(true);
  });

  it('완료 경계: 3199ms와 3200ms 사이에서 isComplete 플래그가 정확히 한 번 뒤집힌다', () => {
    // 같은 단조 타임라인을 따라 두 시점을 비교 — 1ms 차이가 완료를 가른다.
    const before = projectAt(SCAN_ANIMATION_TOTAL_DURATION_MS - 1).vm;
    const at = projectAt(SCAN_ANIMATION_TOTAL_DURATION_MS).vm;

    expect(before.isComplete).toBe(false);
    expect(at.isComplete).toBe(true);
    // 단계 인덱스는 두 시점 모두 7로 동일(마지막 단계에 래치).
    expect(before.currentStageIndex).toBe(at.currentStageIndex);
    expect(at.currentStageIndex).toBe(SCAN_ANIMATION_TOTAL_STAGES - 1);
  });
});

// ---------------------------------------------------------------------------
// Sub-AC 2 — complete 상태 래치가 1800ms 윈도(3200ms→4999ms) 동안 불변
// ---------------------------------------------------------------------------

describe('renderScanAnimationComponent — Sub-AC 2: complete latch holds across 3200..4999ms', () => {
  /**
   * 단일 단조 타임라인을 따라 애니메이션을 3200ms에 완료시킨 뒤,
   * 완료 이후 1800ms 윈도 안의 여러 시점을 다시 틱한다.
   * 상태 머신은 완료 시 prev를 그대로 반환(referential stability)하므로
   * 어떤 후속 틱도 stage/phase/progress를 변형하지 않아야 한다.
   */
  function completedTimeline(): {
    readonly completeState: ReturnType<typeof tickScanAnimation>;
  } {
    const started = startScanAnimation(createScanAnimation(), 0);
    // 0 → 7 단계를 순서대로 전진시킨 뒤 정각 3200ms에 완료.
    let state = started;
    for (let i = 1; i <= SCAN_ANIMATION_TOTAL_STAGES; i += 1) {
      state = tickScanAnimation(state, i * SCAN_ANIMATION_STAGE_DURATION_MS);
    }
    return { completeState: state };
  }

  /** 완료 윈도(3200ms~4999ms) 안의 대표 표본 시점들. */
  const WINDOW_SAMPLES: readonly number[] = Object.freeze([
    SCAN_ANIMATION_TOTAL_DURATION_MS, // 3200 (정각)
    3_201,
    3_500,
    4_000,
    4_500,
    4_800,
    4_999, // 윈도 마지막 (5000ms auto-advance 직전)
  ]);

  it('정각 3200ms에 complete로 래치되고 마지막 단계에 머문다', () => {
    const { completeState } = completedTimeline();
    expect(completeState.phase).toBe('complete');
    expect(completeState.currentStageIndex).toBe(
      SCAN_ANIMATION_TOTAL_STAGES - 1,
    );
    expect(completeState.elapsedMs).toBe(SCAN_ANIMATION_TOTAL_DURATION_MS);
    expect(completeState.progressPercent).toBe(100);
  });

  it('완료 이후 윈도 내 어떤 틱도 동일한 상태 참조를 반환한다 (no churn)', () => {
    const { completeState } = completedTimeline();
    let state = completeState;
    for (const ms of WINDOW_SAMPLES) {
      const next = tickScanAnimation(state, ms);
      // 완료 래치는 prev를 그대로 반환 — 참조 동등성으로 무변형을 보장.
      expect(next).toBe(completeState);
      state = next;
    }
  });

  it('윈도 전 구간에서 뷰모델이 구조적으로 동일하게 유지된다', () => {
    const { completeState } = completedTimeline();
    const baseline = renderScanAnimationComponent(completeState);

    for (const ms of WINDOW_SAMPLES) {
      const ticked = tickScanAnimation(completeState, ms);
      const vm = renderScanAnimationComponent(ticked);

      // phase / 완료 플래그 / 진행률 / 단계 인덱스가 baseline과 동일.
      expect(vm.phase).toBe('complete');
      expect(vm.isComplete).toBe(true);
      expect(vm.isRunning).toBe(false);
      expect(vm.isIdle).toBe(false);
      expect(vm.ariaLive).toBe('assertive');
      expect(vm.progressPercent).toBe(baseline.progressPercent);
      expect(vm.progressPercentText).toBe(baseline.progressPercentText);
      expect(vm.currentStageIndex).toBe(baseline.currentStageIndex);
      expect(vm.currentStageLabel).toBe(baseline.currentStageLabel);
      expect(vm.elapsedMs).toBe(baseline.elapsedMs);

      // 8개 행 상태가 한 칸도 변하지 않는다 — 전부 done.
      expect(vm.items.map((it) => it.status)).toEqual(
        baseline.items.map((it) => it.status),
      );
      for (const item of vm.items) {
        expect(item.status).toBe('done');
        expect(item.isDone).toBe(true);
        expect(item.isActive).toBe(false);
      }
    }
  });

  it('윈도 마지막(4999ms)과 정각(3200ms) 사이에 stage 변이가 없다', () => {
    const { completeState } = completedTimeline();
    const atLatch = renderScanAnimationComponent(
      tickScanAnimation(completeState, SCAN_ANIMATION_TOTAL_DURATION_MS),
    );
    const atWindowEnd = renderScanAnimationComponent(
      tickScanAnimation(completeState, 4_999),
    );
    expect(atWindowEnd.currentStageIndex).toBe(atLatch.currentStageIndex);
    expect(atWindowEnd.phase).toBe(atLatch.phase);
    expect(atWindowEnd.progressPercent).toBe(atLatch.progressPercent);
    expect(atWindowEnd.items.map((it) => it.status)).toEqual(
      atLatch.items.map((it) => it.status),
    );
  });

  it('비단조 후퇴 틱(윈도 내 시간 역행)에도 complete 래치가 풀리지 않는다', () => {
    // 5000ms auto-advance 와 공존하는 동안 늦게 도착한 타이머가
    // 더 이른 시각으로 틱하더라도 완료 상태가 유지되어야 한다.
    const { completeState } = completedTimeline();
    const backwards = tickScanAnimation(completeState, 3_300);
    expect(backwards).toBe(completeState);
    expect(backwards.phase).toBe('complete');
    expect(backwards.currentStageIndex).toBe(SCAN_ANIMATION_TOTAL_STAGES - 1);
  });
});

// ---------------------------------------------------------------------------
// Sub-AC 3 — 5000ms auto-advance 신호가 정확히 5000ms 경계에서 발생
// ---------------------------------------------------------------------------

describe('scanAnimationAutoAdvanceSignal — Sub-AC 3: 5000ms auto-advance 경계', () => {
  it('상수는 5000ms이며 시각 완료(3200ms)보다 크다 — 두 타임라인이 분리된다', () => {
    expect(SCAN_ANIMATION_AUTO_ADVANCE_MS).toBe(5_000);
    expect(SCAN_ANIMATION_AUTO_ADVANCE_MS).toBeGreaterThan(
      SCAN_ANIMATION_TOTAL_DURATION_MS,
    );
  });

  it('idle 상태(시작 전)에는 신호가 발생하지 않는다', () => {
    const idle = createScanAnimation();
    expect(scanAnimationAutoAdvanceSignal(idle, 5_000)).toBe(false);
    expect(scanAnimationAutoAdvanceSignal(idle, 10_000)).toBe(false);
  });

  it('t=4999ms → auto-advance 신호 없음 (5000ms 직전)', () => {
    const started = startScanAnimation(createScanAnimation(), 0);
    expect(
      scanAnimationAutoAdvanceSignal(
        started,
        SCAN_ANIMATION_AUTO_ADVANCE_MS - 1,
      ),
    ).toBe(false);
  });

  it('t=5000ms → auto-advance 신호 발생 (정각)', () => {
    const started = startScanAnimation(createScanAnimation(), 0);
    expect(
      scanAnimationAutoAdvanceSignal(started, SCAN_ANIMATION_AUTO_ADVANCE_MS),
    ).toBe(true);
  });

  it('4999ms↔5000ms 1ms 차이가 신호를 정확히 한 번 뒤집는다', () => {
    const started = startScanAnimation(createScanAnimation(), 0);
    const before = scanAnimationAutoAdvanceSignal(started, 4_999);
    const at = scanAnimationAutoAdvanceSignal(started, 5_000);
    expect(before).toBe(false);
    expect(at).toBe(true);
  });

  it('시각 완료(3200ms) 래치 이후에도 startedAtMs 기준 5000ms에서 신호가 뒤집힌다', () => {
    // 0 → 7 단계를 전진시켜 complete 래치(3200ms) 후에도 startedAtMs가
    // 보존되므로 auto-advance 신호는 여전히 5000ms 경계에서 동작한다.
    let state = startScanAnimation(createScanAnimation(), 0);
    for (let i = 1; i <= SCAN_ANIMATION_TOTAL_STAGES; i += 1) {
      state = tickScanAnimation(state, i * SCAN_ANIMATION_STAGE_DURATION_MS);
    }
    expect(state.phase).toBe('complete');
    expect(state.elapsedMs).toBe(SCAN_ANIMATION_TOTAL_DURATION_MS); // 3200 래치
    expect(scanAnimationAutoAdvanceSignal(state, 4_999)).toBe(false);
    expect(scanAnimationAutoAdvanceSignal(state, 5_000)).toBe(true);
  });

  it('비-제로 시작 시각에서도 경계가 startedAtMs 기준 상대값으로 평가된다', () => {
    const started = startScanAnimation(createScanAnimation(), 1_234);
    expect(scanAnimationAutoAdvanceSignal(started, 1_234 + 4_999)).toBe(false);
    expect(scanAnimationAutoAdvanceSignal(started, 1_234 + 5_000)).toBe(true);
  });

  it('5000ms 이후 시점에서는 계속 신호가 유지된다 (단조 latch)', () => {
    const started = startScanAnimation(createScanAnimation(), 0);
    for (const ms of [5_001, 6_000, 10_000]) {
      expect(scanAnimationAutoAdvanceSignal(started, ms)).toBe(true);
    }
  });

  it('NaN nowMs는 보수적으로 false (경계 평가 불가)', () => {
    const started = startScanAnimation(createScanAnimation(), 0);
    expect(scanAnimationAutoAdvanceSignal(started, Number.NaN)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 불변성 + 순수성
// ---------------------------------------------------------------------------

describe('renderScanAnimationComponent — 불변성 / 순수성', () => {
  it('반환 뷰모델·items 배열·각 행이 모두 frozen이다', () => {
    const samples: number[] = [
      0,
      200,
      400,
      1_200,
      2_800,
      SCAN_ANIMATION_TOTAL_DURATION_MS,
    ];
    for (const ms of samples) {
      const { vm } = projectAt(ms);
      expect(Object.isFrozen(vm)).toBe(true);
      expect(Object.isFrozen(vm.items)).toBe(true);
      for (const item of vm.items) {
        expect(Object.isFrozen(item)).toBe(true);
      }
    }
  });

  it('idle 입력을 변형하지 않는다', () => {
    const idle = createScanAnimation();
    const before = {
      phase: idle.phase,
      currentStageIndex: idle.currentStageIndex,
      elapsedMs: idle.elapsedMs,
      progressPercent: idle.progressPercent,
      startedAtMs: idle.startedAtMs,
    };
    renderScanAnimationComponent(idle);
    expect(idle.phase).toBe(before.phase);
    expect(idle.currentStageIndex).toBe(before.currentStageIndex);
    expect(idle.elapsedMs).toBe(before.elapsedMs);
    expect(idle.progressPercent).toBe(before.progressPercent);
    expect(idle.startedAtMs).toBe(before.startedAtMs);
  });

  it('items[i].label은 CANONICAL_SCAN_ANIMATION_STAGES와 1:1로 정합한다', () => {
    const vm = renderScanAnimationComponent();
    vm.items.forEach((it, i) => {
      const canonical = CANONICAL_SCAN_ANIMATION_STAGES[i];
      expect(canonical).toBeDefined();
      expect(it.label).toBe(canonical?.label);
      expect(it.index).toBe(canonical?.index);
    });
  });
});
