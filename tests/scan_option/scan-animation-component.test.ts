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
  SCAN_ANIMATION_COMPONENT_TEST_ID,
  renderScanAnimationComponent,
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
