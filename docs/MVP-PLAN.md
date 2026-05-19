# personal-color-kr — MVP Plan

> Ouroboros Seed v0.2.0 기반. 13 AC 코어 구현·테스트 완료(commit `eb13b1f`)
> 후의 MVP launch까지 작업 분해. 각 work unit은 `/ouroboros:interview` 한
> 번에 들어가는 적정 크기 (5~8 ACs / 1~2 stack).

## 현재까지 진행된 것

- **Seed v0.2.0** (QA PASS 0.92) — 13개 AC, 11개 constraints, ontology, evaluation_principles
- **코어 구현**: 49 source files · 7 modules (`funnel`/`personal_color`/`retention`/`scan_option`/`image_edit`/`referral`/`content`)
- **테스트**: 1,710 통과 (pytest 940 + vitest 770) · 커버리지 95%/98.4%
- **Ouroboros 3-stage evaluation**: APPROVED (Stage 2 score 0.82, drift 0.10)
- **Git**: main · root commit `eb13b1f` · 127 files · +41,511 lines

## 작업 분해 (24 work units · 7 phases)

### Phase 1 — Foundation (인프라 셋업)
| ID | 작업 | 비고 |
|----|------|------|
| 1.1 | ✅ Expo RN 앱 셸 + pnpm monorepo + 기본 라우팅 | TS/RN |
| 1.2 | ✅ vendor 계정·키 setup (Fal.ai·PostHog·Superwall) + smoke-tests | secrets |
| 1.3 | ⊂1.2 환경변수·secrets 관리 — 1.2에 흡수 (app.config.ts + .env + python-dotenv) | — |
| 1.4 | ✅ CI 최소 (GitHub Actions · ubuntu/Node 20/Python 3.12 · typecheck + vitest + pytest) | yaml |

### Phase 2 — 12단계 깔때기 wiring (acquisition vehicle)
| ID | 작업 | 비고 |
|----|------|------|
| 2.1 | ✅ RN navigation stack (semantic-kebab 12 placeholder + 4중 정합 + deep-link 6-path + guards + funnel_step_entered) | TS/RN |
| 2.2 | ✅ 1~5단계 screens (welcome → fake Analyzing 5초; 한국어 카피·디자인 토큰·FunnelStateContext·rating-gate modal·5s autoAdvance) | TS/RN |
| 2.3 | ✅ 6~9단계 screens (scan_option → result_reveal; 24-point face scan animation + locked assets + diagnosisInput Context slice + Phase 2.1 isPreviewMode 보존) | TS/RN |
| 2.4 | ✅ 10~12단계 한국 변형 (referral_gate · social_evolution · payment_model 한국 변형 UI shell + state slices + 결제 placeholder + premium unlock BackHandler) | TS/RN |
| 2.5 | Superwall paywall + StoreKit 구독 결제 통합 | iOS |
| 2.6 | PostHog 12단계 이벤트 emit wire-up | TS |

### Phase 3 — Post-payment delivery (첫 패키지 4종 실연동)
| ID | 작업 | 비고 |
|----|------|------|
| 3.1 | Fal.ai 실제 API call wiring (Replicate에서 변경됨, 1.2 결정) | Py |
| 3.2 | Personal color diagnosis 런타임 wiring (Python invoke) | Py |
| 3.3 | ContentPackage 4종 화면 (진단·편집·가이드·큐레이션) | TS/RN |
| 3.4 | result_wording 톤 혼합 화면 적용 | TS/RN |

### Phase 4 — Backend & persistence
| ID | 작업 | 비고 |
|----|------|------|
| 4.1 | FastAPI 서버 + Postgres 셋업 | Py |
| 4.2 | 사용자/이벤트 schema + migration | SQL |
| 4.3 | 인증 (Apple Sign In + Supabase or Firebase) | TS+Py |
| 4.4 | retention API 호스팅 + PostHog cohort 연동 | Py |
| 4.5 | 친구 추천 게이트 실서버 wiring (영속화 + friend-used callback) | Py+TS |

### Phase 5 — Retention layer (월간 매거진)
| ID | 작업 | 비고 |
|----|------|------|
| 5.1 | CMS 선정 + magazine 영속화 모델 | Py |
| 5.2 | 매월 발행 cron + 푸시 통보 | Py+iOS |
| 5.3 | **본인 시그니처 콘텐츠 작성** (16 가이드 + 4 큐레이션 + 매거진 1-3개월치) | 콘텐츠 |

### Phase 6 — Polish (UX 게이트·관측)
| ID | 작업 | 비고 |
|----|------|------|
| 6.1 | iOS native `SKStoreReviewController` 실연결 | iOS |
| 6.2 | fake loader + scan animation RN 컴포넌트로 mount | TS/RN |
| 6.3 | Latency 모니터링 + alert | infra |
| 6.4 | Lint (ruff/black/eslint/mypy) + 코드 품질 | tooling |

### Phase 7 — Launch
| ID | 작업 | 비고 |
|----|------|------|
| 7.1 | App Store metadata + screenshots + reviews 카피 | 마케팅 |
| 7.2 | Sentry or 유사 모니터링 | infra |
| 7.3 | TestFlight beta | iOS |
| 7.4 | Production 배포 | iOS |

## 의존 그래프

```
1.1 → 1.2 (1.3 흡수) ─┐
                       ├→ 2.1 → 2.2 → 2.3 → 2.4 → 2.5 → 2.6
                  │                                  │
4.1 → 4.2 → 4.3 ──┘                                  ├→ 3.1 → 3.2 → 3.3 → 3.4
4.4 ←─ (depends on 1.3)                              │
4.5 ←─ (depends on 2.4 referral screen + 4.3 auth)   │
                                                      ├→ 6.1 → 6.2
5.1 → 5.2 ←──────────────────────────────────────────┘
5.3 (병행 가능, 코드 무관)
6.3, 6.4 (병행 가능)
7.x (모든 Phase 1-6 완료 후)
```

## 워크플로우

각 work unit은:

```
/ouroboros:interview <work_unit>   ← Socratic 질문으로 모호함 제거
/ouroboros:seed                     ← 검증된 Seed YAML 생성
/ouroboros:run <seed_path>          ← 실행
/ouroboros:evaluate <session_id>    ← 3-stage 검증
```

## 진척 추적

| Phase | 시작 | 완료 | Session | Commit | QA |
|-------|------|------|---------|--------|-----|
| 1.1 | 2026-05-17 | 2026-05-17 | `orch_7cb5e676e782` | `39f125a` | APPROVED · Stage 2 · 0.82 |
| 1.2 | 2026-05-17 | 2026-05-18 | `orch_2e32f14a3b34` | `7d844f3` | APPROVED · Stage 2 · 0.92 |
| 1.3 | — | — | — | — | ⊂1.2 흡수 (skipped) |
| 1.4 | 2026-05-18 | 2026-05-18 | `orch_b6c7e29cc70a` | `d27410e` | APPROVED · Stage 2 · 0.88 |
| 2.1 | 2026-05-18 | 2026-05-18 | `orch_d14ea24993ef` | `8f8928f` | APPROVED · Stage 2 · 0.92 |
| 2.2 | 2026-05-18 | 2026-05-19 | `orch_f9fd2fbeb451` | `eaadaa2` | APPROVED · Stage 2 · 0.93 |
| 2.3 | 2026-05-18 | 2026-05-19 | `orch_cd33a0972630` | `8be0230` | APPROVED · Stage 2 · 0.92 |
| 2.4 | 2026-05-19 | 2026-05-20 | `orch_a7ebcc674886` | `07132de` | APPROVED · Stage 2 · 0.93 |
| 2.5 | — | — | | | 다음 단계 |
| 3.x | — | — | | | |
| 4.x | — | — | | | |
| 5.x | — | — | | | |
| 6.x | — | — | | | |
| 7.x | — | — | | | |

### Phase 1.1 결과 요약 (2026-05-17)

**구조**:
- `apps/mobile/` — Expo Router shell (12 funnel + 4 post-payment + magazine[month]) + ScreenState/DataHook contracts + useDummy hook + core-ts workspace dep
- `packages/core-ts/` — 27 TS source files, 23 vitest test files (770 tests), 80% coverage threshold
- `packages/core-python/` — 30 pytest test files (940 tests)
- `pnpm-workspace.yaml`, root scripts delegate to `pnpm --filter`

**Ouroboros workflow**:
- Interview: `interview_20260517_063555` (ambiguity 0.07)
- Seed: `seed_fade244183c6` (QA score 0.91 at iter 2)
- Run: `orch_7cb5e676e782` (19/19 ACs)
- Evaluate: APPROVED Stage 2, score 0.82, drift 0.10

**Git**:
- Feature branch: `ooo/run/1.1-monorepo-shell`
- Merge commit: `39f125a` (no-ff)
- 162 files changed, +11,708 / -40

**검증**:
- `pnpm run test` → 940 pytest + 770 vitest pass
- `pnpm run build` → typecheck silent pass
- `pnpm expo start` → Metro Bundler on localhost:8081

### Phase 1.2 결과 요약 (2026-05-18)

**Vendor 결정** (Replicate → **Fal.ai** 교체):
- Fal.ai: 이미지 생성. core-python 독립 smoke 스크립트로 호출 (FastAPI 서버는 Phase 4)
- PostHog: 모바일 클라이언트만 (`posthog-react-native`) + core-ts에 `PostHogClient` wrapper
- Superwall: 키 발급 + regex validation만 (SDK 설치는 Phase 2.5 custom dev client 전환 때)

**구조** (31 files, +4200 / -26):
- `.env.example` — 4 keys (FAL/POSTHOG/POSTHOG_HOST/SUPERWALL) + format spec + security notes
- `apps/mobile/app.config.ts` — Expo dynamic config가 dotenv로 root .env 로드, `ExpoExtraVendorKeys` 타입에서 FAL_API_KEY 의도적 제외
- `apps/mobile/src/providers/PostHogProvider.tsx` — singleton + `__resetPostHogProviderForTests` 훅
- `apps/mobile/src/providers/postHogConfig.ts` — Constants.expoConfig.extra 리더 + validation
- `apps/mobile/src/config/vendor-keys.ts` — runtime accessor, falApiKey "INTENTIONALLY ABSENT"
- `packages/core-ts/src/posthog/client.ts` — capture(event, props) wrapper, shallow-clone + freeze
- `packages/core-ts/src/superwall/key.ts` — `/^pk_[A-Za-z0-9_-]+$/` + branded `SuperwallApiKey` 타입
- `packages/core-python/src/config/env.py` — `find_dotenv()` opt-in 로더 (import-time side effect 없음)
- `packages/core-python/scripts/smoke_fal.py` — queue-status endpoint + all-zero UUID로 ZERO API cost auth probe

**Ouroboros workflow**:
- Interview: `interview_20260517_112603` (ambiguity 0.07)
- Seed: `seed_45e7a2d0cdf3` (QA 0.88, user-accepted below threshold — ontology over-modeling 회피)
- Run: `orch_2e32f14a3b34` (13/13 ACs · 6/6 Sub-ACs; MCP 끊김 후 isolated worktree에서 작업 회수)
- Evaluate: APPROVED Stage 2, score 0.92, drift 0.05

**Git**:
- Feature branch: `ooo/run/1.2-vendor-setup`
- 핵심 commit: `ce4d394` (vendor-setup feat) · `adaeb20` (test skip fix) · `6dc0817` (mobile typecheck)
- Merge commit: `7d844f3` (no-ff)

**검증**:
- core-ts: 803 tests (802 pass, 1 .env-gated skip)
- apps/mobile: 44 tests (42 pass, 2 .env-gated skip)
- core-python: 952 tests (949 pass, 3 .env-gated skip)
- 전체: 1,793 pass / 6 skip · typecheck clean

**MCP 끊김 → worktree 복구 경험**:
- 실행 중 MCP 연결 disconnect, orchestrator는 13/13 완료 보고
- Isolated worktree (`~/.ouroboros/worktrees/.../orch_2e32f14a3b34`)에서 작업물 보존됨을 발견
- main worktree로 cherry-pick → 테스트가 `.env` 의존이라 fail → `describe.skipIf` 패턴으로 fix
- 이후 evaluate에서 APPROVED

### Phase 1.4 결과 요약 (2026-05-18)

**GitHub Actions CI** (`.github/workflows/ci.yml`, 95 lines):
- 1 cell: ubuntu-latest · Node 20.x · Python 3.12 · pnpm 9
- 5 steps: typecheck (core-ts + mobile) · vitest (core-ts + mobile) · pytest (core-python)
- Triggers: `pull_request` (target main) + `push` (모든 브랜치)
- Concurrency group `ci-${{github.ref}}` — in-progress run 취소로 무료 분 절약
- Caching: `setup-node cache=pnpm` + `setup-python cache=pip` (built-in only)
- `.env`-gated 테스트는 `describe.skipIf` / `pytest.skip`으로 graceful skip

**GitHub repo + branch protection**:
- Remote: `https://github.com/buzllightyear/personal-color-kr` (private)
- 4 branches pushed: main · ooo/run/1.1-monorepo-shell · ooo/run/1.2-vendor-setup · ooo/run/1.4-ci-minimal (auto-deleted on merge)
- `main` protected with required status check `Test (Node 20 / Python 3.12)`
- `enforce_admins=false` (solo dev emergency override) · `allow_force_pushes=false` · `allow_deletions=false`

**CI run record** (모두 GREEN):
- `#25998747710` (initial workflow) 39s
- `#25999002604` (mobile vitest 추가 후) 38s
- `#25999579256` (PR #1 trigger) ~45s
- `#25999609335` (post-merge main) 41s

**Ouroboros workflow**:
- Interview: `interview_20260517_173623` (ambiguity 0.05)
- Seed: `seed_b2255fa91b90` (QA PASS iter 1 · score 0.92)
- Run: `orch_b6c7e29cc70a` (9/9 ACs · 4/4 Sub-ACs)
- Evaluate: APPROVED Stage 2 · score 0.88 · drift 0.05

**Git**:
- Feature branch: `ooo/run/1.4-ci-minimal` (auto-deleted post-merge)
- 핵심 commit: `75b99be` (initial CI) · `18a1382` (typecheck split) · `25ee7b2` (mobile vitest)
- PR #1 merge commit: `d27410e`

**검증** (CI logs):
- core-ts vitest: 802 pass / 1 skip
- apps/mobile vitest: 42 pass / 2 skip
- core-python pytest: 949 pass / 3 skip
- typecheck (core-ts + mobile): clean
- 전체: 1,793 pass / 6 skip — AC 8 `skipped_test_count=6` 정확히 일치

**이슈 + 해결**:
- Orchestrator가 strict reading으로 apps/mobile vitest를 CI에 안 넣음 (Seed AC 5에 명시 안 됨)
- AC 8의 "6 skipped" 일치 안 됨을 발견 → cherry-pick 후 mobile vitest step 추가 → 6 skip 가시화

### Phase 2.1 결과 요약 (2026-05-18)

**core-ts funnel v0.2 재정의** (3 step ID 교체 + 1 신설 + 1 흡수):
- step 3: `social_proof_intro` 폐기 → `onboarding_priming` 신설 (일관성 lever priming, step 4 별점 게이트 직전 자기-declaration 유도)
- step 5: `price_anchoring` 폐기 → `fake_loader` 이동 (구 step 8 → step 5, 가격 노출은 step 12로 단일화)
- step 7: `diagnosis_input`을 셀카 단독으로 단순화 (온보딩 질문은 step 3로 분리)
- step 8: `fake_scan_animation` 신설 (얼굴 위 24-point 시각 스캔, step 5 텍스트 로더와 이중 sunk-cost mechanism)
- step 11: `social_evolution`이 `social_proof_intro` 흡수 (UGC + 인플루언서 + 12만+ aggregate proof 단일 화면)

**Mobile (funnel) 구조** (51 files, +4667 / -504):
- `apps/mobile/app/(funnel)/<kebab>.tsx` × 12 (semantic-kebab, 구 `step-N.tsx` × 12 삭제)
- `(funnel)/_guards.ts` — 3 fail-loud guard stub (`shouldDismissRating`, `shouldBypassReferral`, `shouldSkipFunnelSubscribed`), conservative default `false` + `console.warn` (silent regression 방지, underscore prefix로 Expo Router route 제외)
- `(funnel)/_layout.tsx` — `FUNNEL_KEBAB_SLUGS_ORDERED` 기반 Stack.Screen 자동 생성 (4중 정합 source-of-truth)
- `(funnel)/rating-gate.tsx` — 단일 파일 + `Platform.select` 내부 분기 (iOS `RatingGateDefaultVariant`, Android `RatingGateSecondaryVariant`; 파일 split 없음)
- `(funnel)/result-reveal.tsx` — `share_token` param → `isPreviewMode=true` → bypass + read-only branch (AC 12)
- `(funnel)/referral-gate.tsx` — `shouldBypassReferral()` guard 상태를 dev-info에 surface

**Deep-link infrastructure** (`apps/mobile/src/`):
- `deep-link-paths.ts` — 6-path scheme constants (`<kebab>?utm`, `/r/:code`, `/s/:token`, `/result-reveal`, `/magazine/:month`, universal-link), `UNIVERSAL_LINK_DOMAINS = ['pcolor.invalid', 'personalcolor-kr.invalid']` (.invalid TLD 단일 지점 상수)
- `linking.config.ts` — `FUNNEL_KEBAB_SLUGS`, `LINKING_CONFIG` (filename ↔ URL parity, frozen at every level)
- `internal-only-routes.ts` — 9 internal-only blocklist (12 전체 \ 3 external-allowed 집합 차) — security invariant
- `deep-link-parser.ts` — `parseDeepLink(url)` pure classifier, closed-set `DeepLinkBlockReason` union (`malformed_url`/`unknown_scheme`/`unknown_path`/`internal_only_funnel`)
- `funnel-placeholder.tsx` — 공통 dev-info UI (Step N of 12, screenId, route params dump, Next 버튼, guard 상태, preview flag) — 12 placeholder 파일이 이 컴포넌트 사용

**Root layout** (`apps/mobile/app/_layout.tsx`):
- `RootLayoutInner`를 `PostHogProvider` 아래에 분리 (singleton 유지)
- `useEffect(usePathname)` 기반 `funnel_step_entered` PostHog auto-capture — kebab pathname만 capture, 비-funnel 경로는 no-op, PostHog degraded일 때도 graceful no-op

**Ouroboros workflow**:
- Interview: `interview_20260518_064016` (ambiguity 0.06)
- Seed: `seed_129432ff5704` (QA PASS iter 1 · score 0.90 · threshold 0.90 정확히 일치)
- Run: `orch_d14ea24993ef` (Sub-AC 13/14 시점에 MCP disconnect로 failed)
- Recovery: worktree `ooo/orch_d14ea24993ef` commit `a083f1c` → main feature branch에 cherry-pick (`99539a2`) → 나머지 8개 AC + screens.ts v0.2 마이그레이션 + (funnel) 재배선을 수동 완성 (`e37646e`)
- Evaluate: APPROVED Stage 2 · score 0.92 · goal alignment 0.93 · drift 0.05 · uncertainty 0.12

**Git**:
- Feature branch: `ooo/run/2.1-rn-navigation` (auto-deleted post-merge)
- 핵심 commit: `99539a2` (cherry-pick partial) · `e37646e` (manual completion)
- PR #3 merge commit: `8f8928f` (no-ff)

**검증** (CI logs):
- core-ts typecheck + 809 vitest (1 skip)
- apps/mobile typecheck + 264 vitest (2 .env-gated skip) — 신규 테스트 4개 (`funnel-registry-cross-check`, `funnel-placeholder-smoke`, `funnel-step-entered-capture`, `root-layout` mock 추가)
- core-python 949 pytest (3 .env-gated skip)
- 전체: 2,022 pass / 6 skip — 13 AC 모두 커버
- CI green on PR #3 (push + pull_request 양쪽)

**MCP 끊김 → worktree 복구 패턴 (Phase 1.2 재현)**:
- Orchestrator가 AC 5/13 + Sub-AC 13/14 시점에 disconnect (`job_7fd523765ea0` failed)
- Isolated worktree에서 5/13 AC + 12 kebab 파일 + _guards.ts + deep-link infra 4개 + test 7개 보존 확인
- 사용자 승인 후 cherry-pick + 나머지 수동 완성 (screens.ts v0.2 마이그레이션, 구 step-N 12개 제거, _layout.tsx 2개 갱신, FunnelPlaceholder 공통 컴포넌트, 11개 placeholder 재작성, 4중 정합 + smoke + auto-capture 테스트 추가)

각 work unit 완료 시 이 표에 session_id·commit hash·QA 결과 기록.

### Phase 2.2 결과 요약 (2026-05-19)

**Funnel 1~5단계 실 UI** (PR #5, merge `eaadaa2`, +6,169 / −149, 41 files):

**Foundation layer** (Level 1 of 5 — orchestrator가 MCP 끊김 전에 완료):
- `apps/mobile/src/theme/{colors,typography,spacing,index}.ts` — design tokens `as const` 패턴 (soft pink/coral base + 4-season accent + 4-level grayscale; 5×3 typography matrix; 7-step t-shirt spacing 모두 4의 배수)
- `apps/mobile/src/contracts/funnel-state.ts` — `FunnelOnboardingAnswers` (selfieEditStyle ∈ {natural,subtle,expressive} | null, priorDiagnosis ∈ {never,self_test,professional} | null) readonly contract
- `apps/mobile/src/providers/FunnelStateProvider.tsx` — useMemo'd value + immutable spread-merge updater + fail-loud `FunnelStateProviderMissingError`
- `apps/mobile/src/hooks/{use-funnel-state.ts,use-auto-advance-timer.ts}` — Context consumer + 5초 timer with cleanup
- `apps/mobile/src/components/FunnelHeadline.tsx`, `apps/mobile/src/components/funnel/FunnelPrimaryButton.tsx`, `apps/mobile/src/funnel/FunnelScreenLayout.tsx` — 3 shared funnel UI primitives

**Screen + route layer** (Level 2 of 5 — manual completion):
- `apps/mobile/src/screens/funnel/WelcomeHookScreen.tsx` — headline "내 퍼스널 컬러로 셀카가 한 장 더 빛나도록" + CTA "1분 진단 시작" → value-props
- `apps/mobile/src/screens/funnel/ValuePropsScreen.tsx` — 3 cards (`trend_matched_editing` 🎨 spring, `monthly_curated_magazine` 📖 summer, `personal_color_preset_library` 🎭 autumn) ScrollView 수직 스택 → onboarding-priming
- `apps/mobile/src/screens/funnel/OnboardingPrimingScreen.tsx` — Q1 (4 selfie-edit options) + Q2 (3 prior-diagnosis options) segmented controls; submit `disabled` until 둘 다 non-null → rating-gate
- `apps/mobile/src/screens/funnel/RatingGateContent.tsx` — shared submit + dismissable skip CTAs; iOS default + Android secondary variants 둘 다 같은 content 렌더
- `apps/mobile/src/screens/funnel/FakeLoaderScreen.tsx` — `ActivityIndicator` + 5,000ms `useAutoAdvanceTimer` → scan-option-select (zero user-interactive buttons)
- `apps/mobile/app/(funnel)/<kebab>.tsx` × 5 — thin route wrappers (useRouter + onNext + delegation to screen component)

**`_layout.tsx` rewire**:
- 전체 `Stack`을 `<FunnelStateProvider>`로 감쌈 (funnel group scope 격리)
- `rating-gate` Stack.Screen에 `presentation: 'modal'` 적용 (dismissable: true 시맨틱); 나머지 11개는 default card presentation 유지
- `RATING_GATE_KEBAB_SLUG = toKebabSlug('rating_gate')` — 4중 정합 cross-check에 반영

**Tests** (5 신규 screen tests + 1 cross-check 확장):
- `welcome-hook-screen.test.tsx` (4), `value-props-screen.test.tsx` (7), `onboarding-priming-screen.test.tsx` (11 — gating + a11y state), `rating-gate-screen.test.tsx` (5), `fake-loader-screen.test.tsx` (6 — `vi.useFakeTimers` + advance(5000) + cleanup + custom duration)
- `funnel-registry-cross-check.test.ts` — 7개 → 8개 (rating-gate modal presentation source-level 검증)
- 테스트 helper fix: `funnel-headline` + `funnel-primary-button`이 `findAll`에서 host element만 필터 (`typeof type === 'string'`) — mocked react-native component wrapper가 testID를 중복 매치하던 이슈 해결
- 플랫폼 테스트 mock 확장 (`rating-gate-platform-{ios,android}`): `react-native-safe-area-context` + `expo-router` vi.mock 추가 — Phase 2.2가 추가한 transitive import 체인 대응

**Ouroboros workflow**:
- Interview: `interview_20260518_124757` (ambiguity 0.10)
- Seed: `seed_26e273c0ec9f` (QA PASS iter 1 · score 0.91 · threshold 0.90)
- Run: `orch_f9fd2fbeb451` (Level 1 of 5 완료 시점에 MCP disconnect — AC 4/20, Sub-AC 7/7)
- Recovery: worktree commit `a64a56a` (4 ACs foundation) → main feature branch cherry-pick (`afe430a`) → 나머지 16 ACs 수동 완성 (`bc7c89c`) — Phase 2.1 패턴 재현
- Evaluate: APPROVED Stage 2 · score **0.93** · goal alignment 0.92 · drift 0.05 · uncertainty 0.12 (Phase 2.1의 0.92 초과)

**Git**:
- Feature branch: `ooo/run/2.2-funnel-screens-1-5` (auto-deleted post-merge)
- 핵심 commit: `afe430a` (foundation cherry-pick) · `bc7c89c` (screens + routes + _layout + tests 수동 완성)
- PR #5 merge commit: `eaadaa2`

**검증**:
- apps/mobile: 33 test files · 518 pass · 2 skip · typecheck clean
- packages/core-ts: 25 test files · 809 pass · 1 skip · typecheck clean
- 4중 정합 cross-check: 8/8 pass (rating-gate modal presentation 포함)
- CI green on PR #5 (push + pull_request 양쪽)
- Zero new npm dependencies — RN built-ins + React Context + 기존 `react-native-safe-area-context` 사용

**Constraint compliance (all preserved)**:
- StyleSheet.create only (no NativeWind/Tamagui/Unistyles)
- System fonts only (no Pretendard/expo-font)
- React Context only (no Zustand/jotai/redux)
- `useState` for forms (no react-hook-form/formik)
- `ActivityIndicator` only (no Reanimated/Moti animation libs)
- Emoji icons only (no `@expo/vector-icons`)
- `ScrollView` vertical stack (no carousel libs)
- Korean hardcoded (no i18n infra)
- PII never in route params (PostHog context only)
- `FAL_API_KEY` not exposed in `app.config.ts extra` (Phase 1.2 invariant)

**MCP 끊김 → 복구 패턴 (3회째 일관 적용)**:
- Phase 1.2 (`orch_2e32f14a3b34`) — worktree에서 13/13 보존
- Phase 2.1 (`orch_d14ea24993ef`) — worktree commit `a083f1c` cherry-pick + 8 AC 수동 완성
- Phase 2.2 (`orch_f9fd2fbeb451`) — worktree commit `a64a56a` cherry-pick + 16 AC 수동 완성
- 패턴 안정화: orchestrator가 어디서 멈추든 (a) worktree 작업 보존 → (b) commit → (c) feature branch cherry-pick → (d) test/typecheck 안정화 후 manual completion

### Phase 2.3 결과 요약 (2026-05-19)

**Funnel 6~9단계 실 UI** (PR #7, merge `8be0230`, +5,326 / −42, 27 files):

**Context extension** (Phase 2.2 패턴 재적용 — 두번째 nested 슬라이스):
- `apps/mobile/src/contracts/funnel-state.ts` — `FunnelDiagnosisInput {selfieUri: string | null}` + `INITIAL_FUNNEL_DIAGNOSIS_INPUT` Object.freeze + `FunnelDiagnosisInputPatch` + `SetDiagnosisInput`; `FunnelStateValue`는 onboarding과 diagnosisInput 두 슬라이스 + 각 setter 모두 readonly
- `apps/mobile/src/providers/FunnelStateProvider.tsx` — parallel useState + useCallback + useMemo (deps 양쪽 슬라이스 모두 포함)

**Helpers** (3 신규 컴포넌트 + 1 selector):
- `src/funnel/scan-options.ts` — `getScanOptions()` selector returning 3 frozen options (primary "퍼스널 컬러 진단" + 2 disabled "곧 오픈")
- `src/components/funnel/ScanOptionItem.tsx` — 단일 옵션 + disabled state + accessibilityState.disabled + "곧 오픈" badge
- `src/components/funnel/GuideList.tsx` — 정면/자연광/민낯 가이드 리스트
- `src/components/funnel/SelfieUploadPressable.tsx` — stub Pressable + `onCapture(stub://selfie/<timestamp>)` 콜백

**Screen components** (4 in `src/screens/funnel/`):
- `ScanOptionSelectScreen.tsx` (114줄) — 3개 ScanOptionItem 인스턴스; 오직 primary가 funnel advance
- `DiagnosisInputScreen.tsx` (202줄) — GuideList + SelfieUploadPressable; 첫 탭에 stub URI를 setDiagnosisInput으로 저장 → "셀카 등록됨" 인디케이터 → primary CTA enabled
- `FakeScanAnimationScreen.tsx` (405줄) — **단일 Animated.Value** lazy useRef + sweep line + 24 face-landmark dots (color interpolation per progress) + `<Animated.Text>` counter "n / 24 포인트 분석 완료"; `useNativeDriver: false`; 5초 useAutoAdvanceTimer 병행; oval face outline은 borderRadius (SVG 없음); unmount cleanup 검증
- `ResultRevealScreen.tsx` (437줄) — teaser "가을 웜톤" 풀-fidelity + 3 distinct locked assets (`full_category_card` 16:9 hero / `guide_text` 3-text-line stack / `first_curation` 2×2 grid); 각 placeholder opacity 0.2 + overlay opacity 0.85 + centered 🔒 (accessibilityLabel="잠김"); Phase 2.1 `isPreviewMode` 분기 보존

**Route thin-wrappers** (4 in `app/(funnel)/`, all delegate to matching screen component):
- `scan-option-select.tsx`, `diagnosis-input.tsx`, `fake-scan-animation.tsx`, `result-reveal.tsx`
- `result-reveal.tsx`: `share_token` route param에서 `isPreviewMode` 도출 → preview 모드는 CTA 미렌더, normal 모드는 `onUnlock` → referral-gate
- `_layout.tsx` untouched (acceptance criterion 준수)

**Tests** (12 신규 파일):
- screens × 4: `scan-option-select-screen.test.tsx` (7), `diagnosis-input-screen.test.tsx`, `fake-scan-animation-screen.test.tsx` (12 — animation init + sweep line + counter + autoAdvance + unmount), `result-reveal-screen.test.tsx` (12 — 3 locked assets + 🔒 + isPreviewMode)
- routes × 4: `scan-option-select-route.test.tsx` (3), `diagnosis-input-route.test.tsx` (4), `fake-scan-animation-route.test.tsx` (5), `result-reveal-route.test.tsx` (4 — Phase 2.1 isPreviewMode 보존 검증)
- helpers × 3: `scan-option-item.test.tsx`, `guide-list.test.tsx`, `selfie-upload-pressable.test.tsx`
- selector: `scan-options.test.ts` (7)
- contract 확장: `funnel-state-contract.test.ts` — diagnosisInput 타입 + 런타임 assertions 추가

**Ouroboros workflow**:
- Interview: `interview_20260518_193715` (ambiguity 0.09)
- Seed: `seed_961277b04b5f` (QA 0.92 at iter 3/5; iter 1: 0.35 truncated artifact / iter 2: 0.87 / iter 3: 0.92 PASS)
- Run: `orch_cd33a0972630` (MCP disconnect at AC 2/22 + Sub-AC 12/16)
- Recovery: 4th application of the worktree cherry-pick + manual completion pattern
  - `f33d1da` (worktree commit) → `930fb55` (cherry-pick to feature branch)
  - `cdacab8` (typecheck fix — FunnelStateValue contract test diagnosisInput 누락 보완)
  - `cc5512d` (Stage 2 fix — result-reveal route file이 ResultRevealScreen 대신 FunnelPlaceholder 사용하던 결함을 evaluator가 보고 → 라우트 wire-up + 4 신규 route test)
- Evaluate: 첫번째 0.82 REJECTED (result-reveal 라우트 결함) → fix 후 두번째 0.92 APPROVED (AC compliance YES, goal alignment 0.93, drift 0.05)

**Git**:
- Feature branch: `ooo/run/2.3-funnel-screens-6-9` (auto-deleted post-merge)
- 핵심 commit: `930fb55` (foundation + screens cherry-pick) · `cdacab8` (contract test fix) · `cc5512d` (result-reveal route fix)
- PR #7 merge commit: `8be0230` (no-ff)

**검증** (final):
- apps/mobile: 45 test files · 627 pass · 2 skip · typecheck clean
- packages/core-ts: 25 test files · 809 pass · 1 skip · typecheck clean
- CI green on PR #7 (push + pull_request 양쪽)
- Zero new npm dependencies — pure RN Animated + React Context + 기존 패키지

**Constraint compliance (all preserved)**:
- StyleSheet.create + RN built-ins only (no Reanimated/Moti/expo-image-picker/expo-vector-icons/expo-blur)
- Single Animated.Value (useNativeDriver: false) for all step 8 visuals
- 24 dot positions hardcoded as normalised {x,y} array (no SVG)
- Animation fires once over 5,000ms then holds (no loop)
- selfieUri: string | null (not undefined) per Phase 2.2 convention
- Locked assets internal to ResultRevealScreen (not extracted — only used in step 9)
- Step 7 stub Pressable only (real ImagePicker는 Phase 3.1)
- PII never in route params — selfieUri는 in-memory Context만
- 4중 정합 유지 (_layout.tsx 변경 없음, 12 kebab routes 보존)
- Phase 2.1 isPreviewMode share_token 분기 result-reveal 라우트에서 그대로 작동

**Stage 2 evaluator's recursive value**:
- 첫번째 evaluation이 'result-reveal.tsx still imports FunnelPlaceholder'를 정확히 잡아냄 → cherry-pick 후 typecheck/vitest 통과에도 불구하고 evaluator가 라우트 wire-up 결함 발견
- evaluator가 발견 → 1줄 import 변경 + 4 route test 추가 → 두번째 evaluation 0.92 APPROVED
- Stage 2의 진짜 가치: mechanical (lint/build/test) 통과해도 의도 alignment 결함은 잡힐 수 있음

### Phase 2.4 결과 요약 (2026-05-20)

**Funnel 10~12단계 한국 변형 (referral_gate · social_evolution · payment_model)** (PR #9, merge `07132de`, +9,307 / −105, 47 files):

**Context extension** (Phase 2.2/2.3 패턴 세번째 재적용 — 두 슬라이스 동시 추가):
- `referral: { shared: boolean }` — 단일 boolean 슬라이스, INITIAL_FUNNEL_REFERRAL = { shared: false }
- `payment: { selectedMethod: 'kakao' | 'toss' | null, isProcessing: boolean, isPremium: boolean }` — discriminated union + 2 flags
- 5개 setter 추가 (`setReferral`, `setPayment`, `setSelectedPaymentMethod`, `setPaymentProcessing`, `setIsPremium`) — bulk patch + 단일 필드 setter 병행 (mutual-exclusive bailout 포함)
- 모두 useState + useCallback + useMemo 병렬 슬라이스 패턴 — 한 슬라이스 쓰기가 다른 슬라이스 reference 무효화 안 시킴

**3개 신규 화면 (UI shell + placeholder SDK + state binding)**:
- `ReferralGateScreen` — 카카오톡 공유 + 링크 복사 + "나중에 할게요" 3-CTA stack (subdued 텍스트 skip)
- `SocialEvolutionSharedFalseBranch` — upsell 카드 + "친구에게 공유하기" (router.push → referral-gate) + skip (router.push → payment-model). shared=false 분기 단일 source of truth (공유 기능 중복 방지)
- `SocialEvolutionSharedTrueBranch` — 공유 완료 확인 + 친구 empty state (👥 + "아직 친구가 참여하지 않았어요") + "다음으로" forward CTA
- `payment-model` route inline composition — `PriceCard` (₩9,900 하드코딩, Intl.NumberFormat ko-KR) + `PaymentMethodRadio` (kakao/toss radio + disabled 상태) + "결제하고 잠금 해제" primary + "나중에 할게요" skip

**Result-reveal premium branch (Phase 2.1 isPreviewMode 보존)**:
- `ResultRevealScreen` — `isPremium` prop 분기 추가: 3개 placeholder (full_category_card / guide_text / first_curation) lock overlay 제거 + `accessibilityLabel="잠김"` 제거
- `result-reveal.tsx` route — `BackHandler` via `useFocusEffect` + `useCallback` (deps: isPremium, router) → `router.dismissAll()` on premium-only branch. cleanup `subscription.remove()` 으로 listener 누수 방지

**5개 PostHog placeholder events** (`src/analytics/`):
- `track-referral-shared` ({ method: 'kakao' | 'copy_link' }), `track-referral-skipped` ({}), `track-social-evolution-skipped` ({}), `track-payment-method-selected` ({ method }), `track-payment-completed` ({ method, amountKrw })
- 패턴: `console.log('[analytics:placeholder]', EVENT_NAME, payload)` + `// TODO(phase-2.5): posthog.capture(...)` — Phase 2.5 swap 시 한 줄 변경

**Payment placeholder 250ms setTimeout + useRef cleanup**:
- `payment-model.tsx`의 `handleUnlock`: `setPaymentProcessing(true)` → `setTimeout(250ms)` (`timerRef` 캡처) → trackPaymentCompleted + `setIsPremium(true)` + `setPaymentProcessing(false)` + `router.replace('/(funnel)/result-reveal?premium=true')`
- `useEffect` cleanup: unmount 시 `clearTimeout(timerRef.current)` — 250ms 도중 라우트 이탈 안전성

**Navigation 계약** (Phase 2.4 첫 분기 도입):
- `router.replace` — referral_gate 공유 완료 → social-evolution / payment_model success → result-reveal?premium=true / payment_model skip → result-reveal (locked)
- `router.push` — result_reveal CTA → referral_gate / social_evolution shared=false → referral_gate / social_evolution → payment-model

**테스트 회로 (22+ 신규 파일, ~100 신규 케이스)**:
- 슬라이스: `funnel-state-payment-slice` (9), `funnel-state-payment-set-{is-premium,processing,selected-method}` (28 total) + `funnel-state-contract` Equal 어설션 확장
- 컴포넌트: `payment-method-radio` (23), `price-card` (15), `referral-gate-screen` (9), `social-evolution-shared-{true,false}-branch` (9)
- 라우트: `referral-gate-route` (4), `social-evolution-route` (7), `payment-model-route` (4), `result-reveal-cta-navigation` (3), `result-reveal-route-premium-backhandler` (5)
- 결과: 787 passed / 2 skipped / 69 files · tsc --noEmit 0 errors

**4중 정합 (4-way consistency cross-check)**:
- TypeScript types (src/contracts/funnel-state.ts) ↔ vitest type-level `Equal` 어설션 (tests/funnel-state-contract.test.ts) ↔ Route 파일 존재 (app/(funnel)/*.tsx) ↔ Provider slice shape (src/providers/FunnelStateProvider.tsx)

**Security invariants (Phase 2.1 패턴 유지)**:
- 실제 Kakao / KakaoPay / Toss SDK import 없음 (전부 `console.log` placeholder + TODO 마커)
- SDK key 가 `app.config.ts` extra block 에 없음 (Phase 2.5 Superwall에서 처리)
- `isPremium`은 FunnelStateProvider payment 슬라이스에만 — route param 노출 없음
- `?premium=true`는 navigation trigger only (실제 state는 provider)
- 9개 internal funnel screen 외부 deep-link 차단 유지

**MCP-disconnect recovery 5번째 적용 (Phase 1.2 / 2.1 / 2.2 / 2.3 / 2.4)**:
- Orchestrator AC 10/26 도달 시점에 disconnect — 모든 컴포넌트/스크린/슬라이스/분석/테스트 스캐폴딩은 완성, 단 3개 route 파일이 placeholder 상태로 남음
- Worktree commit (`141b4c4`) → main branch cherry-pick (`76f46fb`)
- 3개 route 수동 wire-up + 3개 route test FunnelStateProvider wrap 추가 (`ce3e515`)
- 패턴 재확인: orchestrator는 leaf 컴포넌트는 잘 만들지만 cross-cutting wire-up(route ↔ screen) 단계에서 자주 정지

**Evaluate**: APPROVED Stage 2 · score **0.93** · goal alignment 0.92 · drift 0.05 · uncertainty 0.10 (Phase 2.2와 동률 — 최고점)

## 참고

- Seed v0.2.0: `~/Vault/ObsidianVault/PARA-Zettelkasten/Projects/personal-color-kr/seed-v0.2.0.md`
- Prior Ouroboros sessions: `orch_e1aeb316ad1f`, `orch_2ffcfe9aeaef`, `orch_5f21f8d27fa3`
