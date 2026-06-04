# App Store 부제 (Subtitle) — ko-KR

> iOS App Store Connect → 앱 정보 → 현지화 (한국어) → **부제(Subtitle)** 필드에 입력해요.

| 항목 | 값 |
| --- | --- |
| locale | `ko-KR` |
| file_type | `metadata` |
| app_json_field | (해당 없음 — App Store Connect 입력 필드) |
| brand_voice | 해요체 (semi-formal, 펀널 화면 카피와 동일 톤) |
| char_limit | **30자** (Apple 부제 상한) |

---

## ✅ 등록용 부제 (Primary)

```
셀카 1장으로 퍼스널 컬러 진단해요
```

| 측정 항목 | 값 |
| --- | --- |
| char_count | **19자** |
| char_limit | 30자 |
| 잔여 | 11자 |
| 한도 준수 | ✅ |
| 종결 어미 | `진단해요` → 해요체 확정 |

### 코드베이스 유도 근거 (codebase_derivation)

- `FUNNEL_SCREENS.diagnosis_input.headline` = **"셀카 1장만 올려주세요"** → `셀카 1장` 핵심 입력 행위
- `FUNNEL_SCREENS.welcome_hook.metadata.hook` = `personal_color_diagnosis` → `퍼스널 컬러 진단`
- `FUNNEL_SCREENS.welcome_hook.subhead` = "1분 진단으로 …" → 진단 = 핵심 가치 제안
- 종결 어미 `~해요`는 `rating_gate.subhead`("…괜찮아요"), `diagnosis_input.subhead`("…정확해요") 등 펀널 화면의 해요체 레지스터와 일치

> **타깃 적합성**: 20–30대 한국 여성 셀카 사용자에게 "셀카 1장"이라는 낮은 진입 장벽 + "퍼스널 컬러"라는 친숙한 뷰티 키워드를 결합해, 부담 없이 시작하는 친근한 큐레이션 보이스를 전달해요.

---

## 대체안 (A/B 테스트 · 시즌 교체용)

모두 30자 한도 준수 · 해요체 · 코드베이스 유도. 마케팅 A/B 또는 시즌 캠페인 시 교체 후보예요.

| # | 부제 후보 | char_count | 한도 준수 | 유도 출처 |
| --- | --- | --- | --- | --- |
| 1 | `셀카 1장으로 퍼스널 컬러 진단해요` (등록용) | 19 | ✅ | `diagnosis_input` + `welcome_hook` |
| 2 | `1분 진단으로 내 퍼스널 컬러 찾아요` | 20 | ✅ | `welcome_hook.subhead` ("1분 진단으로") |
| 3 | `내 컬러에 맞춘 트렌드 편집을 매월 받아요` | 23 | ✅ | `value_props` (monthly_curated_magazine) |
| 4 | `봄·여름·가을·겨울, 내 컬러 찾아드려요` | 22 | ✅ | `welcome_hook.subhead` (4계절 카테고리) |
| 5 | `퍼스널 컬러 preset으로 셀카 편집해요` | 23 | ✅ | `value_props` (personal_color_preset_library) |

> 후보 #4의 `·` 가운뎃점은 App Store Connect에서 1자로 계산돼요. 검수 시 등록 화면의 실시간 카운터로 재확인해요.

---

## todo_markers

- 부제 자체는 publish-ready 상태이며 별도 TODO 없음.
- [ ] **TODO(human)**: 원어민 카피라이터 최종 검수 후 등록용 부제 1개 확정 (기본값: Primary "셀카 1장으로 퍼스널 컬러 진단해요").
- [ ] **TODO(human)**: App Store Connect 입력 화면 실시간 글자 수 카운터로 30자 한도 최종 확인.

---

## 검수 체크 (이 파일 한정)

- [x] char_limit 30자 준수 (등록용 19자)
- [x] 해요체 종결 (`~해요` / `~찾아요` / `~받아요`)
- [x] 코드베이스(FUNNEL_SCREENS) 유도, 임의 창작 아님
- [x] ko-KR 단일 로케일, iOS 전용
- [x] 20–30대 한국 여성 셀카 사용자 타깃 보이스
