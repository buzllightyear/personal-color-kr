# 2026-06-30 — AX: drift-check Phase 2 (D4) + 회의록 관행 신설

## 논의
AX(AI 전환) 세션. 토독 validity-first 프레임을 조직-brain 평면에 계속 적용. drift-check Phase 2 구현·머지, 이후 "다음 방향" + "우리도 회의록 쌓아야 하나" 메타 논의.

## 옵션 저울질
- **Phase 2 스코프:** D4만 / D4+D2 / 다른 surface → **D4만.** (측정: D4 = 라이브 드리프트 있음 `ci.yml pytest<9.1` ↔ `pyproject >=9.1.1`; D2 = STRATEGY `[ground-truth]` 3개 전부 meta-mention = 무신호.)
- **머지 마무리:** PR / 로컬머지 / 보류 / 폐기 → **PR**(#107 패턴).
- **다음 본류:** fal_eval moat eval(미커밋 WIP 174줄, AX 우회 전 본류 #105) vs STRATEGY 피벗 실행(§7-§9) vs 런치 블로커(사업자등록 외부 블록) → **미결.**
- **회의록:** 안 쌓음(내 초안: "논의 문서화=drift 표면") / 쌓음(사용자 반박: archive≠SSoT) → **쌓음.** archive는 append-only·날짜라 drift 안 함 + 컴팩션이 추론을 지우니 더 필요.

## 결정 / 미결
- ✅ **drift-check Phase 2 = D4만 shipped** (PR #108, squash `d758cd0`). 반영처: 스펙 §14/R3 + 코드 `scripts/drift_check/`(version_specifiers·config_seams·models·report·run) + 메모리 `ax-validity-first-drift-check` + 모선 Inbox seed.
- ✅ **D2 보류**(무신호), **drift-check Phase 3(D3+J) 안 짓는다**(신호게이트, doc↔code drift ≈0). AX 서브스레드 종착.
- ✅ **`docs/sessions/` 회의록 archive 관행 신설** (이 문서가 첫 항목). CLAUDE.md에 포인터.
- ✅ **archive 트리거 확정** = *사용자 pre-close 신호*(주: "기록하고 닫자" → 에이전트 증류) + *에이전트 턴-안 플래그*(보조). 고정주기·"매일"·자동 "세션끝" 없음(관측 가능한 단일 시점이 없음 — Stop 훅은 매 턴 끝). 반영: README "언제" 절. 옵션 저울질 흔적: "매일"·"세션 끝"·"wrap" 전부 *관측 불가/기억-칸*이라 기각 → 유일한 신뢰 관측자=사용자라 트리거를 사용자에 둠.
- ⛳ **미결(OPEN) — 다음 본류:** `fal_eval moat eval 마무리` vs `§7-§9 피벗 실행`. 아직 안 정함. (fal_eval은 우회 전 멈춘 본류 + moat 품질플로어; 피벗은 decided-but-unexecuted, drift-check ROI가 현금화되는 지점.)

## 왜 / 교훈
- **drift∝1/메커니즘** — 메커니즘은 측정이 가리키는 무장치 표면에만(D2 거부 근거; 과잉규율 회피).
- **도구가 자기 스펙을 먹음(2번째 사례):** opus 전체리뷰가 drift 탐지기 *자신의 스펙↔코드 드리프트*(M4: 스펙 `is_compatible`/`locator` ↔ 코드 `is_satisfiable`/`group`) 적발 → 설계 문서도 조직-brain 드리프트 표면.
- **AX가 바꾼 것 = 거버넌스 시나리오**(의도-drift가 머릿속 부담 → 온디맨드 계기), *만드는* 시나리오·moat 작업(생애-brain)은 plane 가드로 불변. ROI는 피벗 실행 때 현금화.
- **회의록 ≠ SSoT:** archive는 append-only·날짜라 drift 안 함. 컴팩션이 추론의 결을 지우니 여기가 그걸 남기는 유일한 층. (이 관행 자체가 그 결론의 실행.)

## 관련
- 코드: PR #108 / 커밋 `d758cd0` · Phase 1 = PR #107 / `b48ae09`
- 메모리: `ax-validity-first-drift-check`, `toolchain-governance-principle`, `strategy-living-doc`
- 모선: Inbox seed `pck-validity-first-drift-check-phase2` (→ `[[pck-validity-first-drift-check-realized]]` 병합)
- 미커밋 보존: `scripts/fal_eval/*` (다음 본류 후보)
