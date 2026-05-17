/**
 * Sub-AC 2.3 — ScanAnimation 단계 전이 상태 매퍼.
 *
 * 본 모듈은 `./scan-animation.ts`(Sub-AC 10.2)가 산출하는 *진행 값*(0..100
 * 정수 퍼센트, `ScanAnimationState.progressPercent` 와 동등한 시그니처)을
 * 받아 8단계 각각이 `pending | active | done` 중 어느 상태인지로 변환하는
 * **단일 순수 함수**를 노출한다.
 *
 * Seed 그라운딩:
 *   - Ontology 개념 `scan_animation_ui` — "8단계 스캔 비주얼 컴포넌트
 *     (scan-animation.ts 진행 로직 wrapping)"의 *상태 매핑* 슬롯.
 *   - 제약 `build_on_existing` → 진행 로직(`./scan-animation.ts`) 및
 *     컴포넌트 뷰모델(`./scan-animation-component.ts`)을 수정하지 않고
 *     `import` 만으로 합성한다.  단계 라벨/타이밍/totals 는 SSoT(진행 로직)
 *     에서 그대로 빌려 쓴다.
 *   - 제약 `creator_signature` → 8개 단계 자체는 진행 로직이 소유한 한국어
 *     시그니처 라벨을 그대로 유지한다 (본 모듈은 상태만 다룬다).
 *   - 제약 `commoditized_stack` → 벤더 호출 없음, DOM 의존 없음.
 *
 * 본 모듈이 제공하는 것:
 *   - `mapScanAnimationProgressToStageStatuses(progressPercent)` — 길이 8의
 *     프로즌 `ScanAnimationStageStatus[]` 를 돌려주는 단일 사상 함수.
 *
 * 본 모듈이 제공하지 않는 것:
 *   - 타이머/스케줄러 — `./scan-animation.ts` 의 컨트롤러가 담당.
 *   - 뷰모델 합성 / aria-live / testId — `./scan-animation-component.ts`가 담당.
 *   - 라벨 / 아이콘 메타데이터 — `./scan-animation-steps.ts`가 담당.
 *
 * 매핑 규약 (입력 → 활성 단계 인덱스):
 *   각 단계는 연속 퍼센트축 위에서 `[idx*12.5, (idx+1)*12.5)` 의 폭을 갖는다.
 *   입력은 호출 측 편의를 위해 0..100 *정수* 퍼센트로 받으며 다음 규칙으로
 *   유일한 활성 단계를 결정한다:
 *
 *     activeIdx = floor(progressPercent * TOTAL_STAGES / 100)
 *               (∈ [0, TOTAL_STAGES])  → TOTAL_STAGES (= 8) 인 경우 전체 done
 *
 *   결과적으로 정수 퍼센트 기준 단계 전이 경계는 다음과 같다:
 *     0..12   → 단계 0 active
 *     13..24  → 단계 1 active
 *     25..37  → 단계 2 active
 *     38..49  → 단계 3 active
 *     50..62  → 단계 4 active
 *     63..74  → 단계 5 active
 *     75..87  → 단계 6 active
 *     88..99  → 단계 7 active
 *     ≥ 100   → 8단계 전부 done
 *
 * 유효성:
 *   - NaN / 음수 입력 → 0 으로 클램핑 (애니메이션 시작 직전 상태와 동일).
 *   - 100 초과 입력 → 100 으로 클램핑 (전체 done).
 *   - 비정수 입력 허용 — 내부에서 floor 후 매핑한다.
 *
 * 불변성:
 *   - 반환 배열은 `Object.freeze` 처리되어 호출자에서 변형 불가.
 *   - 입력은 절대 변형하지 않는다 (스칼라 number 이므로 자명하지만 명시).
 */
import { SCAN_ANIMATION_TOTAL_STAGES } from './scan-animation.js';
import type { ScanAnimationStageStatus } from './scan-animation-component.js';

// ---------------------------------------------------------------------------
// 상수
// ---------------------------------------------------------------------------

/** 입력 progress 값의 하한 (0%, 시작 전 또는 시작 직후). */
export const SCAN_ANIMATION_PROGRESS_MIN_PERCENT = 0 as const;

/** 입력 progress 값의 상한 (100%, 완료 latch). */
export const SCAN_ANIMATION_PROGRESS_MAX_PERCENT = 100 as const;

// ---------------------------------------------------------------------------
// 내부 헬퍼
// ---------------------------------------------------------------------------

/** NaN / 음수는 0으로, 100 초과는 100으로 클램프한 *연속* 퍼센트 값을 돌려준다. */
function clampProgressPercent(progressPercent: number): number {
  if (Number.isNaN(progressPercent)) {
    return SCAN_ANIMATION_PROGRESS_MIN_PERCENT;
  }
  if (progressPercent <= SCAN_ANIMATION_PROGRESS_MIN_PERCENT) {
    return SCAN_ANIMATION_PROGRESS_MIN_PERCENT;
  }
  if (progressPercent >= SCAN_ANIMATION_PROGRESS_MAX_PERCENT) {
    return SCAN_ANIMATION_PROGRESS_MAX_PERCENT;
  }
  return progressPercent;
}

/**
 * 클램핑된 퍼센트 → 활성 단계 인덱스 후보.
 *
 * 100% 입력 시 `TOTAL_STAGES`(= 8) 를 돌려주며, 이는 *완료* 라는 의미로
 * `mapScanAnimationProgressToStageStatuses` 에서 전체 `done` 분기로 해석된다.
 */
function activeStageIndexForProgress(clampedPercent: number): number {
  const scaled =
    (clampedPercent * SCAN_ANIMATION_TOTAL_STAGES) /
    SCAN_ANIMATION_PROGRESS_MAX_PERCENT;
  // 100% 입력은 `scaled === TOTAL_STAGES` — 그대로 보존하여 호출자가
  // "활성 단계 없음(= 전체 done)" 분기를 인지하도록 한다.
  if (scaled >= SCAN_ANIMATION_TOTAL_STAGES) {
    return SCAN_ANIMATION_TOTAL_STAGES;
  }
  // 0..TOTAL_STAGES-1 범위로 안전하게 떨어진다.
  return Math.floor(scaled);
}

// ---------------------------------------------------------------------------
// 공개 API — 단일 사상 함수
// ---------------------------------------------------------------------------

/**
 * `progressPercent` (0..100) 를 받아 8단계 각각의 `pending|active|done`
 * 상태를 담은 *프로즌* 배열을 돌려주는 **단일 순수 함수**.
 *
 * 출력 배열은:
 *   - 길이가 정확히 `SCAN_ANIMATION_TOTAL_STAGES` (= 8) 이며
 *   - 인덱스 i 는 진행 로직의 단계 i (0..7) 와 1:1 정합하고
 *   - 100% 입력에서만 8개 전부 `done`, 그 외에는 정확히 하나의 `active` 와
 *     `active` 이전의 `done`, 이후의 `pending` 을 포함한다.
 *
 * 매핑 표는 모듈 docstring 의 "매핑 규약" 절을 참고한다.
 */
export function mapScanAnimationProgressToStageStatuses(
  progressPercent: number,
): readonly ScanAnimationStageStatus[] {
  const clamped = clampProgressPercent(progressPercent);
  const activeIdx = activeStageIndexForProgress(clamped);

  const statuses: ScanAnimationStageStatus[] = new Array(
    SCAN_ANIMATION_TOTAL_STAGES,
  );

  if (activeIdx >= SCAN_ANIMATION_TOTAL_STAGES) {
    // 100% → 전체 done.
    for (let i = 0; i < SCAN_ANIMATION_TOTAL_STAGES; i += 1) {
      statuses[i] = 'done';
    }
  } else {
    for (let i = 0; i < SCAN_ANIMATION_TOTAL_STAGES; i += 1) {
      if (i < activeIdx) {
        statuses[i] = 'done';
      } else if (i === activeIdx) {
        statuses[i] = 'active';
      } else {
        statuses[i] = 'pending';
      }
    }
  }

  return Object.freeze(statuses);
}
