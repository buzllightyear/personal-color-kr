/**
 * Sub-AC 2.1 — `ScanAnimation` 컴포넌트의 순수 렌더 함수.
 *
 * 위치: Step 6 (`scan_option_select`) 직후 → Step 7 (selfie capture) 직전에
 * 재생되는 8단계 가짜 스캔 비주얼.  진행 로직은 형제 모듈
 * `./scan-animation.ts`(Sub-AC 10.2)가 이미 소유하고 있으며 본 모듈은 그
 * 진행 상태(`ScanAnimationState`)를 입력으로 받아 **순수 함수**로
 * 프레임워크 비종속 뷰모델을 만들어 돌려준다.
 *
 * 디자인 트윈:
 *   `src/funnel/analyzing-loader-component.ts` (Sub-AC 10.3) 가 5단계
 *   Analyzing 로더에 대해 같은 패턴을 이미 사용하고 있다.  본 모듈은 8단계
 *   스캔 애니메이션에 동일한 계약을 그대로 옮긴다 — `pending / active / done`
 *   3-상태 라벨, 진행률 문자열, ARIA live politeness, `key`/`testId` 결정성.
 *
 * Seed 그라운딩:
 *   - Ontology 개념 `scan_animation_ui` → 본 파일이 그 콘크리트 표현.
 *   - 제약 `commoditized_stack` → 벤더 호출 없음 (UI 비주얼 전용).
 *   - 제약 `creator_signature` → 8개 한국어 라벨은 `./scan-animation.ts`의
 *     단일 시그니처 보이스를 그대로 재사용한다 (재정의 금지).
 *   - 진행 로직 모듈은 절대 수정하지 않는다 — `import`로만 사용.
 *
 * 본 파일이 제공하는 것:
 *   1. `renderScanAnimationComponent(state)` — `(state) → 프로즌 뷰모델`
 *      순수 사상.  같은 입력은 같은 (구조적으로 동등한) 출력으로 사상된다.
 *
 * 본 파일이 제공하지 않는 것:
 *   - 타이머/컨트롤러 관리 — `useScanAnimation`(scan-animation.ts)이 담당.
 *   - 렌더 마운트 헬퍼 — Sub-AC 2.2 이상의 통합 단계에서 추가.
 *   - 실제 React/RN 어댑터 — 호스트 앱이 본 뷰모델을 1:1로 그린다.
 *
 * 불변성:
 *   반환 객체와 `items` 배열, 각 `items[i]`는 모두 `Object.freeze` 처리.
 *   `state`(입력)는 절대 변형하지 않는다.
 */
import {
  CANONICAL_SCAN_ANIMATION_STAGES,
  SCAN_ANIMATION_STAGE_LABELS,
  SCAN_ANIMATION_TOTAL_DURATION_MS,
  SCAN_ANIMATION_TOTAL_STAGES,
  createScanAnimation,
  type ScanAnimationPhase,
  type ScanAnimationStageIndex,
  type ScanAnimationState,
} from './scan-animation.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * UI 한 줄의 상태:
 *   - `pending` → 아직 도달하지 않은 단계 (회색 체크박스).
 *   - `active`  → 현재 애니메이션 중인 단계 (스피너/하이라이트).
 *   - `done`    → 끝난 단계 (체크 표시).
 *
 * `state.phase === 'complete'`인 경우 8개 단계 모두 `done`.
 */
export type ScanAnimationStageStatus = 'pending' | 'active' | 'done';

/**
 * 8개 단계 각각의 뷰모델 행.
 *
 * `key` / `testId`는 `scan-animation-stage-<index>` 형태로 결정적 —
 * React 키, 스냅샷 테스트, E2E 셀렉터 모두 동일한 식별자를 공유한다.
 * `isActive` / `isDone`는 `status`의 편의 별칭.
 */
export interface ScanAnimationStageItemViewModel {
  readonly index: ScanAnimationStageIndex;
  readonly label: string;
  readonly status: ScanAnimationStageStatus;
  readonly isActive: boolean;
  readonly isDone: boolean;
  readonly key: string;
  readonly testId: string;
}

/**
 * 호스트 앱이 1:1로 렌더링하는 최상위 뷰모델.
 *
 * 필드:
 *   - `phase` / `currentStageIndex` / `progressPercent` — 입력 상태에서
 *     그대로 옮김 (React 메모이제이션을 위해 단일 객체 참조로 노출).
 *   - `currentStageLabel` — 화면 하단 "지금: …" 텍스트 / 스크린리더 안내용.
 *   - `progressPercentText` — `"0%"` ~ `"100%"`로 미리 포맷팅 (렌더 코드에서
 *     문자열 결합을 하지 않도록).
 *   - `isRunning` / `isComplete` / `isIdle` — `phase` 비교의 편의 별칭.
 *   - `ariaLive` — 스크린리더 공손도; idle은 `off`, running은 `polite`,
 *     complete는 `assertive`.
 *   - `items` — 항상 길이 8, stage 0 → 7 정렬.
 *   - `totalStages` / `totalDurationMs` — UI가 자주 참조하므로 동봉.
 *   - `key` / `testId` — 루트 요소 식별자.
 */
export interface ScanAnimationComponentViewModel {
  readonly phase: ScanAnimationPhase;
  readonly currentStageIndex: ScanAnimationStageIndex | null;
  readonly currentStageLabel: string | null;
  readonly progressPercent: number;
  readonly progressPercentText: string;
  readonly elapsedMs: number;
  readonly totalStages: typeof SCAN_ANIMATION_TOTAL_STAGES;
  readonly totalDurationMs: typeof SCAN_ANIMATION_TOTAL_DURATION_MS;
  readonly isIdle: boolean;
  readonly isRunning: boolean;
  readonly isComplete: boolean;
  readonly ariaLive: 'off' | 'polite' | 'assertive';
  readonly items: readonly ScanAnimationStageItemViewModel[];
  readonly key: string;
  readonly testId: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** 한 단계의 status를 입력 상태로부터 도출.  순수 함수. */
function statusForIndex(
  state: ScanAnimationState,
  index: ScanAnimationStageIndex,
): ScanAnimationStageStatus {
  if (state.phase === 'complete') {
    // 완료 시 8단계 모두 done — 마지막 라벨도 체크 처리한다.
    return 'done';
  }
  if (state.phase === 'idle' || state.currentStageIndex === null) {
    return 'pending';
  }
  if (index < state.currentStageIndex) return 'done';
  if (index === state.currentStageIndex) return 'active';
  return 'pending';
}

function ariaLiveForPhase(phase: ScanAnimationPhase): 'off' | 'polite' | 'assertive' {
  // idle = 안내할 것 없음; running = 잦지만 공손; complete = 다음 화면이
  // 마운트되기 전 종료를 단호히 알리도록 assertive.
  switch (phase) {
    case 'idle':
      return 'off';
    case 'running':
      return 'polite';
    case 'complete':
      return 'assertive';
  }
}

function buildItems(
  state: ScanAnimationState,
): readonly ScanAnimationStageItemViewModel[] {
  return Object.freeze(
    CANONICAL_SCAN_ANIMATION_STAGES.map((stage) => {
      const status = statusForIndex(state, stage.index);
      return Object.freeze({
        index: stage.index,
        label: stage.label,
        status,
        isActive: status === 'active',
        isDone: status === 'done',
        key: `scan-animation-stage-${stage.index}`,
        testId: `scan-animation-stage-${stage.index}`,
      }) satisfies ScanAnimationStageItemViewModel;
    }),
  );
}

function currentStageLabel(state: ScanAnimationState): string | null {
  if (state.currentStageIndex === null) return null;
  const label = SCAN_ANIMATION_STAGE_LABELS[state.currentStageIndex];
  return label ?? null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** 루트 요소 식별자 (E2E 셀렉터 / React 키). */
export const SCAN_ANIMATION_COMPONENT_TEST_ID = 'scan-animation' as const;

/**
 * 화면(funnel step 8 `fake_scan_animation`)이 다음 단계(step 9 result reveal)로
 * 자동 전환하는 시점(ms).
 *
 * 스캔 *비주얼*은 `SCAN_ANIMATION_TOTAL_DURATION_MS`(= 3200ms)에 끝나지만
 * (8단계 × 400ms), sunk-cost priming 을 위해 화면은 그 이후로도 1800ms 더
 * 머문 뒤 5000ms 정각에 auto-advance 한다.  즉 두 타임라인은 분리되어 있다:
 *   - 3200ms → 시각 완료(complete 래치, 마지막 단계 done 고정)
 *   - 5000ms → 화면 auto-advance 신호(다음 funnel 단계로 이동)
 *
 * `FUNNEL_SCREENS.fake_scan_animation.metadata.durationMs`(= 5000)와 정합하는
 * 값이며, 본 모듈은 funnel 메타데이터를 import 하지 않고(순환/교차도메인 결합
 * 회피) 같은 상수를 로컬에 명시한다 — 둘은 동일해야 한다.
 */
export const SCAN_ANIMATION_AUTO_ADVANCE_MS = 5_000 as const;

/**
 * 순수 사상 — 상태 머신의 `startedAtMs` 기준 경과 시간으로부터 **auto-advance
 * 신호**(boolean)를 도출한다.  타이머/스케줄러를 소유하지 않으며, 호출자가
 * 주입한 `nowMs` 로만 평가하는 순수 함수다.
 *
 * 경계 규약:
 *   - `nowMs - startedAtMs < 5000` → `false` (아직 머무름)
 *   - `nowMs - startedAtMs >= 5000` → `true`  (정각 5000ms에 신호 발생)
 *
 * 완료 래치(3200ms)와 독립적이다.  상태가 `'complete'` 로 래치된 이후에도
 * `startedAtMs` 는 보존되므로(`tickScanAnimation` 의 complete 분기 참고)
 * 본 함수는 3200ms~5000ms 사이의 1800ms 윈도를 정확히 가로지른다.
 *
 * 방어:
 *   - 시작 전(`startedAtMs === null`) → 항상 `false`.
 *   - `nowMs` 가 NaN → `false` (경계 평가 불가 시 보수적으로 머무름).
 */
export function scanAnimationAutoAdvanceSignal(
  state: ScanAnimationState,
  nowMs: number,
): boolean {
  if (state.startedAtMs === null) return false;
  const elapsed = nowMs - state.startedAtMs;
  if (Number.isNaN(elapsed)) return false;
  return elapsed >= SCAN_ANIMATION_AUTO_ADVANCE_MS;
}

/**
 * 순수 사상 — 주어진 `ScanAnimationState`로부터 호스트 UI가 그릴 프로즌
 * 뷰모델을 만든다.  같은 입력은 (구조 동등성 기준으로) 같은 출력을 만든다.
 *
 * 기본값: 상태를 생략하면 `createScanAnimation()`의 idle 상태를 사용한다.
 * → SSR / 첫 프레임 / 프리뷰 모드에서 컨트롤러 없이도 호스트가 비어 있지
 * 않은 UI를 그릴 수 있다.
 */
export function renderScanAnimationComponent(
  state: ScanAnimationState = createScanAnimation(),
): ScanAnimationComponentViewModel {
  const items = buildItems(state);

  return Object.freeze({
    phase: state.phase,
    currentStageIndex: state.currentStageIndex,
    currentStageLabel: currentStageLabel(state),
    progressPercent: state.progressPercent,
    progressPercentText: `${state.progressPercent}%`,
    elapsedMs: state.elapsedMs,
    totalStages: SCAN_ANIMATION_TOTAL_STAGES,
    totalDurationMs: SCAN_ANIMATION_TOTAL_DURATION_MS,
    isIdle: state.phase === 'idle',
    isRunning: state.phase === 'running',
    isComplete: state.phase === 'complete',
    ariaLive: ariaLiveForPhase(state.phase),
    items,
    key: SCAN_ANIMATION_COMPONENT_TEST_ID,
    testId: SCAN_ANIMATION_COMPONENT_TEST_ID,
  }) satisfies ScanAnimationComponentViewModel;
}
