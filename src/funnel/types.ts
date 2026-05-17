/**
 * Glam Up 12단계 결제 깔때기 — 한국 변형 (Korean Variant)
 *
 * Steps 1-9: Standard Glam Up funnel (그대로 구현, wording/시각만 본인 직감)
 * Steps 10-12: Korean variants
 *   - Step 10: 1명 친구 추천 게이트 (replaces 50% off referral)
 *   - Step 11: 단계 진화 사회 증명 (UGC + 인플루언서 인용, replaces fake Figma reviews)
 *   - Step 12: 결제 모델 변형 ($12/월 or $59/연; 연결제 = 7일 무료체험 + 30일 추가 = 37일)
 *
 * Seed Constraint:
 *   - 깔때기 단계 skip·재배치 금지 (no skipping/reordering)
 *   - Single exception: Step 4 (rating_gate) — iOS native dialog, dismissable
 */

/**
 * Identifier for each of the 12 funnel steps.
 * Numeric ordering is meaningful — transitions must respect 1 → 2 → ... → 12.
 */
export type FunnelStepId =
  | 'welcome_hook'           // Step 1: 퍼스널 컬러 진단 hook 인입
  | 'value_props'            // Step 2: 가치 제안 (트렌드 맞춤 편집/생성)
  | 'social_proof_intro'     // Step 3: 초기 사회적 증거 (간단 카피)
  | 'rating_gate'            // Step 4: iOS native 별점 dialog (dismissable)
  | 'price_anchoring'        // Step 5: 가격 anchoring (high price 노출 → 손실 회피)
  | 'scan_option_select'     // Step 6: 3개 스캔 옵션 (메인=퍼스널 컬러)
  | 'diagnosis_input'        // Step 7: 셀카 업로드 + 온보딩 질문
  | 'fake_loader'            // Step 8: 가짜 5초 로더 (앵커링 강화)
  | 'result_reveal'          // Step 9: 진단 결과 부분 공개 (잠금)
  | 'referral_gate'          // Step 10 (KR variant): 1명 친구 추천 게이트
  | 'social_evolution'       // Step 11 (KR variant): UGC + 인플루언서 인용
  | 'payment_model';         // Step 12 (KR variant): $12/월 or $59/연 + 37일 무료체험

/**
 * Terminal states (not numbered steps).
 */
export type FunnelTerminalState =
  | 'idle'        // 시작 전 (before step 1)
  | 'completed'   // 결제 완료 (after step 12)
  | 'abandoned';  // 사용자 이탈

/**
 * Full state space: the current location of a user in the funnel.
 */
export type FunnelState = FunnelStepId | FunnelTerminalState;

/**
 * Ordered list of the 12 steps in canonical sequence.
 * Index 0 = step 1.  Step number = index + 1.
 */
export const FUNNEL_STEPS_ORDERED: readonly FunnelStepId[] = [
  'welcome_hook',
  'value_props',
  'social_proof_intro',
  'rating_gate',
  'price_anchoring',
  'scan_option_select',
  'diagnosis_input',
  'fake_loader',
  'result_reveal',
  'referral_gate',
  'social_evolution',
  'payment_model',
] as const;

/** Total number of funnel steps (always 12). */
export const TOTAL_FUNNEL_STEPS = 12 as const;

/**
 * Event types emitted by the state machine.
 * Maps onto the `payment_funnel_event` ontology concept for PostHog logging.
 */
export type FunnelEventType =
  | 'step_entered'
  | 'step_completed'
  | 'step_skipped'   // only allowed for `rating_gate`
  | 'funnel_started'
  | 'funnel_completed'
  | 'funnel_abandoned';

/**
 * Immutable event record. Append-only log = `payment_funnel_event[]`.
 */
export interface FunnelEvent {
  readonly type: FunnelEventType;
  readonly state: FunnelState;
  readonly stepNumber: number | null; // 1..12, null for idle/completed/abandoned
  readonly timestamp: number;          // ms epoch
}

/**
 * Snapshot of progress at a point in time.
 */
export interface FunnelProgress {
  readonly state: FunnelState;
  readonly stepNumber: number | null;     // 1..12, null in terminal non-step states
  readonly completedSteps: readonly FunnelStepId[];
  readonly progressPercent: number;       // 0..100 (rounded to nearest integer)
  readonly isComplete: boolean;
  readonly isAbandoned: boolean;
}

/**
 * Immutable state machine instance.
 * Mutations return a NEW instance (no in-place updates) per coding-style rules.
 */
export interface FunnelMachine {
  readonly state: FunnelState;
  readonly history: readonly FunnelEvent[];
  readonly completedSteps: readonly FunnelStepId[];
}

/**
 * Errors thrown by the state machine for invalid transitions.
 */
export class InvalidTransitionError extends Error {
  public override readonly name = 'InvalidTransitionError';
  public readonly from: FunnelState;
  public readonly to: FunnelState;

  constructor(from: FunnelState, to: FunnelState, reason: string) {
    super(`Invalid transition ${from} -> ${to}: ${reason}`);
    this.from = from;
    this.to = to;
  }
}
