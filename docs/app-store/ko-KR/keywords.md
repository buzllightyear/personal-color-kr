# App Store 키워드 (Keywords) — ko-KR

> iOS App Store Connect → 앱 정보 → 현지화 (한국어) → **키워드(Keywords)** 필드에 입력해요.

| 항목 | 값 |
| --- | --- |
| locale | `ko-KR` |
| file_type | `metadata` |
| app_json_field | (해당 없음 — App Store Connect 입력 필드) |
| brand_voice | 해요체 (semi-formal, 펀널 화면 카피와 동일 톤) — 키워드 자체는 명사 토큰이므로 종결 어미 없음 |
| char_limit | **100자** (Apple 키워드 상한, 쉼표 포함) |

> **입력 규칙(ASO best practice)**: 키워드는 쉼표(`,`)로만 구분하고 **공백을 넣지 않아요**(공백도 1자로 차감돼요). 복수형·앱 이름·중복어는 넣지 않고, 단어를 조합하면 Apple이 자동으로 키워드 구문을 생성해요.

---

## ✅ 등록용 키워드 (Primary)

```text
퍼스널컬러,퍼컬,웜톤,쿨톤,봄웜톤,여름쿨톤,가을웜톤,겨울쿨톤,셀카편집,컬러진단,피부톤,톤매칭,사계절,AI얼굴분석,24포인트,메이크업,코디,프리셋,트렌드,컬러추천,큐레이션,뷰티
```

| 측정 항목 | 값 |
| --- | --- |
| char_count | **97자** (쉼표 21개 포함, 공백 0) |
| char_limit | 100자 |
| 잔여 | 3자 |
| 한도 준수 | ✅ |
| 키워드 토큰 수 | 22개 |
| 공백 포함 여부 | ❌ 없음 (규칙 준수) |

---

## 키워드별 유도 근거 (codebase_derivation)

모든 키워드는 기존 코드베이스 어휘(FUNNEL_SCREENS · SCAN_ANIMATION_STAGE_LABELS · 4계절 도메인 모델)에서만 도출했어요. 경쟁사 리서치로 만든 키워드는 없어요.

| 키워드 | 유도 출처 |
| --- | --- |
| `퍼스널컬러` / `퍼컬` | `FUNNEL_SCREENS.welcome_hook.metadata.hook` = `personal_color_diagnosis`; `퍼컬`은 타깃(20–30대 여성)의 통용 축약어 |
| `웜톤` / `쿨톤` | `FUNNEL_SCREENS.result_reveal` 카테고리 체계 (`autumn_warm` 등 웜톤·쿨톤 분류) |
| `봄웜톤` / `여름쿨톤` / `가을웜톤` / `겨울쿨톤` | 4계절 퍼스널 컬러 도메인 모델 (봄 웜톤·여름 쿨톤·가을 웜톤·겨울 쿨톤) |
| `셀카편집` | `FUNNEL_SCREENS.diagnosis_input` (셀카 1장 입력) + `value_props` (트렌드 맞춤 편집) |
| `컬러진단` | `FUNNEL_SCREENS.welcome_hook.subhead` ("1분 진단으로 …") |
| `피부톤` | `FUNNEL_SCREENS.fake_loader.subhead` ("피부 톤 · 명도 · 채도 · 컨트라스트") |
| `톤매칭` | `SCAN_ANIMATION_STAGE_LABELS[6]` = **"톤 매칭"** (8단계 스캔 라벨) |
| `사계절` | `welcome_hook.subhead` ("봄·여름·가을·겨울 카테고리") |
| `AI얼굴분석` | `FUNNEL_SCREENS.fake_scan_animation` (headline "얼굴 24개 포인트 스캔") + `SCAN_ANIMATION_STAGE_LABELS` ("얼굴 감지·윤곽 분석") |
| `24포인트` | `FUNNEL_SCREENS.fake_scan_animation.metadata.analysisPoints` = `24` |
| `메이크업` / `코디` | `FUNNEL_SCREENS.result_reveal.subhead` ("어울리는 메이크업·코디") |
| `프리셋` | `FUNNEL_SCREENS.value_props.metadata.valueProps` = `personal_color_preset_library` |
| `트렌드` | `FUNNEL_SCREENS.value_props.headline` ("오늘의 트렌드, 내 얼굴에 맞춘 편집") |
| `컬러추천` | `value_props` (퍼스널 컬러 기반 추천 preset) |
| `큐레이션` | `value_props.metadata.valueProps` = `monthly_curated_magazine` (매월 큐레이션 매거진) |
| `뷰티` | 도메인 카테고리(셀카+퍼스널 컬러+메이크업)의 상위 검색 진입어 |

> **타깃 적합성**: 20–30대 한국 여성 셀카 사용자가 실제로 검색창에 입력하는 `퍼컬`·`봄웜톤`·`셀카편집` 같은 구어/축약 키워드를 코드베이스 가치에 묶어, 친근한 큐레이션 보이스의 검색 진입점을 만들어요.

---

## 중복 회피 메모 (제목·부제와의 인덱싱 관계)

Apple은 **제목(Title)·부제(Subtitle)에 들어간 단어를 이미 키워드로 색인**해요. 따라서 키워드 필드에서는 제목/부제와 겹치는 단어를 의도적으로 줄이고, 롱테일·축약·계절 세분화 키워드에 100자를 집중했어요.

- 제목/부제 색인 예상어(키워드 필드에서 비중 축소): `퍼스널 컬러`, `셀카`, `진단`
- 키워드 필드 집중 영역: 계절 세분화(`봄웜톤`~`겨울쿨톤`), 축약어(`퍼컬`), 기능 롱테일(`24포인트`, `AI얼굴분석`, `톤매칭`, `셀카편집`)

> 제목·부제 최종 문구가 확정되면(`title.md`·`subtitle.md`) 겹치는 단어를 키워드에서 1차 점검하고, 빈 자리만큼 아래 ASO 보강 후보로 교체하세요.

---

## ASO 보강 권장 (경쟁/시장 리서치 — 제출 후 별도 트랙)

아래 항목은 **앱 자체 어휘 범위를 벗어나는 외부 데이터**가 필요해서 이번 단계(Phase 7.1)에서는 채우지 않았어요. 코드베이스 유도 원칙(`codebase_derivation`)을 지키기 위해 의도적으로 TODO로 남겼고, 출시 후 ASO 최적화 트랙에서 진행하세요.

- [ ] **TODO(human/marketing)**: 경쟁 앱 키워드 리서치 — 동일 카테고리(퍼스널 컬러·뷰티 진단) 상위 앱의 키워드/랭킹 갭 분석. *앱 자체 기능 어휘만으로는 도출 불가하므로 이번 단계 범위 밖.*
- [ ] **TODO(human/marketing)**: 키워드 검색량·난이도 데이터 수집 — App Store Connect Analytics, ASO 툴(예: 검색 인기도 지표)로 토큰별 트래픽 검증 후 저트래픽 토큰을 고트래픽 동의어로 교체.
- [ ] **TODO(human/marketing)**: 시즌/캠페인 키워드 로테이션 계획 — 환절기 퍼스널 컬러 수요 피크(봄·가을)에 맞춘 키워드 가중치 조정 일정 수립.
- [ ] **TODO(human/marketing)**: 동의어·오타 변형 확장 — `퍼스널칼라`, `퍼스널 칼라` 등 표기 변형의 검색 점유 여부 검증 후 잔여 글자수(3자) 활용 여부 결정.
- [ ] **TODO(human/marketing)**: A/B 키워드 세트 운영 — 등록용 세트와 대체 세트의 설치 전환율 비교(제품 페이지 최적화, PPO) 설계.

> ⚠️ 위 보강 작업은 모두 **경쟁사 리서치·외부 시장 데이터**에 의존하므로, 본 파일의 `codebase_derivation` 등록용 키워드와 분리된 후속 트랙이에요. 등록용 키워드만으로도 즉시 제출 가능해요.

---

## todo_markers

- 등록용 키워드(97자)는 publish-ready 상태이며 키워드 문자열 자체에는 TODO가 없어요.
- [ ] **TODO(human)**: 원어민 ASO 검수 후 등록용 키워드 1세트 확정 (기본값: 위 Primary 97자 세트).
- [ ] **TODO(human)**: App Store Connect 입력 화면 실시간 글자 수 카운터로 100자 한도 최종 확인(쉼표 포함 계산).
- [ ] **TODO(human)**: 제목/부제 확정 후 중복어 1차 점검 → 빈 자리만큼 ASO 보강 후보로 교체.
- ASO 보강 권장 섹션의 경쟁/시장 리서치 항목은 별도 후속 트랙(위 참고).

---

## 검수 체크 (이 파일 한정)

- [x] char_limit 100자 준수 (등록용 97자, 쉼표 포함·공백 0)
- [x] 키워드 100자 한도를 충분히 채움 (잔여 3자)
- [x] ASO 보강 권장 섹션 존재 + 경쟁 리서치 TODO 플래그
- [x] 모든 키워드 코드베이스(FUNNEL_SCREENS · SCAN_ANIMATION_STAGE_LABELS · 4계절 모델) 유도, 경쟁사 리서치 어휘 없음
- [x] ko-KR 단일 로케일, iOS 전용
- [x] 20–30대 한국 여성 셀카 사용자 타깃 키워드(`퍼컬`·`봄웜톤`·`셀카편집` 등)
- [x] 입력 규칙 준수(쉼표 구분, 공백 없음)
