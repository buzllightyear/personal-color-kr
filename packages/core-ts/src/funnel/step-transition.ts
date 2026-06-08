/**
 * 결제 깔때기 단계 전환 로직 모듈 (Sub-AC 14a-4)
 *
 * 순수 함수형 전환 로직: 12단계 결제 깔때기의 순차 진입·후퇴·범위 검증.
 *
 * 설계 원칙:
 *   1. 순수 함수 (Pure functions): 모든 함수는 새 값을 반환하며 입력을 변이하지 않는다.
 *   2. 범위 초과 예외: 1 미만 또는 12 초과 단계 접근 시 `StepRangeError` throw.
 *   3. 순차 진입 강제: 단계 진입은 반드시 현재 단계 + 1 (뛰어 넘기 금지).
 *   4. 후퇴 가능: 현재 단계에서 이전 단계로 1씩 후퇴 가능 (최소 단계 1 초과 시).
 *
 * 퍼널 단계 범위: 1 ~ 12 (FUNNEL_STEPS_ORDERED 순서 기준).
 *
 * Public API:
 *   - validateStepRange(step)      → void | throws StepRangeError
 *   - enterNextStep(currentStep)   → nextStep (1→2→3 순차 진입)
 *   - retreatToPrevStep(currentStep) → prevStep (뒤로 이동)
 *   - StepRangeError               → 범위 초과 예외 클래스
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** 최소 유효 단계 번호 (첫 번째 단계). */
export const MIN_FUNNEL_STEP = 1 as const;

/** 최대 유효 단계 번호 (마지막 결제 단계). */
export const MAX_FUNNEL_STEP = 12 as const;

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

/**
 * `StepRangeError` — 단계 범위 초과 예외.
 *
 * 유효 범위([`MIN_FUNNEL_STEP`]..[`MAX_FUNNEL_STEP`])를 벗어난 단계 번호로
 * 전이를 시도할 때 throw된다.
 *
 * `requestedStep` 필드로 어떤 번호가 문제였는지 확인 가능.
 */
export class StepRangeError extends Error {
  public override readonly name = 'StepRangeError';
  /** 범위를 초과한 단계 번호 (요청된 값). */
  public readonly requestedStep: number;

  constructor(requestedStep: number, reason: string) {
    super(
      `Funnel step range error — requested step ${requestedStep}: ${reason}`,
    );
    this.requestedStep = requestedStep;
    // Restore prototype chain so `instanceof StepRangeError` works after transpilation.
    Object.setPrototypeOf(this, StepRangeError.prototype);
  }
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/**
 * `validateStepRange(step)` — 단계 범위 검증.
 *
 * `step`이 유효 범위([`MIN_FUNNEL_STEP`]..[`MAX_FUNNEL_STEP`]) 안에 있지 않으면
 * `StepRangeError`를 throw한다.
 *
 * @param step - 검증할 단계 번호 (정수 권장)
 * @throws {StepRangeError} 범위 초과 시
 *
 * @example
 * validateStepRange(1);   // ok
 * validateStepRange(12);  // ok
 * validateStepRange(0);   // throws StepRangeError
 * validateStepRange(13);  // throws StepRangeError
 * validateStepRange(-1);  // throws StepRangeError
 */
export function validateStepRange(step: number): void {
  if (step < MIN_FUNNEL_STEP) {
    throw new StepRangeError(
      step,
      `below minimum step ${MIN_FUNNEL_STEP}`,
    );
  }
  if (step > MAX_FUNNEL_STEP) {
    throw new StepRangeError(
      step,
      `above maximum step ${MAX_FUNNEL_STEP}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Forward transition (1→2→3 순차 진입)
// ---------------------------------------------------------------------------

/**
 * `enterNextStep(currentStep)` — 순차 전진 전이 (1→2→3).
 *
 * 현재 단계에서 다음 단계(`currentStep + 1`)로 이동한다.
 * 다음 단계가 최대 범위를 초과하거나, 현재 단계 자체가 유효 범위 밖이면
 * `StepRangeError`를 throw한다.
 *
 * 뛰어 넘기 금지: 정확히 1씩 증가하는 순차 진입만 허용한다.
 *
 * @param currentStep - 현재 단계 번호 (1..12)
 * @returns 다음 단계 번호 (`currentStep + 1`, 2..12)
 * @throws {StepRangeError} `currentStep < MIN_FUNNEL_STEP`, `currentStep > MAX_FUNNEL_STEP`,
 *   또는 `currentStep === MAX_FUNNEL_STEP` (마지막 단계에서 전진 불가) 시
 *
 * @example
 * enterNextStep(1);  // → 2
 * enterNextStep(2);  // → 3
 * enterNextStep(11); // → 12
 * enterNextStep(12); // throws StepRangeError (마지막 단계 초과)
 * enterNextStep(0);  // throws StepRangeError (최소 미만)
 * enterNextStep(13); // throws StepRangeError (최대 초과)
 */
export function enterNextStep(currentStep: number): number {
  // Validate current step is in range first.
  validateStepRange(currentStep);

  const nextStep = currentStep + 1;

  // Advancing past the last step is out of range.
  if (nextStep > MAX_FUNNEL_STEP) {
    throw new StepRangeError(
      nextStep,
      `cannot advance past maximum step ${MAX_FUNNEL_STEP} — funnel already at last step`,
    );
  }

  return nextStep;
}

// ---------------------------------------------------------------------------
// Backward transition (뒤로 이동)
// ---------------------------------------------------------------------------

/**
 * `retreatToPrevStep(currentStep)` — 후퇴 전이 (뒤로 이동).
 *
 * 현재 단계에서 이전 단계(`currentStep - 1`)로 이동한다.
 * 이전 단계가 최소 범위 미만이거나, 현재 단계 자체가 유효 범위 밖이면
 * `StepRangeError`를 throw한다.
 *
 * @param currentStep - 현재 단계 번호 (1..12)
 * @returns 이전 단계 번호 (`currentStep - 1`, 1..11)
 * @throws {StepRangeError} `currentStep < MIN_FUNNEL_STEP`, `currentStep > MAX_FUNNEL_STEP`,
 *   또는 `currentStep === MIN_FUNNEL_STEP` (첫 번째 단계에서 후퇴 불가) 시
 *
 * @example
 * retreatToPrevStep(3);  // → 2
 * retreatToPrevStep(2);  // → 1
 * retreatToPrevStep(1);  // throws StepRangeError (최소 미만으로 후퇴 불가)
 * retreatToPrevStep(0);  // throws StepRangeError (최소 미만 입력)
 * retreatToPrevStep(13); // throws StepRangeError (최대 초과 입력)
 */
export function retreatToPrevStep(currentStep: number): number {
  // Validate current step is in range first.
  validateStepRange(currentStep);

  const prevStep = currentStep - 1;

  // Retreating below the first step is out of range.
  if (prevStep < MIN_FUNNEL_STEP) {
    throw new StepRangeError(
      prevStep,
      `cannot retreat before minimum step ${MIN_FUNNEL_STEP} — funnel already at first step`,
    );
  }

  return prevStep;
}
