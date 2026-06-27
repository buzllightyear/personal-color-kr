# STRATEGY — 본질·해자·이론적 토대 (living doc)

- **Status:** Living — 매 전략 세션마다 덧붙이고(add) 깎는다(trim).
- **Origin:** 2026-06-27 모선(Vault) 지식 채굴 세션의 종합. 이전엔 대화·메모에 흩어져 매 세션 재유도되던 것을 코드 옆 git-버전 문서로 고정. §1–5 초안 후 같은 날 전략 대화에서 §6(트렌드-커머스 방향) + §3 함의5 추가.
- **왜 여기 있나:** current-state의 ground truth는 코드다. 전략 해석은 감가하는 "외부 조림"이라 집이 없으면 증발한다. 이 문서가 집이고, add/trim이 곧 전략 자체에 조림 루프를 적용하는 것 — 감가 대신 적립.

## 읽는 법 — 인식론적 층화 (epistemic stratification)

각 주장에 출처·신뢰도를 태그한다. **이게 이 문서의 핵심 규율** — 없으면 가설이 단정으로 붕괴하고(모선 규약이 경고한 실패), 문서가 딸깍 환상으로 전락한다.

- `[ground-truth]` — 코드로 검증됨. 검증일·파일 위치 동반. current state의 진실.
- `[thesis]` — 전략 가설. 우리가 결정한 방향. 반증되면 깎는다.
- `[external]` — 모선/외부 도메인 지식. **유통기한** 표식 동반(외부 조림은 모델 발전에 흡수돼 감가).
- `[decision]` — 열린 결정. 누가·언제·무엇을 정해야 하는지.

관련 원자 메모: [[wrapper-first-moat-frame]], [[personal-color-kr-moat-thesis]], [[mothership-vs-project-truth]], [[fal-generation-quality-definition]], [[app-identity-decision]] (프로젝트 메모리).

---

## 1. 본질 (Essence)

**제품 = 트렌드-레시피 AI 셀피 생성기.** 운영자가 큐레이션한 레시피 → fal.ai 이미지 생성 → 갤러리. `[thesis + code-aligned]`

퍼스널 컬러 **진단**은 일회성 획득 hook / 마케팅 장치일 뿐 — 12단계 "Glam Up" 결제 펀널로 유저를 끌어들이지만, 이미지 생성을 personalize하지 **않는다**. (코드 증거: `{personal_color_modifier}` placeholder는 의도적으로 미전개; `generate.py`는 `strip_unfilled_modifier`로 제거만. 진단 출력은 생성 파이프라인에 도달하지 않음.) `[ground-truth, 2026-06-27]`

레시피는 **트렌드 중심**으로 설계되지 퍼스널-컬러 중심이 아니다. `[thesis]`

## 2. Moat 가설

**해자는 빌리는 게 아닌 데서 온다.** 모델·품질은 렌트되는 table-stakes다(누구나 같은 fal 모델 호출). 해자는: `[thesis]`

- **Wrapper-First 5요소** = 페르소나 정확도 × UX 발명 × 통합 속도 × 커뮤니티 화력. "모델 자체가 아니라 통합·맥락 큐레이션이 무기." Higgsfield가 이 전략의 외부 실물 구현체. `[external, 유통기한: 패턴은 durable하나 개별 전술은 모방됨]`
- **운영 해자 = 상대적 응답루프 cycle-time × hit-rate.** 병목 = **Sense + Learn**, *Author 아님*. `[thesis]`
- **행동 선호 데이터** (save/share/delete — **얼굴 아님**) + **privacy-as-counter-position.** `[thesis]`
- **엔진 = 트렌드-처리 능력 ("페르소나 정확도"의 정밀화).** 자산은 정적 "페르소나를 안다"가 아니라 **early-sense → structure → output** 루프(사진·패션 트렌드를 일찍 파악→분석/구조화→결과물). personal-color-kr ↔ tting.ai = *같은 엔진의 다른 출력 형태*. `[thesis]` (§3 함의5, §6)

**대비 — 우리가 일부러 버린 길:** Higgsfield의 #1 retention 해자 = Soul ID(얼굴 8~12장 학습→persistent reference_id→영구 재사용+유료게이트). 우리는 face-collection을 privacy로 OUT. 그래서 해자는 나머지 4요소 + 프라이버시에서 와야만 한다. `[thesis ← external 대비]`

## 3. 이론적 토대 — 점근선/조림 (왜 병목이 Sense이고 Author가 아닌가)

**"AI는 점근선, 조림이 상한선."** AI 출력은 0→1이 아니라 인간 조림(감→측정·재현)의 점근선이고, **조림 루프의 정밀도가 AI 출력의 천장을 결정**한다. 조잡한 조림 → 멀찌감치 멈춤; 정밀한 조림 → 실사용상 구분불가까지 근접. `[external, durable]`

함의 1 — **fal 모델 = 점근선, 우리 레시피 조림 = 천장.** "최고 모델 고르기"가 아니라 각 모델의 점근선을 우리 조림이 얼마나 끌어올리는지의 문제. 조잡한 조림의 좋은 모델 < 정밀한 조림의 평범한 모델. `[external → thesis]`

함의 2 (가장 결정-관련) — **외부 조림 vs 내부 조림 = 해자 유통기한 테스트:** `[external, durable]`
- **외부화된 조림** = prompt_template·Prompt Enhancer의 craft 토큰. 재사용 가능하나 **점근선 수렴 압력 노출** — 모델이 좋아지면 기본능력에 흡수됨. **감가자산.** (Higgsfield의 prompt-assembly 해자도 영구 복제불가가 아니라 *모델이 결국 흡수*.)
- **내면화된 조림** = 사용자의 한국 셀피 트렌드 감/Sense. **모델이 학습할 통로 자체가 없음. 적립자산.**
- → 이것이 §2의 "병목 = Sense+Learn, Author 아님"의 이론적 정당화. **Prompt Enhancer는 단기 lead-time용 감가자산, 진짜 적립은 Sense 체계화.**

함의 3 — **세공력은 꼬리 판별자를 요구한다.** 꼬리 판별자는 "AI 분포에 의식적 저항 + 다른 입력 풀 유지"해야 한다(눈이 AI 출력에 동질화되면 안 됨). `[external, durable]`

함의 4 — **딸깍 vs 세공.** "AI 디자이너 가치 = 딸깍 환상의 해체 + 세공이라는 답." = 우리 "non-slop / authenticity-sense" 포지셔닝의 출처. `[external → thesis]`

함의 5 — **트렌드-처리 능력의 삼분 (어디에 *인간* 시간을 쓰나).** 사용자 자산 = early-sense → structure → output 루프(= 조림 그 자체). 셋의 내구성이 다르다: `[external → thesis]`
- **early-sense (일찍 파악)** — 영구 해자. 내면화 조림 + 신선한 입력 풀 + 꼬리 판별자 취향. 모델이 학습할 통로 없음.
- **structure (분석/구조화)** — 감가. AI가 이미 트렌드 구조화를 잘함(외부 조림). 단 early-sense와 *분리불가하게 엮인 만큼만* 해자.
- **output (결과물)** — 렌트. fal이 만듦.
- → **대체불가 인간 시간은 early-sense + 입력 풀 신선도에**, structure·output은 시스템/AI에 위임. "나는 트렌드를 구조화한다"를 해자로 착각 금지(AI에 잠식).

## 4. 현 상태 대조 (code-verified, 2026-06-27)

Moat 가설의 3절반을 코드에 대조:

| moat 절반 | 현 상태 | 근거 `[ground-truth, 2026-06-27]` |
|---|---|---|
| **Sense** | 수동 계측, 앱과 단절 | 수동 트렌드-센싱 로그(5축 관측 프로토콜, off-repo)에 존재. 앱 코드엔 연결 없음 |
| **Author** | 구축됨 | admin recipe CRUD; `generate.py:177` 정적 `strip_unfilled_modifier(prompt_template)` |
| **Learn** | **미계측** | 갤러리 save=카메라롤만(`save-to-camera-roll.ts`), delete/favorite/share 없음; mobile src에 `/v1/events` POST 클라이언트 없음(sentry 제외) → recipe-태그 행동신호 서버 전송 0 |

- **prompt_template = 복제불가 craft 층 (이미 구현).** 공개 카탈로그(`recipes.py:11`)가 prompt_template "intentionally omitted", 모바일 매퍼도 안 받음. §3 함의2의 "외부 조림"이 서버 은닉돼 있음 — 단, 유통기한 있는 감가 층임을 기억. `[ground-truth, 2026-06-27]`
- **이벤트 인프라 존재:** `POST /v1/events` + `events` 테이블 → Learn 계측의 토대는 이미 있음(배선만 없음). `[ground-truth, 2026-06-27]`
- **fal_eval = 우리 꼬리 판별자를 짓는 중.** `blind_ai_test.py`(human spot-the-AI + `real_holdout`="다른 입력 풀") + `summarize.py`(naturalness FLOOR→diff_score→cost). `crafted` 변형 = portrait-realism playbook의 restyle 부분집합 = Prompt Enhancer의 원형. `[ground-truth, 2026-06-27]`

## 5. 열린 결정·우선순위

- **D1 — Learn 루프 계측 = 커머스-판단 엔진** (recipe/제품-태그 save/share/click/구매 → `/v1/events`). 인프라 있음, 사업자등록에 **안 막힘**, **적립자산**(§3 함의2·5; §6). early-sense 레버리지를 hit-rate로 *검증* + 머천다이징 판단(§6 (c))을 *복리*. 가장 레버리지 큼. `[decision: 우선순위 1]`
- **D2 — server-side Prompt Enhancer** (정적 template → selfie/트렌드별 craft 토큰 동적 조립). 단기 lead-time, **단 감가자산** — eval이 `crafted` wrapper의 lift를 검증한 *뒤*에 박는 게 측정먼저 정합. `[decision: D1 뒤 / eval 게이트]`
- **D3 — AI티: 버그 vs 피처.** 우리는 realism-first(AI티=버그). 야나두 등 한국 사례는 meme-first(AI티=피처)로도 성공. 일부 트렌드 레시피가 AI-aesthetic을 의도적으로 살릴 여지? `[decision: 미정, 전략 분기]`

## 6. 방향 — 트렌드-커머스 (shop-the-look)

`[thesis — 신선한 베팅: 모선 미검증, vanity 방향보다 불확실]` `[decision: vanity → 커머스 무게중심 이동]`

엔진(§2 트렌드-처리 능력, §3 함의5)의 **출력 형태**를 vanity 셀피(이미지)에서 **트렌드-큐레이션 shop-the-look**(커머스)로 이동. 현 vanity 빌드 폐기 아님 — 생성기·갤러리는 *시연 메커니즘*으로 재사용.

- **왜 더 큰 해자:** 트렌드-감을 최대로 씀; 데이터 = 제품-전환 선호(**얼굴 아님**, privacy 정합 — Soul-ID 막은 게 여기선 이점); BM = 어필리에이트/커머스(충동-sub보다 깊음); personal 재결합("트렌드 × 네 컬러 × 살 제품")으로 §본질의 진단-decoupling authenticity 모순 해소; KR 커머스 = 문화 텃밭(글로벌 VTON이 KR-native하게 못 함).
- **커머스 칸 내 위치 (서브모드 분해):** (1) 순수 VTON 유틸 = 충실도·카탈로그 게임, 인큐번트(구글·아마존·무신사) 텃밭 → **회피**. **(2) 트렌드-큐레이션 shop-the-look = 우리 자리** — VTON 시연 = table-stakes, 큐레이션 = 해자. (3) 큐레이션-어필리에이트(경량) = 공급 부담 ↓, 먼저 검증 가능.
- **세 판단 분해:** (a) 사진-미감 트렌드 [현 레시피가 운동] (b) 패션-제품 트렌드 [shop-the-look 요구] (c) 머천다이징·전환 [당장 없어도 됨]. 패션은 트렌드⊃수요라 (a/b)→구매 연결이 타이트하나, **(b) ≠ (c)**.
- **Learn 루프 = 커머스-판단 엔진(§5 D1):** 저장→클릭→구매 전환 데이터가 (a/b)감을 (c)머천다이징으로 *복리* + early-sense 레버리지를 hit-rate로 *검증*. retention 도구가 아니라 해자 적립점.
- **남은 gap / 리스크:** ① 모선 미검증(신선 베팅, 불확실). ② 의상 시연 품질 = table-stakes인데 `fal_eval`엔 *의상 충실도* 디스크리미네이터 없음(얼굴 naturalness만). ③ 공급/어필리에이트 운영이 사용자 자산 아닐 수 있음 — (3) 경량이 부담 최소화. ④ **early-sense의 *레버리지*(선점할 만큼 이른가)는 미검증** — Learn hit-rate가 유일한 검증기.

---

## 유지보수 노트

- **add/trim 규율:** 새 증거(eval 결과·코드 변경·트렌드·모선)가 나오면 해당 절을 갱신하고 태그·검증일을 함께 갱신. 반증된 `[thesis]`는 깎는다. 흡수된 `[external]`은 유통기한 만료로 표시.
- **코드가 진실:** `[ground-truth]` 항목은 인용 전 재검증(파일은 이동·변경됨). 이 문서가 코드와 충돌하면 코드가 이긴다 ([[mothership-vs-project-truth]]).
- **모선과의 관계:** 이 문서는 *이 프로젝트*의 정체성·방향을 정한다(모선 write-back 아님). 모선은 도메인 지식·why를 빌리는 곳이지 current-state 출처가 아니다.
