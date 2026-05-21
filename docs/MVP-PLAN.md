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
| 2.5 | ✅ Superwall paywall + StoreKit 구독 결제 통합 (wrapper module + EAS dev client 전환 + ASC sandbox + 5-path completion handling + value-prop PriceCard) | iOS |
| 2.6 | ✅ PostHog 12단계 이벤트 emit wire-up (6 placeholder track-*.ts → posthog?.capture(EVENT_NAME, payload) client pass-through DI + orphan track-payment-method-selected 삭제 + 6:6 spec 1:1) | TS |

### Phase 3 — Post-payment delivery (첫 패키지 4종 실연동)
| ID | 작업 | 비고 |
|----|------|------|
| 3.1 | ✅ Fal.ai 실제 API call wiring (FalAiVendorCaller 어댑터: VendorCaller Protocol 구현, 3-step upload→edit→download HTTPS sync, preset→prompt boundary 해상도, deadline_monotonic 예산 분배) | Py |
| 3.2 | ✅ Personal color diagnosis 런타임 wiring (`diagnose_personal_color(bytes) -> DiagnosisResult` 진입점, MediaPipe face_detector 단일 경계 파일, Pillow image_decoder 단일 경계 파일, `season_to_preset()` bijection, Callable DI 패턴) | Py |
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
| 2.5 | 2026-05-19 | 2026-05-20 | `orch_3b575df72faa` | `2de2119` | APPROVED · Stage 2 · 0.92 |
| 2.6 | 2026-05-20 | 2026-05-20 | `orch_8d132bdbc9aa` | `77282c2` | APPROVED · Stage 2 · 0.93 |
| 3.1 | 2026-05-20 | 2026-05-21 | `orch_0db1520139ca` | `b3a2deb` | APPROVED · Stage 2 · 0.92 (retry after wireup fix) |
| 3.2 | 2026-05-21 | 2026-05-21 | `orch_63c91f495e7e` | `17342e7` | APPROVED · Stage 2 · 0.92 |
| 3.x | — | — | | | 다음 단계 (3.3) |
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

### Phase 2.5 결과 요약 (2026-05-20)

**Superwall paywall + StoreKit iOS 구독 결제 통합** (PR #11, merge `2de2119`, 47+ files):

**Wrapper-mediated native integration** (Phase 2.5 핵심 아키텍처 결정):
- `apps/mobile/src/superwall/client.ts` — 유일한 `@superwall/react-native-superwall` import 사이트 (grep 검증 완료)
- `configureSuperwall(apiKey)`: 멱등 (이미 configured면 early return). `app/_layout.tsx`의 useEffect with empty dep array에서 1회 호출
- `triggerPaywall(placement, params?)`: `Promise<{ outcome: 'purchased' | 'restored' | 'declined', productId?: string }>` 반환
- `SuperwallTriggerError` + `SuperwallNotConfiguredError`: caller try-catch용 두 종류 에러 클래스
- `PLACEMENT_PAYMENT_MODEL_UNLOCK = 'payment_model_unlock'` constant in `placements.ts`
- core-ts package는 pure JS/TS 유지 (Phase 1.2 key.ts regex만)

**payment-model.tsx Phase 2.4 → 2.5 변환**:
- PaymentMethodRadio import + setSelectedPaymentMethod usage 완전 제거 (KakaoPay/Toss UI shell deprecated — Superwall이 method 선택 흡수)
- 250ms setTimeout placeholder + useRef cleanup 제거 (Superwall이 처리)
- handleUnlock을 async + try-catch로 변환
- 5-path completion handler:
  - `purchased`: trackPaymentCompleted({restored:false}) + setIsPremium(true) + router.replace('/(funnel)/result-reveal?premium=true')
  - `restored`: 동일 + restored:true on payload
  - `declined`: setPaymentProcessing(false) only, 화면 잔류 (Superwall 내부 paywall_close 이벤트가 충당, 앱 analytics 미발화)
  - `SuperwallTriggerError`: trackPaywallError({placement, errorMessage}) + inline error Text (subdued red '#C44569', accessibilityLiveRegion='polite') + CTA 재활성화
  - explicit skip "나중에 할게요": trackPaymentSkipped({}) + router.replace('/(funnel)/result-reveal') (locked, no premium=true)
- Inline error UI는 별도 toast component가 아닌 화면 내 conditional Text (Seed `error_transparency` 원칙)

**PriceCard 변환** (`apps/mobile/src/components/funnel/PriceCard.tsx`):
- 하드코딩 ₩9,900 + formatPaymentAmountKrw import 제거
- value-proposition card로 재구성: VALUE_PROP_CARD_HEADING ('이 분석으로 받게 되는 것') + 3 benefit items (scope → utility → longevity)
- testID `payment-model-value-prop-card`
- 단일 source of truth: 실제 가격은 Superwall paywall만 표시 (가격 drift 위험 제거)

**CTA label change**:
- `formatUnlockCtaLabel()` returns bare `PAYMENT_MODEL_UNLOCK_CTA_SUFFIX` ('결제하고 잠금 해제')
- ₩9,900 prefix 제거 — Superwall paywall이 가격 노출 owner

**5개 신규 PostHog placeholder events** (총 8개로 확장):
- 신규: `track-payment-skipped.ts` ('payment_skipped' / Record<string, never>), `track-paywall-error.ts` ('paywall_error' / {placement, errorMessage})
- 확장: `TrackPaymentCompletedPayload`에 `restored?: boolean` optional field 추가 (Phase 2.4 method field는 deprecated as sentinel — Phase 2.6 정리)

**EAS dev client 전환 (첫 native module 필요 phase)**:
- `eas.json` 추가 — development-simulator + development + preview + production 프로파일
- `developmentClient: true` — Expo Go 호환 불가 (네이티브 SDK)
- `@superwall/react-native-superwall@2.1.7` apps/mobile/package.json에 추가

**ASC sandbox 등록 문서**:
- `docs/PHASE-2.5-ASC-SUBSCRIPTION.md` — 수동 등록 playbook
- Product ID: `com.personalcolorkr.monthly.premium`
- Subscription group: `personal_color_premium`
- Baseline price: ₩9,900 (KRW)
- `apps/mobile/storekit/PersonalColorKR.storekit` — Xcode StoreKit configuration 파일 (sandbox 테스트용)

**테스트 회로** (Phase 2.4 880 + Phase 2.5 신규 = 880 passing):
- Wrapper 단위 테스트 8종: superwall-client-wrapper, superwall-configure-idempotency, superwall-dependency-declared, superwall-placements, superwall-products, superwall-trigger-error, superwall-trigger-paywall-outcome, superwall-trigger-paywall-placement-forwarding
- Completion 상태 테스트 5종: funnel-state-payment-{purchased, restored, declined, error, skip}, payment-model-skip-flow
- Route+layout 테스트: payment-model-route 5-path coverage + root-layout-superwall-configure
- Transitive mock 추가: root-layout.test.tsx, funnel-step-entered-capture.test.tsx (네이티브 모듈 leak 방지)

**Test seam single-mock**:
- vitest의 모든 native-touching path는 `vi.mock('../src/superwall/client', ...)` (또는 상응 path)을 통해 wrapper module에서 차단
- `@superwall/react-native-superwall` package 자체는 vitest에서 절대 resolve되지 않음
- 5-path 완성 테스트는 `vi.mocked(triggerPaywall).mockResolvedValueOnce(...)` per-case로 outcome 시뮬레이션

**4중 정합**:
- TypeScript types (PaywallOutcome discriminated union, SuperwallTriggerError class) ↔ vitest (wrapper API + 5-path completion behavior) ↔ wrapper module 존재 (src/superwall/{client, placements, products}.ts) ↔ FunnelStateProvider slice 호환성 (Phase 2.4 setters 재사용)

**Security invariants 유지**:
- 네이티브 import grep 검증: client.ts 단 1곳만 (다른 어떤 UI/test 파일도 직접 import 안 함)
- Superwall publishable key는 `EXPO_PUBLIC_` prefix only (publishable, secret 아님)
- payment slice/analytics payload에 PII (transaction_id, receipt token, customer email) 없음
- ASC sandbox만 등록 — production registration Phase 7 미룸
- 9개 internal funnel screen 외부 deep-link 차단 유지 (payment-model 포함)

**6번째 MCP-disconnect recovery (Phase 1.2/2.1/2.2/2.3/2.4/2.5)**:
- Orchestrator AC 12/24 도달 후 disconnect — wrapper + analytics + 8 wrapper tests + 5 completion tests + storekit config + ASC docs 까지 완성, 하지만 payment-model.tsx 자체는 PaymentMethodRadio만 제거하고 setTimeout placeholder가 그대로 (CTA가 가드 절(`selectedMethod === null`)로 영구 비활성화 상태)
- Worktree commit `8b3b1fc` → main branch cherry-pick `7c77a9a`
- 수동 완성 (`9487a72`): payment-model의 handleUnlock을 async + triggerPaywall 호출 + 5-path 분기로 재작성 + inline error UI + 5 completion 테스트 추가 + 2개 transitive-touch 테스트에 wrapper mock 추가
- 패턴 재확인: orchestrator는 wrapper/analytics/test scaffolding 잘 만들지만 cross-cutting wire-up (route handler가 wrapper API를 실제로 await 하는 단계)에서 자주 정지

**Evaluate**: APPROVED Stage 2 · score **0.92** · goal alignment 0.93 · drift 0.05 · uncertainty 0.12 (Phase 2.1/2.3과 동률 — 1st-class native integration phase 첫 시도로서 만족)

### Phase 2.6 결과 요약 (2026-05-20)

**PostHog 12단계 이벤트 emit wire-up** (PR #13, merge `77282c2`, 19 files, +895/-711):

**Client pass-through DI 패턴 확정 (Option A)**:
- 6개 placeholder track-*.ts 모듈을 `(posthog: PostHog | undefined, payload)` 시그니처로 변환
- 본체: `posthog?.capture(EVENT_NAME, payload)` 또는 spread 변형 `{ ...payload }` (interface payload → PostHogEventProperties index signature 호환을 위해 3개 모듈에서 spread)
- React 컴포넌트에서 `const posthog = usePostHog()` → useCallback handler closure로 전달
- track-*.ts 모듈은 pure TS 유지 (no React/hook coupling) — vitest 환경에서 native-free
- Phase 2.4 placeholder doc-comment가 명시적으로 예고했던 "thin wrapper that accepts the client via DI" 패턴 그대로 구현

**6개 모듈 wire-up 매핑**:
- `track-referral-shared.ts:114` → `posthog?.capture(REFERRAL_SHARED_EVENT_NAME, { ...payload })`
- `track-referral-skipped.ts:120` → `posthog?.capture(REFERRAL_SKIPPED_EVENT_NAME, payload)`
- `track-social-evolution-skipped.ts:127` → `posthog?.capture(SOCIAL_EVOLUTION_SKIPPED_EVENT_NAME, payload)`
- `track-payment-completed.ts:226` → `posthog?.capture(PAYMENT_COMPLETED_EVENT_NAME, { ...payload })`
- `track-payment-skipped.ts:174` → `posthog?.capture(PAYMENT_SKIPPED_EVENT_NAME, payload)`
- `track-paywall-error.ts:214` → `posthog?.capture(PAYWALL_ERROR_EVENT_NAME, { ...payload })`

**Event name 상수 6개 (변경 없음 — Phase 2.4/2.5 placeholder에서 이미 snake_case 정의)**: `referral_shared`, `referral_skipped`, `social_evolution_skipped`, `payment_completed`, `payment_skipped`, `paywall_error` — drift 방지를 위해 capture 호출 첫 인자는 항상 상수 import (literal 금지)

**3개 route file call-site 와이어업 (6 call-sites)**:
- `app/(funnel)/referral-gate.tsx`: `usePostHog()` import + 3 call-sites (kakao share / copy link share / skip)
- `app/(funnel)/social-evolution.tsx`: `usePostHog()` import + 1 call-site (skip)
- `app/(funnel)/payment-model.tsx`: `usePostHog()` import + 3 call-sites (purchased/restored, error, skip)
- 모든 useCallback dep array에 posthog 포함 (regression-prevention)

**Degraded mode silent no-op 보안 가드**:
- `posthog?.capture` optional chain만 사용 — throw 금지, console.log/console.warn/console.error 금지
- 6 unit tests가 `posthog === undefined` 시 capture call count === 0 검증
- 추가로 console spy 3종 (log/warn/error) 모두 0 호출 검증 — Phase 2.4 placeholder logger 완전 은퇴 입증

**Vitest 구조 변경 (4 rewrite + 1 delete + 2 new = 7 file ops, end state 6:6 1:1)**:
- Rewrite (4): track-referral-shared/skipped, track-social-evolution-skipped, track-payment-completed — console.log spy → captureFn vi.fn() spy + stubPostHog = { capture: captureFn } as PostHog
- Delete (1): track-payment-method-selected.ts + .test.ts — Phase 2.5에서 KakaoPay/Toss radio 제거로 orphan, production 호출 0건
- New (2): track-payment-skipped.test.ts, track-paywall-error.test.ts
- 모듈당 정확히 2 test case (happy path + degraded mode)
- payment-model-skip-flow.test.tsx (Phase 2.5 contract): console.log 옵저빙에서 usePostHog().capture 옵저빙으로 재배선 — analytics-before-navigation 순서 invariant 보존

**Orphan cleanup (track-payment-method-selected)**:
- 모듈 파일 삭제 (134 lines)
- spec 파일 삭제 (115 lines)
- track-paywall-error.ts L59, track-payment-completed.ts L54의 cross-doc references 정리

**4중 정합 (Phase 2.6 정의)**:
- ✅ TS strict `tsc --noEmit` — exit 0
- ✅ vitest captureFn spy — 887 passed, 2 skipped, 0 failed (84 test files)
- ✅ event_name 상수 = `posthog.capture()` 첫 인자 — 6/6 grep으로 검증
- ✅ production `console.log` + `TODO(phase-2.6)` 잔존 — 0건 (Stage 2 evaluator가 별도 grep으로 재확인)

**PII 보안 invariant**:
- Payload types 좁은 도메인 (e.g., `{ readonly method: 'kakao' | 'copy_link' }`, `Record<string, never>`) — distinct_id/transaction_id/receipt_token/customer_email/selfieUri 구조적으로 추가 불가
- PII grep 결과 (production code): 0건 (JSDoc 경고 주석만 남음)
- TS structural typing이 PII 차단을 강제 — runtime PII assertion 불필요

**Phase 2.2 funnel_step_entered untouched**:
- `app/_layout.tsx`의 `useEffect(usePathname)` auto-capture 변경 0건
- `tests/funnel-step-entered-capture.test.tsx` reference 패턴 보존
- Phase 2.2가 이미 12개 funnel kebab slug allowlist로 작동 중 — Phase 2.6에서는 존재 확인만

**7번째 MCP-disconnect recovery (Phase 1.2/2.1/2.2/2.3/2.4/2.5/2.6)**:
- Orchestrator AC 8/13, Sub-AC 8/9 도달 — 6 모듈 wire-up + 2 route file (referral-gate, social-evolution) + 4 spec rewrite + 1 delete + 2 new spec까지 완성
- payment-model.tsx call-site wiring (Sub-AC 7.3) 실행 중 disconnect — 3 call-sites 미와이어 상태
- Worktree commit `26d3107` → main feature branch cherry-pick `b59a5f9`
- 수동 완성 (`16c7ae1`):
  - payment-model.tsx 와이어업 (3 call-sites)
  - 3 production 모듈에 `{ ...payload }` spread 추가 (PostHogEventProperties index signature 호환)
  - 4 test 파일 `MockInstance` 타입 annotation 수정 (RN console type override 회피)
  - Phase 2.5 payment-model-skip-flow.test.tsx 를 capture spy 패턴으로 재작성
- 패턴 재확인: 7회 연속 적용 — orchestrator의 강점(scaffolding)과 약점(cross-cutting handler wire-up) 모두 일관

**Out of scope (Seed 명시 — Phase 4 launch readiness로 이연)**:
- super properties / `posthog.register()` 호출
- A/B test / feature flag 연동
- User identification / alias
- PostHog dashboard funnel 정의 (product setup)
- Custom server-side proxy

**Evaluate**: APPROVED Stage 2 · score **0.93** · goal alignment 0.95 · drift 0.05 · uncertainty 0.10 (Phase 2.2/2.4와 동률 — analytics 중심 phase의 최고 baseline)

### Phase 3.1 결과 요약 (2026-05-21)

**Fal.ai 실제 API call wiring** (PR #15, squash merge `b3a2deb`, 17 files, +7676/-12):

**Adapter 패턴 (VendorCaller Protocol 구현)**:
- `packages/core-python/src/image_edit/fal_ai_vendor_caller.py` (1544L) — `FalAiVendorCaller` 클래스가 기존 `VendorCaller` Protocol 시그니처(`__call__(request: VendorRequest, attempt_timeout: float) -> bytes`)를 그대로 구현
- bytes-in / bytes-out 경계 보존 — Fal JSON, CDN URL, storage 토큰 등 메타데이터가 호출자에게 노출되지 않음
- `from __future__ import annotations` (PEP 563) — type hints는 문자열, `typing.get_type_hints()`로 실제 해상도 가능
- `__slots__ = ('_api_key', '_authorization_header')` — `__init__` 후 상태 없음, attribute injection 방지
- sync def per Protocol (frozen) — Phase 4 FastAPI에서 그대로 재사용 가능

**3-step HTTP flow (upload → edit → download)**:
- Step 1: `_upload_selfie_to_storage(selfie_bytes, timeout) -> str` — `POST https://fal.run/storage/upload` multipart, 3s 천장. 응답 JSON의 `url` 필드만 allowlist (filename/size/mime/expires_at 등 모두 폐기)
- Step 2: `_post_img2img_request(image_url, prompt, params, timeout) -> str` — `POST https://fal.run/fal-ai/flux/dev/image-to-image` JSON, 15s 천장. 응답 `images[0].url` 만 allowlist (request_id/seed/nsfw 등 폐기). `_build_img2img_payload()` pure function이 payload 빌드, 3-field override allowlist (`strength`, `guidance_scale`, `num_inference_steps`)
- Step 3: `_download_image_bytes(url, timeout) -> bytes` / `_download_result()` alias — opaque CDN URL `GET`, 3s 천장. **Authorization header 없음** (CDN log leak 방지). bytes 만 반환, 헤더/메타 폐기
- `__call__()` orchestration (commit `c280e86`): `deadline_monotonic = time.monotonic() + attempt_timeout` 으로 deadline 계산, 각 step에 `deadline - now()` 잔여 예산 전달 — slow upload가 edit 슬라이스를 침범하지 못함

**Preset → prompt 경계 해상도 (AC 6)**:
- `_PRESET_TO_PROMPT: Final[Mapping[str, str]]` 모듈 스코프 closed enum — `spring-warm` / `summer-cool` / `autumn-warm` / `winter-cool` 4개만
- FLUX prompt 어휘는 adapter 내부 비공개 — 진단 파이프라인은 `"spring-warm"` 만 emit, downstream consumer는 bytes 만 받음
- `__call__()` 진입 직후 boundary resolve — unknown/non-string preset은 ValueError로 short-circuit, **HTTP round-trip 0** (Fal credit 낭비 방지)

**모델 파라미터 디폴트 (Seed v0.2.0 고정)**:
- `fal_ai_defaults.py:85-101` — `DEFAULT_STRENGTH=0.85`, `DEFAULT_GUIDANCE_SCALE=3.5`, `DEFAULT_NUM_INFERENCE_STEPS=28`
- module-scope `Final` — 재배치 불가, mypy `--strict` 가 mutation 거부
- 호출자가 `VendorRequest.params` 의 3-field allowlist를 통해 per-call override 가능, 알려지지 않은 키는 silent drop

**에러 분류 (vendor_client.py 계약 보존)**:
- `VendorError` (transient, retriable): HTTP 429, 5xx, network reset, DNS fail, request timeout, `timeout <= 0`
- `ValueError` (permanent, non-retriable): HTTP 4xx (429 제외), JSON decode fail, missing/empty/non-string allowlisted 필드, 3xx unexpected redirect, wrong-typed override
- 외부 `edit_image()` retry loop는 `VendorError` 만 absorb — `ValueError` 시 즉시 short-circuit

**FAL_API_KEY 보안 (server-side only)**:
- `fal_ai_api_key.py` (152L) — `config.env.load_root_dotenv()` + `get_env(required=True)` 위에 구축, idempotent, thread-safe
- 키 값이 모듈 어떤 string format에도 등장하지 않음 — log/exception body에 변수명과 .env 경로만
- `apps/mobile/src/config/vendor-keys.ts` 의 `falApiKey: 'INTENTIONALLY ABSENT'` 보존 — mobile bundle 누출 0
- Authorization header는 `__init__` 에서 한 번만 빌드 (`f"Key {api_key}"`), `__slots__` 으로 immutable 저장

**전송 계층 mock 전략 (production 분기 0)**:
- `httpx.MockTransport` + `monkeypatch.setattr('image_edit.fal_ai_vendor_caller.httpx.Client', factory)` — production 소스에 `DRY_RUN` / `if mock:` 분기 **0건**
- Seed Contract: "Production code zero conditional branches for mock/dry-run" 강제 — 14개 test 파일이 동일 패턴
- `_REAL_HTTPX_CLIENT` 캡처 (import 시점) — factory가 재귀 호출 방지

**테스트 구조 (14 파일, +7340 / -0 + 정합 fix 추가 분)**:
- `test_fal_ai_api_key.py` (390L), `test_fal_ai_defaults.py` (141L), `test_fal_ai_preset_to_prompt.py` (158L) — pure 모듈 단위
- `test_fal_ai_request_builder.py` (546L), `test_fal_ai_response_parser.py` (556L) — pure function 단위
- `test_fal_ai_upload_step.py` (712L), `test_fal_ai_edit_step.py` (1090L), `test_fal_ai_download_step.py` (717L), `test_fal_ai_download_result.py` (595L) — 3-step HTTP via MockTransport
- `test_fal_ai_params_overrides.py` (666L) — 3-field allowlist 검증
- `test_fal_ai_call_integration.py` (NEW, 4 tests) — `__call__` end-to-end orchestration (commit `c280e86` 의 follow-up). 1 happy path (3 round-trips in correct URL order, prompt embedded in edit body, returned bytes == CDN body) + 3 short-circuit (missing/unknown/non-string preset → ValueError + captured == [])

**4중 정합 (Phase 3.1 정의 — Python 측 첫 phase)**:
- ✅ pytest: **1232 passed** (image_edit 283, 전체 945 prior + 287 추가) · 3 skipped (`.env` absent in CI)
- ✅ mypy `--strict`: 3 source files success
- ✅ ruff check: 13 files pass
- ✅ black `--check`: 13 files clean
- ✅ PII grep (`distinct_id|transaction_id|receipt_token|customer_email|selfieUri`): **0 matches** in production sources
- ✅ smoke_fal.py: 회귀 없음

**8번째 MCP-disconnect recovery (Phase 1.2/2.1/2.2/2.3/2.4/2.5/2.6/3.1)**:
- Orchestrator AC 9/21 도달 (Sub-AC 5/7 실행 중 disconnect)
- Worktree commit `67923be` → main feature branch cherry-pick `d5d17af`
- 1차 수동 완성 (`efd5874`):
  - `test_fal_ai_download_result.py` PEP 563 annotation 비교 수정 — `sig.return_annotation is bytes` 가 PEP 563 활성 모듈에서는 string `'bytes'` 와 비교됨. `typing.get_type_hints()` 로 클래스 해상도 후 identity check
  - black `--check` 자동 포맷팅 (4 test 파일)
- 패턴 재확인: 8회 연속 적용 — orchestrator scaffolding 강점은 일관, end-to-end semantic completeness check은 별도 책임

**Stage 2 1차 평가 REJECTED (score 0.78, 2026-05-20)**:
- Evaluator가 `__call__` 가 `NotImplementedError("body is supplied by sibling AC tasks")` 인 것을 발견 — adapter end-to-end 호출 불가능
- "AC 21/21 verified" 클레임은 사실 위반 — orchestrator partial이 AC 9/21 + manual completion이 test 표면 수정만 처리, AC 10 (`__call__` wireup) 미완
- Drift score 0.25, AC compliance NO

**2차 수정 (`c280e86` + `66d5b4d`)**:
- `__call__` 본체 wire — preset boundary resolve + deadline_monotonic 예산 분배 + 3-step orchestration
- 4 integration test 추가 — end-to-end MockTransport flow
- `httpx>=0.27` 를 `pyproject.toml` runtime dep 으로 추가 (CI `pip install -e packages/core-python` 시 누락되었던 의존)

**Stage 2 2차 평가 APPROVED (score 0.92, 2026-05-21)**:
- AC compliance YES, goal alignment 0.93, drift 0.05, uncertainty 0.10
- Evaluator의 7개 검증 질문 모두 positive — `__call__` 3-step orchestration, Protocol 시그니처 일치, integration test가 end-to-end (sub-method 재검증 아님), preset short-circuit 0 HTTP, deadline_monotonic 예산 분배, production mock 분기 0, 에러 분류 보존

**Out of scope (Seed 명시)**:
- FastAPI 서버 (Phase 4.1)
- 인증/사용자 관리 (Phase 4.3)
- result_wording 톤 혼합 (Phase 3.4)
- Mobile/RN wiring (Phase 4 server 등장 이후)
- diagnosis runtime (Phase 3.2)
- fine-tune / LoRA adapter (Seed v0.2.0 금지)

### Phase 3.2 결과 요약 (2026-05-21)

**Personal color diagnosis 런타임 wiring** (PR #17, squash merge `17342e7`, 12 files, +3761 net):

**진입점 + 4 모듈 구조 (Callable DI + 단일 경계 디시플린)**:
- `packages/core-python/src/personal_color/diagnose_runtime.py` (154L) — public `diagnose_personal_color(selfie_bytes: bytes, *, _decoder=decode_image, _detector=detect_face_regions) -> DiagnosisResult`. 3-step orchestration (decode → detect → diagnose_from_image). Phase 3.1의 Callable DI 패턴 재사용 (private kwargs). NotImplementedError / pass-only body **0건** (Phase 3.1 scaffold-gap 교훈 적용).
- `packages/core-python/src/personal_color/face_detector.py` (403L) — **단일 MediaPipe import 경계** file. `detect_face_regions(image: Image) -> FaceRegions`. Lazy mediapipe load (module-scope cache after first call). `FaceNotDetectedError(ValueError)` → Phase 4 HTTP 422. Multi-face tie-breaking: 가장 큰 area → topmost (smallest y) → leftmost (smallest x), fully deterministic. `TYPE_CHECKING` 가드 + lazy `_import_mediapipe()`로 import-time 모델 로드 회피.
- `packages/core-python/src/personal_color/image_decoder.py` (202L) — **단일 Pillow import 경계** file. `decode_image(bytes) -> Image` (PNG/JPEG → rows-first Sequence[Sequence[RGB]]). `InvalidSelfieError(ValueError)` → Phase 4 HTTP 400.
- `packages/core-python/src/personal_color/preset_mapping.py` (107L) — pure function `season_to_preset(Season) -> Literal['spring-warm','summer-cool','autumn-warm','winter-cool']`. Phase 3.1 `_PRESET_TO_PROMPT` 와 set-equality bijection (drift 0 invariant).

**7개 테스트 파일 (3분리: base lane / integration / contract)**:
- `test_diagnose_runtime.py` (514L), `test_preset_mapping.py` (128L) — base lane, stdlib + mock callables, mediapipe/Pillow 미설치에서 PASS
- `test_face_detector.py` (567L), `test_image_decoder.py` (290L) — `@pytest.mark.integration`, mediapipe / Pillow 필요
- `test_diagnose_runtime_determinism.py` (697L) — version-pin 강제 + composition determinism + 실 MediaPipe determinism (integration tier)
- `test_diagnose_runtime_fastapi_contract.py` (519L) — Phase 4 HTTP contract surface (status code 매핑 invariant)
- `test_phase0x_native_dep_isolation.py` (179L) — static grep + runtime sys.modules sentinel 로 mediapipe/PIL single-file 경계 강제

**Phase 0.x core 5 파일 보존 (zero changes)**:
- region_extractor.py / diagnosis_orchestrator.py / season_classifier.py / tone_classifier.py / contrast_classifier.py 변경 **0건**
- `[tool.black] force-exclude` 정규식으로 5 파일을 black 외부로 격리 — 940 prior tests baseline (mediapipe/Pillow 미설치에서) 그대로 PASS

**pyproject.toml runtime deps 확장**:
- `mediapipe==0.10.18` — exact pin (Phase 3.1 `httpx>=0.27` 패턴, CI Python 3.12 wheel 존재 검증)
- `Pillow>=10.0`
- `[tool.black] target-version = ["py312"]` + 5 파일 force-exclude

**4중 정합 (Phase 3.2 정의, base lane — mediapipe/Pillow 미설치 환경)**:
- ✅ pytest: **1338 passed** (image_edit 283 + personal_color 60+ + 기존 940) · 8 skipped (mediapipe absent locally on Python 3.13 — CI Python 3.12 runs integration tier and shows SUCCESS)
- ✅ mypy `--strict --follow-imports=silent`: 4 new source files clean
- ✅ ruff check: 11 파일 (4 src + 7 test) pass
- ✅ black `--check`: 11 파일 clean
- ✅ PII grep ([distinct_id, transaction_id, receipt_token, customer_email, selfieUri]): **0 matches** in 4 production files
- ✅ Boundary isolation grep: mediapipe 임포트 face_detector.py 단일, PIL/Pillow 임포트 image_decoder.py 단일

**9번째 MCP-disconnect recovery (Phase 1.2/2.1/2.2/2.3/2.4/2.5/2.6/3.1/3.2)**:
- Orchestrator AC 13/16, Sub-AC 2/4 도달 (mypy --strict step 실행 중 disconnect)
- Worktree 직접 commit `16cfe29` → main feature branch cherry-pick `ecc4e68`
- 수동 완성 (`3ae79e6`):
  - `test_this_determinism_test_file_does_not_reference_pii_identifiers` 자기-참조 logic 버그 수정 — `forbidden = (` 마커 제거 트릭이 tuple 내부 literal 토큰을 못 지워서 always-fail. chr-style concatenation (`"distinct" + "_" + "id"`)으로 파일 자체에서 PII 토큰 바이트 0건으로 만들어 static guard 정확화.
  - face_detector.py:236 unused `type: ignore[import-not-found]` 제거 (mediapipe transitive로 numpy resolve 됨)
- 패턴 재확인: 9회 연속 적용 — orchestrator scaffolding 강점은 일관, edge case 테스트 logic이 두 phase 연속(Phase 3.1 PEP 563 / Phase 3.2 self-referential)으로 수동 완성 필요

**MediaPipe 0.10.18 + Python 버전 호환성 노트**:
- mediapipe==0.10.18은 Python 3.10/3.11/3.12 wheels 만 제공 (3.13 wheel 없음).
- 로컬 dev (Python 3.13)에서는 integration tier skip — base lane (mock callables)만 검증.
- CI Python 3.12 + mediapipe==0.10.18 → integration tier 정상 실행, PR #17 CI checks SUCCESS.
- 향후 Python 3.13 migration 시 mediapipe upgrade 필요 (0.10.21+에서 `mediapipe.tasks` API 로 마이그레이션 동반).

**Stage 2 평가 APPROVED iter 1 (2026-05-21)**:
- Score **0.92** / AC compliance YES / Goal alignment 0.90 / Drift 0.05 / Uncertainty 0.15
- Evaluator 10개 검증 질문 모두 positive — NotImplementedError 0건, MediaPipe single boundary, Pillow single boundary, exact pin, PII grep 0, mock 분기 0, 3-step pipeline orchestrated, behavioral tests, Season.slug FastAPI 호환, _PRESET_TO_PROMPT bijection importable.

**Phase 3.1 vs Phase 3.2 비교 (Python pytest 측 2 phases)**:
| 측면 | Phase 3.1 (Fal.ai) | Phase 3.2 (diagnose runtime) |
|---|---|---|
| Stage 2 1차 결과 | REJECTED 0.78 (NotImplementedError __call__) | APPROVED 0.92 (no NotImplementedError from first commit) |
| Iterations to APPROVE | 2 (wireup fix follow-up) | 1 |
| Boundary file count | 1 (fal_ai_vendor_caller.py) | 2 (face_detector + image_decoder) |
| 수동 완성 작업 | PEP 563 annotation 비교, black 4 files | 자기-참조 PII test logic, 1 unused type ignore |

**Out of scope (Seed 명시)**:
- FastAPI 서버 구축 (Phase 4.1)
- Mobile/RN wiring (Phase 4 server 등장 이후)
- ContentPackage 화면 (Phase 3.3)
- result_wording 톤 혼합 (Phase 3.4)
- Phase 4 HTTP status code 매핑 정책 (이번 단위는 ValueError 서브클래스 계층까지만 정의)
- 새로운 ML 모델 학습 (기존 Phase 0.x 알고리즘 재사용)
- fine-tune / LoRA adapter (Seed v0.2.0 금지)

## 참고

- Seed v0.2.0: `~/Vault/ObsidianVault/PARA-Zettelkasten/Projects/personal-color-kr/seed-v0.2.0.md`
- Prior Ouroboros sessions: `orch_e1aeb316ad1f`, `orch_2ffcfe9aeaef`, `orch_5f21f8d27fa3`
