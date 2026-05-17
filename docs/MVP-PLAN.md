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
| 2.1 | RN navigation stack (12 funnel screens 껍데기) | TS/RN |
| 2.2 | 1~5단계 screens (welcome → fake Analyzing 5초) | TS/RN |
| 2.3 | 6~9단계 screens (scan_option → paywall 앞) | TS/RN |
| 2.4 | 10~12단계 한국 변형 (referral·social·payment) | TS/RN |
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
| 2.1 | — | — | | | 다음 단계 (Phase 2 시작) |
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

각 work unit 완료 시 이 표에 session_id·commit hash·QA 결과 기록.

## 참고

- Seed v0.2.0: `~/Vault/ObsidianVault/PARA-Zettelkasten/Projects/personal-color-kr/seed-v0.2.0.md`
- Prior Ouroboros sessions: `orch_e1aeb316ad1f`, `orch_2ffcfe9aeaef`, `orch_5f21f8d27fa3`
