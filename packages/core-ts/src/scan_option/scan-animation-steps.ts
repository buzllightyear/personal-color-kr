/**
 * Sub-AC 2.2 — 8단계 스텝 메타데이터 모듈.
 *
 * 위치/역할:
 *   Step 6 (`scan_option_select`) 직후 → Step 7(셀피 캡쳐) 직전에 재생되는
 *   8단계 가짜 스캔 애니메이션(ScanAnimation)의 **메타데이터**(라벨 / 아이콘 /
 *   순서)를 한 곳에 모은 단일 상수 모듈.  진행 로직(`./scan-animation.ts`,
 *   Sub-AC 10.2)과 뷰모델 합성(`./scan-animation-component.ts`, Sub-AC 2.1)은
 *   이미 존재하므로 **재구현 금지** — 본 모듈은 그 위에 얹는 *순수 상수 +
 *   조회 함수* 레이어에 불과하다.
 *
 * Seed 그라운딩:
 *   - Ontology 개념 `scan_animation_ui`(8단계 스캔 비주얼 컴포넌트)의
 *     "라벨/아이콘/순서" 슬롯을 정확히 채운다.
 *   - 제약 `build_on_existing` → 라벨은 `scan-animation.ts`의
 *     `SCAN_ANIMATION_STAGE_LABELS`를 단일 진실(SSoT)로 재사용한다.
 *     라벨 텍스트를 본 모듈에서 재선언하면 시그니처가 두 갈래로 갈라지므로
 *     반드시 import 만 사용한다.
 *   - 제약 `korean_signature` → 라벨/아이콘 시그니처는 한국 시장 친화 톤으로
 *     '얼굴 감지 → 결과 준비'의 한국어 스캔 내러티브 한 줄.
 *   - 제약 `commoditized_stack` → 벤더 의존 없음.  아이콘은 *프레임워크
 *     비종속 식별자*(short string) — 실제 SVG/PNG는 호스트 앱(UI 어댑터)이
 *     매핑한다.  여기서는 자산을 import 하지 않는다.
 *
 * 본 모듈이 제공하는 것:
 *   1. `SCAN_ANIMATION_STEPS` — 길이 8, stage 0 → 7로 정렬된 프로즌 배열.
 *      각 항목은 `{ index, label, icon, order }`(전부 readonly).
 *   2. `SCAN_ANIMATION_STEP_ORDER` — 순서대로 나열된 8개 인덱스 튜플.
 *   3. `SCAN_ANIMATION_STEP_ICONS` — 8개 아이콘 식별자 튜플 (순서 일치).
 *   4. `getScanAnimationStep(index)` — 인덱스 → 메타데이터 단일 조회.
 *   5. `findScanAnimationStepByLabel(label)` / `findScanAnimationStepByIcon(icon)`
 *      — 역방향 조회.  미존재 시 `null`.
 *   6. `isScanAnimationStepIndex(value)` — 0..7 범위 검사용 type guard.
 *
 * 본 모듈이 제공하지 않는 것:
 *   - 타이밍(400 ms × 8 = 3200 ms)은 `./scan-animation.ts`에 있고 본 메타데이터의
 *     역할이 아니다 — 다만 같은 stage 인덱스를 공유하므로 두 모듈의 길이/순서
 *     계약은 테스트에서 정합성을 함께 검증한다.
 *   - 렌더 뷰모델(`status: pending|active|done`)은 `./scan-animation-component.ts`.
 *
 * 불변성:
 *   - 모든 export 상수 / 반환 객체는 `Object.freeze`.  타입 시스템은
 *     `readonly` 로 의도를 표현하고, 런타임 동결로 실수 변형을 차단한다.
 */
import {
  CANONICAL_SCAN_ANIMATION_STAGES,
  SCAN_ANIMATION_STAGE_LABELS,
  SCAN_ANIMATION_TOTAL_STAGES,
  type ScanAnimationStageIndex,
} from './scan-animation.js';

// ---------------------------------------------------------------------------
// 아이콘 식별자
// ---------------------------------------------------------------------------

/**
 * 호스트 UI 어댑터가 실제 SVG/PNG로 매핑할 *논리적* 아이콘 식별자.
 *
 * - 짧고 결정적(영문 케밥-케이스)이며 자산 경로를 포함하지 않는다.
 * - 8개 스텝과 1:1 — 추가/삭제는 `SCAN_ANIMATION_TOTAL_STAGES`와 동시에만.
 * - 시그니처 매핑(라벨 ↔ 아이콘):
 *     얼굴 감지       ↔ `face-detect`
 *     윤곽 분석       ↔ `face-contour`
 *     피부 영역 추출   ↔ `skin-region`
 *     눈 영역 분석     ↔ `eye-region`
 *     입술 영역 분석   ↔ `lip-region`
 *     컬러 샘플링     ↔ `color-sampling`
 *     톤 매칭         ↔ `tone-matching`
 *     결과 준비       ↔ `result-ready`
 */
export type ScanAnimationStepIcon =
  | 'face-detect'
  | 'face-contour'
  | 'skin-region'
  | 'eye-region'
  | 'lip-region'
  | 'color-sampling'
  | 'tone-matching'
  | 'result-ready';

/**
 * 8개 스텝의 아이콘 식별자 — 라벨 순서와 정확히 정합한다.
 * 별도 export 하여 UI 어댑터가 아이콘만 빠르게 매핑할 수 있게 한다.
 */
export const SCAN_ANIMATION_STEP_ICONS: readonly [
  ScanAnimationStepIcon,
  ScanAnimationStepIcon,
  ScanAnimationStepIcon,
  ScanAnimationStepIcon,
  ScanAnimationStepIcon,
  ScanAnimationStepIcon,
  ScanAnimationStepIcon,
  ScanAnimationStepIcon,
] = Object.freeze([
  'face-detect',
  'face-contour',
  'skin-region',
  'eye-region',
  'lip-region',
  'color-sampling',
  'tone-matching',
  'result-ready',
] as const);

// ---------------------------------------------------------------------------
// 스텝 메타데이터
// ---------------------------------------------------------------------------

/**
 * 한 스텝의 메타데이터 — UI 어댑터가 직접 그리거나 다른 모듈에서 참조한다.
 *
 * 필드:
 *   - `index` : 0..7 의 단계 인덱스 (`ScanAnimationStageIndex`).
 *   - `label` : `SCAN_ANIMATION_STAGE_LABELS[index]` — 한국어 시그니처 라벨.
 *   - `icon`  : 본 모듈에서 정의한 논리적 아이콘 식별자.
 *   - `order` : 1-기반 표시 순번 (= `index + 1`).  스크린리더 안내 / "n/8"
 *               표기에서 사람이 읽는 숫자가 필요하므로 동봉한다.
 */
export interface ScanAnimationStep {
  readonly index: ScanAnimationStageIndex;
  readonly label: string;
  readonly icon: ScanAnimationStepIcon;
  readonly order: number;
}

/**
 * 8개 스텝 메타데이터 — `index` 오름차순 정렬, 길이는 정확히 8.
 *
 * `CANONICAL_SCAN_ANIMATION_STAGES`와 1:1로 정합하며 라벨은 동일 SSoT를 공유한다.
 * 다만 본 배열은 *아이콘 + 1-기반 order* 정보가 추가되어 UI 메타 전용 채널을
 * 별도로 노출한다.
 */
export const SCAN_ANIMATION_STEPS: readonly ScanAnimationStep[] = Object.freeze(
  CANONICAL_SCAN_ANIMATION_STAGES.map((stage, i) => {
    const icon = SCAN_ANIMATION_STEP_ICONS[i] as ScanAnimationStepIcon;
    return Object.freeze({
      index: stage.index,
      label: stage.label,
      icon,
      order: stage.index + 1,
    }) satisfies ScanAnimationStep;
  }),
);

/**
 * 순서대로 나열된 8개 인덱스 튜플 — `[0, 1, 2, 3, 4, 5, 6, 7]`.
 *
 * 별도 export 하여 호스트가 `map` / `forEach`로 인덱스 순회 시 본 모듈의
 * 정렬 계약을 외부에서 신뢰할 수 있게 한다.
 */
export const SCAN_ANIMATION_STEP_ORDER: readonly ScanAnimationStageIndex[] =
  Object.freeze(SCAN_ANIMATION_STEPS.map((s) => s.index));

// ---------------------------------------------------------------------------
// 조회 함수
// ---------------------------------------------------------------------------

/**
 * 0..7 범위의 정수인지 검사하는 type guard.
 *
 * 외부에서 들어온 임의 값(라우터 쿼리, 분석 이벤트 payload 등)을 안전하게
 * `ScanAnimationStageIndex`로 좁히기 위해 노출한다.
 */
export function isScanAnimationStepIndex(
  value: unknown,
): value is ScanAnimationStageIndex {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value < SCAN_ANIMATION_TOTAL_STAGES
  );
}

/**
 * 인덱스로 스텝을 조회한다.  유효 범위 밖이면 명시적으로 throw —
 * UI가 silently null을 무시해 빈 칸을 렌더하지 않도록 한다.
 */
export function getScanAnimationStep(
  index: ScanAnimationStageIndex,
): ScanAnimationStep {
  if (!isScanAnimationStepIndex(index)) {
    throw new RangeError(
      `getScanAnimationStep: index out of range — expected 0..${
        SCAN_ANIMATION_TOTAL_STAGES - 1
      }, got ${String(index)}`,
    );
  }
  return SCAN_ANIMATION_STEPS[index] as ScanAnimationStep;
}

/**
 * 한국어 라벨 → 스텝 메타데이터 역방향 조회.  미존재 시 `null`.
 *
 * 분석 이벤트 / 로그 파싱에서 라벨 문자열을 받아 인덱스를 다시 결정해야 할 때
 * 사용한다.  대소문자 / 공백 정규화는 하지 않는다 — 라벨은 시그니처 그대로의
 * 한국어 텍스트이므로 정확한 매칭이 강제다.
 */
export function findScanAnimationStepByLabel(
  label: string,
): ScanAnimationStep | null {
  const found = SCAN_ANIMATION_STEPS.find((s) => s.label === label);
  return found ?? null;
}

/**
 * 아이콘 식별자 → 스텝 메타데이터 역방향 조회.  미존재 시 `null`.
 *
 * 아이콘 식별자는 본 모듈이 단일 소유 — 타입 시스템이 좁혀준 입력이라도
 * 런타임에 매칭 실패할 수 있는 `string`을 허용한다 (분석 이벤트 등).
 */
export function findScanAnimationStepByIcon(
  icon: ScanAnimationStepIcon | string,
): ScanAnimationStep | null {
  const found = SCAN_ANIMATION_STEPS.find((s) => s.icon === icon);
  return found ?? null;
}

// ---------------------------------------------------------------------------
// 정합성 — 모듈 로드 시점에 라벨 SSoT가 어긋났는지 즉시 감지한다.
// ---------------------------------------------------------------------------

// 빌드/테스트 모두에서 한 번 검증 — 라벨 배열과 아이콘 배열 길이가 어긋나면
// 메타데이터 모듈은 의미가 없으므로 모듈 로드 자체를 실패시킨다.
if (SCAN_ANIMATION_STEP_ICONS.length !== SCAN_ANIMATION_STAGE_LABELS.length) {
  throw new Error(
    'scan-animation-steps: icon count must match label count ' +
      `(icons=${SCAN_ANIMATION_STEP_ICONS.length}, ` +
      `labels=${SCAN_ANIMATION_STAGE_LABELS.length}).`,
  );
}
