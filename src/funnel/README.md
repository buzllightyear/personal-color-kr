# Glam Up 12단계 결제 깔때기 (Korean Variant)

Pure-functional state machine for the Glam Up payment funnel, instrumented for
PostHog `payment_funnel_event` logging.

## The 12 Steps

| # | Step ID              | Purpose                                          |
|---|----------------------|--------------------------------------------------|
| 1 | `welcome_hook`       | 퍼스널 컬러 진단 hook 인입                          |
| 2 | `value_props`        | 가치 제안 (트렌드 맞춤 편집/생성)                    |
| 3 | `social_proof_intro` | 초기 사회적 증거                                   |
| 4 | `rating_gate`        | iOS native 별점 dialog (dismissable — skippable)  |
| 5 | `price_anchoring`    | 가격 anchoring (손실 회피)                         |
| 6 | `scan_option_select` | 3개 스캔 옵션 (메인 = 퍼스널 컬러)                   |
| 7 | `diagnosis_input`    | 셀카 업로드 + 온보딩 질문                           |
| 8 | `fake_loader`        | 가짜 5초 로더                                      |
| 9 | `result_reveal`      | 진단 결과 부분 공개                                 |
| **10** | `referral_gate`     | **KR variant** — 1명 친구 추천                    |
| **11** | `social_evolution`  | **KR variant** — UGC + 인플루언서 인용             |
| **12** | `payment_model`     | **KR variant** — $12/월 or $59/연 + 37일 무료체험 |

## Rules

- **No skip / no reorder** (Seed constraint `glamup_funnel_fidelity`).
- Single exception: step 4 (`rating_gate`) — iOS native dialog may be dismissed.
- Terminal states: `idle`, `completed`, `abandoned`.
- Active state → `abandoned` is always permitted (for analytics).
- All transitions emit append-only `FunnelEvent` records (PostHog-aligned).

## API

```ts
import {
  createFunnel,
  startFunnel,
  advanceStep,
  skipStep,
  abandonFunnel,
  getProgress,
  isTransitionAllowed,
} from './funnel/index.js';

let m = createFunnel();              // state = 'idle'
m = startFunnel(m);                  // state = 'welcome_hook' (step 1)
m = advanceStep(m);                  // state = 'value_props' (step 2)
// ... fast-forward to rating_gate
m = skipStep(m);                     // skip iOS rating dialog → price_anchoring
// ... walk through steps 5-12
m = advanceStep(m);                  // from payment_model → 'completed'

getProgress(m);
// { state: 'completed', stepNumber: null, progressPercent: 100,
//   isComplete: true, isAbandoned: false, completedSteps: [...11 + payment_model] }
```

## Immutability

All API functions return **new frozen instances**.  Original instances are never
mutated — safe for React state, Redux, Zustand, or any FP pipeline.

## Testing

```bash
npm test                 # vitest run
npm run test:coverage    # with v8 coverage (80%+ enforced)
```
