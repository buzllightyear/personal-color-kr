# Drift Check — surfaced validity-first 지식 드리프트 탐지기 (설계)

- **Status:** Design (승인 대기) — 2026-06-29
- **Origin:** AX(AI 전환) 세션. 토스 토독([technical-writing-2](https://toss.tech/article/technical-writing-2))의 핵심 명제 *"문서의 본질 = 생성이 아니라 유효성 판별"* 을 personal-color-kr의 조직-brain 평면에 차용. 같은 날 실행한 baseline drift 감사가 사양을 정조준함.
- **관련:** `docs/STRATEGY.md` (validity-first를 주장단위로 이미 구현), `docs/decisions/0002` (reachability gate = 같은 계열의 강제 인바리언트), memory `[[toolchain-governance-principle]]` (신뢰도 사다리), `[[app-identity-decision]]` (이 도구가 잡았어야 할 첫 drift).
- **Revisions:** 2026-06-29 R1 — codex review R1 critical 2/high 5 반영: plane-split을 D1/J 데이터계약에 연결, code-wins 출력 규칙, D1 역참조-신호 한계 명시, Phase 1 골든 범위 분리, J 판정 별도 파일 merge, Phase 4 non-blocking 고정. + medium 정리: git 신뢰모델(advisory), 타깃 해석 규칙(memory=repo 밖), verdict enum pre/post-J 주석, D2 scope를 §12 열린결정으로 승격.
- **Revisions:** 2026-06-29 R2 (plan-write 중 발견) — §4 D1 plane 가드를 *marker-tag-based → target-based*로 교정. R1의 "plane∈{ground-truth,obligation,config} marker만 파싱"은 문자대로면 §7-G(`[decision]` 태그)를 제외해 flagship #1을 놓침. 교정: 타깃이 cross-file 조직-brain 문서일 때만 finding, 주변 태그로 거르지 않음(D1은 ack만 보고 유효성은 J). spec↔plan 정합.

---

## 1. 목적 (Purpose)

personal-color-kr의 **지식층(docs)이 코드·서로와 어긋나는 것(spec-code / doc-doc drift)을 *판별해 수면 위로 올리는*** surfaced(비차단) 도구. 차단도 자동수정도 아님 — 사람이 판단하도록 **보이게** 한다.

**한 줄:** STRATEGY가 앞서 결정하고 하류 SSoT(CLAUDE.md·memory)가 안 따라오는 *전파-지연*을, 사람 기억이 아니라 기계가 잡는다.

## 2. 동기 — baseline 감사가 측정한 것 (2026-06-29)

3축 전수 감사 결과, **drift는 메커니즘 없는 곳에만 정확히 쌓였다:**

| 표면 | 신뢰도 사다리 칸 | 실측 drift |
|---|---|---|
| code↔code/test 의무 | 빨리실패 (CI 게이트) | ≈0 (24중 21 VALID) |
| doc↔code 사실 (ground-truth 줄-앵커) | 보이게+수동 재검증 | ≈0 (12중 9 VALID, 앵커 라인까지 정확) |
| **doc↔doc 정체성/전략 전파** | **기억 (산문 관행, 무장치)** | **진짜 drift 4건 전부** |

→ 이 도구는 **무장치 핫surface(doc↔doc 전파-지연)에 정조준.** code↔code엔 깔지 않는다(이미 CI가 함 = 과잉규율 회피).

## 3. 스코프

**대상 (조직-brain — 사람 빼면 순이득):**
- `docs/STRATEGY.md`의 `[ground-truth]` 주장 + supersession 마커(`SUPERSEDED`/`정정`/`후속 파킹`).
- `CLAUDE.md` "What this is" + "touch X update Y" 의무 테이블의 *사실* 주장.
- memory 노트, `docs/decisions/` ADR.
- 소수의 config-seam 불변식.

**비-대상 (의도적 — 가드):**
- code↔code/test 의무 — 이미 CI가 강제. 중복 금지.
- `[thesis]`/`[decision]`/`[external]` 판단·방향·외부지식 주장 — "옛 진실"이란 게 없음. **taste·트렌드 큐레이션(생애 brain)은 절대 대상 아님.**
- 차단(gate)·자동수정·LLM 신규 의존성.

**평면 필터 = 기존 태그 시스템.** `[ground-truth]`/의무/config = IN, `[thesis]`/`[decision]`/`[external]` = OUT. 경계를 새로 그을 필요 없음 — STRATEGY의 인식론 태그가 이미 그어둠.

## 4. 아키텍처

싼 결정론 층(D1–D4) → bounded AI 판사(J) → surfaced 리포트. 2-stage.

| 층 | 검사 | 메커니즘 | 잡는 것 |
|---|---|---|---|
| **D1** | **supersession-전파** (코어) | STRATEGY의 supersession marker 파싱 → **명명된 타깃이 cross-file 조직-brain 문서(`CLAUDE.md`/memory `.md`/`docs/decisions/*.md`)일 때만** finding 산출. **plane 가드 = 타깃-기반**(marker의 주변 epistemic 태그로 거르지 *않음* — 전파 마커는 `[decision]`/`[thesis]` 아래도 정당, 예 §7-G는 `[decision]`이나 flagship). D1은 "타깃이 ack했나"만 보고 주장 *유효성*은 절대 판정 안 함(그건 J, [ground-truth] 전용) → 가드 자동 충족. intra-STRATEGY 섹션 자기참조 타깃 제외. → 타깃이 마커(또는 섹션 id, 예 `§7-B`)를 **역참조하지 않으면** flag. 마커 날짜 이후 타깃 미수정 = 보조 신호(확신도↑). *주 신호 = 역참조 부재*. VALID/DRIFT 단정 없이 PROPAGATION_MISSING / PROPAGATION_STALE_CANDIDATE / NEEDS_MANUAL_REVIEW 후보만 산출 | doc↔doc 전파-지연 (#1·#2·#3) |
| **D2** | **태그-린트** | `[ground-truth]` 주장은 동일 단락 내 코드ref(파일/`심볼`/`file:line`) ≥1 필수 | 태그 위생 (mis-tag) |
| **D3** | **앵커-staleness** | 주장이 (파일/심볼ref + 검증일) 보유 → 그 파일이 검증일 이후 변경됨? → 재판정 큐 | doc↔code 노후 |
| **D4** | **config-seam** | 선언된 cross-config 불변식 비교 (시작: pytest 핀 `ci.yml` ↔ `apps/api/pyproject.toml` dev) | config↔config (#4) |
| **J** | **AI 판사** | D1·D3에서 tripped 항목만 → 에이전트가 주장+현 코드/문서 읽고 VALID/DRIFT/AMBIGUOUS+근거 분류 | 의미 판단 |

**D1 마커 문법 (최소 신축):** D1 v1은 기존 산문 마커를 휴리스틱 파싱(키워드 `SUPERSEDED|정정|파킹` + 날짜 정규식 + 명명된 타깃 추출: 파일명·`[[wikilink]]`·"CLAUDE.md" 언급). *신규* 마커엔 파싱 가능한 접미사를 **권장**(예: `→ propagate: CLAUDE.md, [[app-identity-decision]]`) — 기존 것 재인코딩 강제 안 함(=토독 "AI가독 기준"의 점진 도입).

**D1 판정 규칙 (역참조 신호의 한계):** 역참조 부재는 *필요 증거*일 뿐 drift의 증명이 아니다. 타깃이 이미 마커/섹션 참조를 담고 있으면 D1은 (추출 가능할 때) 잔존 superseded 문구가 남아있는지까지 확인하고, 그렇지 않으면 VALID가 아니라 `NEEDS_MANUAL_REVIEW`를 낸다. 의미 verdict(VALID/DRIFT)는 D1이 아니라 J의 책임 — D1은 후보만 surface한다.

## 5. 컴포넌트 (격리·단일목적)

```
scripts/drift_check/
  markers.py       # doc → list[Marker(location, date, plane, targets: list[Target(canonical_path, section_id?, source_syntax)])]   (pure parse)
  tags.py          # STRATEGY → list[GroundTruthClaim(text, refs[], date)]  (pure parse)
  git_probe.py     # "path가 date 이후 변경됨?" git 래퍼 (thin)
  config_seams.py  # 선언된 불변식 + 검사
  report.py        # findings → docs/drift-report.md (markdown)
  run.py           # D1–D4 오케스트레이션 → deterministic findings + tripped.json
```

- **J 단계 = Claude Code 하베스트 재사용.** `run.py`가 `tripped.json`(판정 필요 항목) 출력 → operator가 Claude Code에서 `/drift-judge`(또는 수동)로 판사 서브에이전트 dispatch → 리포트에 J 판정 append. **새 LLM 클라이언트/API 키 0** (repo에 LLM 의존성 없음 — 유지).
- 각 유닛: parse-only 또는 git-only → 네트워크 없이 unit-test 가능.
- **타깃 해석(`Target.canonical_path`):** `CLAUDE.md` 등 파일명 언급 → repo-root 상대경로; ADR 번호/slug → `docs/decisions/<nnnn>-*.md`; `[[wikilink]]` → **프로젝트 auto-memory 디렉토리**의 `<slug>.md`. ⚠ memory는 **repo 밖**(경로는 repo 위치에서 파생 또는 설정값) — 도구가 의도적으로 repo-tree를 넘는 유일한 지점. 해석 불가 타깃 = `NEEDS_MANUAL_REVIEW`(추측 금지).

## 6. 데이터 흐름

```
docs + code
  → run.py
    → markers / tags / git_probe / config_seams
      → deterministic findings  ─┬─→ docs/drift-report.md (D1·D2·D4 + D3 tripped 목록)
      → tripped.json  ───────────┘
        → (Claude Code 판사 단계, on-demand)
          → drift-judgments.json에 J 판정 기록
```

- **J 판정 수명주기:** `tripped.json`은 각 deterministic 후보의 stable id를 담고, J는 결과를 별도 `drift-judgments.json`에 기록한다. `report.py`는 매 실행 deterministic findings를 재생성하면서 `drift-judgments.json`의 판정을 id로 merge(리포트 직접 append 금지) — stale 판정은 id 불일치로 자연 탈락하고, 재생성(§7)과 J 기록이 충돌하지 않는다.

## 7. 출력 (surfaced)

`docs/drift-report.md` — 매 실행 재생성. 표: `주장/마커 → 위치 → refs → verdict(VALID/DRIFT/STALE-ANCHOR/AMBIGUOUS) → severity → human action`. 끝에 1줄 요약(`X VALID, Y DRIFT, …`). (J 실행 *전*에는 D1 후보가 `PROPAGATION_MISSING/PROPAGATION_STALE_CANDIDATE/NEEDS_MANUAL_REVIEW`로 표기되고, `verdict` 컬럼은 J 후 채워진다 — pre-J 후보상태 ≠ post-J verdict.)

- **Code wins for current state:** spec-code 항목에서 현재 코드가 진실의 기준. 리포트는 "코드 대비 문서 확인/갱신" human action만 제안할 수 있고, 코드를 바꾸거나 문서를 현재 코드 상태보다 앞세우는 수정은 제안하지 않는다 (inverse drift 제조 금지).
- **커밋 안 함(기본):** `.gitignore`에 추가 + 콘솔에 요약 print. (재생성 산출물의 git churn 회피. PR 가시성 필요해지면 Phase 4에서 재고.)

## 8. 에러 처리

- git 없음/dirty tree → git-의존 검사(D1 날짜비교·D3) skip + 리포트에 명시(조용히 통과 금지).
- **git 신뢰 모델:** git 날짜 비교(D1 보조·D3)는 *advisory*. rename·timezone 없는 날짜·author-date vs commit-date·무관 수정·미커밋 전파가 확신도를 흔들므로, **git 신호 단독으로는 후보를 DRIFT로 승급 못 함** — 주 신호(역참조 부재) 또는 J 판정과 결합해야만 승급.
- 파싱 불가 마커/주장 → `needs-manual-review`로 나열, **크래시 금지**.
- `AMBIGUOUS` = 1급 verdict — 이진 강제 금지(불확실을 drift로도 valid로도 위장하지 않음).

## 9. 테스트

- 유닛: `markers`/`tags`/`config_seams` 각각 fixture 문서로 (pytest, `scripts/` 규약).
- **골든 회귀 = 픽스처 스냅샷 기준** (살아있는 repo 아님 — repo는 #1·#2가 이미 전파돼 변함). `tests/fixtures/`에 2026-06-29 baseline 직전 상태의 미니 doc/코드 스냅샷을 박제 → 도구가 그 위에서 알려진 drift를 재발견하는지 assert. **Phase 1 골든은 D1 doc↔doc 전파-지연 케이스(진단정체성 #1·#2·#3)만 assert한다 — D2 태그위생·D4 pytest-seam 픽스처는 Phase 2에서 별도 expected output으로 추가**(골든 범위 = Phase 1 구현 범위와 일치). = 측정→메커니즘 루프의 닻. (살아있는 repo 대상 실행은 회귀 테스트가 아니라 도구의 *용도* 그 자체.)
- 네트워크/LLM 없이 D1–D4 전부 검증 가능(J는 별도 수동 검증).

## 10. 언어·위치

**Python**, `scripts/drift_check/` — `scripts/fal_eval`·`scripts/check-route-reachability.mjs` 옆. 텍스트·git 처리에 적합, pytest 가용.

## 11. 단계 (phasing)

| Phase | 내용 | 가치 |
|---|---|---|
| **1** | D1(supersession-전파) + report + 골든 테스트 | 최소 슬라이스로 고가치 doc↔doc drift 잡음 |
| **2** | D2(태그-린트) + D4(config-seam) | 싼 결정론 추가 |
| **3** | D3(앵커-staleness) + J(Claude Code 판사 명령/스킬) | 의미 판단 배선 |
| **4 (deferred)** | 스케줄/manual CI 트리거(non-required·allow-failure·exit 0·protected-branch gate 절대 아님) + 리포트 커밋 재고 | 신호 품질 본 *뒤* |

## 12. 열린 결정 (추천 동반 — 리뷰에서 확정)

1. **트리거:** 온디맨드 우선(P1–3), CI 미룸(P4). *이유: solo·surfaced·과잉규율 회피.*
2. **AI 판사:** Claude Code 서브에이전트(신규 의존성 0). *대안 독립 스크립트+API = 빌드↑·키관리·이 단계 과함.*
3. **출력 커밋:** 안 함(gitignore)+print. *대안 커밋 = PR 가시성↑ 단 churn.*
4. **마커 문법:** 기존 산문 휴리스틱 + 신규 `→ propagate:` 접미사 권장(강제 아님).
5. **D2 scope (Phase 2 전 확정):** "동일 단락 내 코드ref ≥1"은 좁아 false pos/neg 소지(표·직전 문단에 ref 있는 정상 `[ground-truth]` mis-flag / 코드ref 하나 붙인 judgment claim 통과). → 범위를 단락→섹션으로 넓힐지, plane-split(태그 기반)로 형식 lint를 보강할지 Phase 2 D2 구현 전 결정. *형식 lint가 의미 경계를 대신하지 않게.*

## 13. 비-목표 (재확인)

code↔code 게이트 중복 ✗ · 판단 슬롯(생애 brain) 판별 ✗ · 차단/자동수정 ✗ · LLM 신규 의존 ✗ · "drift 0 보장"(불가 — 목표는 신뢰도 사다리 *기억→보이게* 승급, 하드 개런티 아님).
