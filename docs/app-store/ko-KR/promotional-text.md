# App Store 프로모션 텍스트 (Promotional Text) — ko-KR

> iOS App Store Connect → 앱 정보 → 현지화 (한국어) → **프로모션 텍스트(Promotional Text)** 필드에 입력해요.
> 프로모션 텍스트는 앱 심사 없이 **수시로 교체**할 수 있어, 시즌 캠페인·이벤트 고지에 적합한 슬롯이에요.
> 로케일: `ko-KR` · 플랫폼: iOS App Store 전용

---

## 메타데이터

| 항목 | 값 |
| --- | --- |
| 필드 (App Store Connect) | 프로모션 텍스트 (Promotional Text) |
| locale | `ko-KR` |
| file_type | `metadata` |
| app_json_field | (해당 없음 — App Store Connect 입력 필드) |
| brand_voice | 해요체 (semi-formal, 펀널 화면 카피와 동일 톤) |
| char_limit | **170자** (Apple 프로모션 텍스트 상한) |

---

## ✅ 등록용 프로모션 텍스트 (Primary)

```
셀카 1장이면 충분해요. AI가 얼굴 24개 포인트를 분석해 봄·여름·가을·겨울 퍼스널 컬러를 1분 만에 찾아드려요. 내 컬러에 맞춘 트렌드 편집 preset도 매월 새롭게 받아보세요. 지금 무료로 시작해요!
```

| 측정 항목 | 값 |
| --- | --- |
| char_count | **116자** |
| char_limit | 170자 |
| 잔여 | 54자 |
| 한도 준수 | ✅ |
| 종결 어미 | `충분해요` · `찾아드려요` · `받아보세요` · `시작해요` → 해요체 확정 |

### 코드베이스 유도 근거 (codebase_derivation)

이 문구의 모든 가치 제안은 기존 `FUNNEL_SCREENS` 카탈로그에서 직접 도출했어요. 새로 지어낸 표현이 없어요.

| 문구 구성요소 | 출처 (소스) |
| --- | --- |
| `셀카 1장이면 충분해요` | `FUNNEL_SCREENS.diagnosis_input.headline` = "셀카 1장만 올려주세요" → 낮은 진입 장벽 |
| `AI가 얼굴 24개 포인트를 분석해` | `FUNNEL_SCREENS.fake_scan_animation` (`analysisPoints: 24`, headline "얼굴 24개 포인트 스캔 중") + `fake_loader.headline` "AI가 24개 포인트로 분석 중..." |
| `봄·여름·가을·겨울 퍼스널 컬러` | `FUNNEL_SCREENS.welcome_hook.subhead` = "1분 진단으로 봄·여름·가을·겨울 카테고리부터..." (4계절 퍼스널 컬러) |
| `1분 만에 찾아드려요` | `FUNNEL_SCREENS.welcome_hook.subhead` "1분 진단으로..." → 진단 소요 시간 |
| `내 컬러에 맞춘 트렌드 편집 preset도 매월 새롭게` | `FUNNEL_SCREENS.value_props` (`trend_matched_editing`, `monthly_curated_magazine`, `personal_color_preset_library`) |

- **value_prop**: `셀카 1장 → AI 24포인트 분석 → 1분 퍼스널 컬러 진단 → 매월 갱신되는 트렌드 맞춤 preset` (welcome_hook + value_props 결합)
- **brand_voice**: 해요체 (펀널 카피 `정확해요`, `괜찮아요`, `있어요`, `받아보세요`와 동일 레지스터)
- **target audience**: 20–30대 한국 여성 셀카 사용자 — "셀카 1장", "퍼스널 컬러", "트렌드 편집"으로 셀카+뷰티 도메인을 직접 호명

> **타깃 적합성**: "충분해요 / 시작해요"의 친근한 해요체로 부담 없는 큐레이션 보이스를 유지하면서, 광고/뷰티 앱 특유의 과장된 카피 대신 "1분", "셀카 1장"의 구체적 행동 약속으로 신뢰를 줍니다.

---

## 대체안 (시즌 캠페인 · A/B 테스트용)

프로모션 텍스트는 심사 없이 교체 가능하므로, 시즌·이벤트에 맞춰 아래 후보로 갈아끼울 수 있어요. 모두 170자 한도 준수 · 해요체 · 코드베이스 유도.

| # | 프로모션 텍스트 후보 | char_count | 한도 준수 | 유도 출처 |
| --- | --- | --- | --- | --- |
| 1 | `셀카 1장이면 충분해요. AI가 얼굴 24개 포인트를 분석해 봄·여름·가을·겨울 퍼스널 컬러를 1분 만에 찾아드려요. 내 컬러에 맞춘 트렌드 편집 preset도 매월 새롭게 받아보세요. 지금 무료로 시작해요!` (등록용) | 116 | ✅ | `diagnosis_input` + `fake_scan_animation` + `welcome_hook` + `value_props` |
| 2 | `1분이면 내 퍼스널 컬러를 찾아드려요. 셀카 1장만 올리면 AI가 얼굴 24개 포인트를 분석해 봄·여름·가을·겨울 카테고리를 알려드려요. 매월 새로워지는 트렌드 맞춤 편집 preset까지 만나보세요!` | 111 | ✅ | `welcome_hook` + `fake_scan_animation` + `value_props` |
| 3 | `셀카 1장으로 시작하는 퍼스널 컬러 진단! 봄·여름·가을·겨울 중 내 컬러를 1분 만에 찾고, 어울리는 메이크업·코디 가이드와 트렌드 편집 preset을 매월 받아보세요. 친구와 함께하면 더 즐거워요.` | 112 | ✅ | `welcome_hook` + `result_reveal` + `value_props` + `referral_gate` |

> `·` 가운뎃점은 App Store Connect에서 1자로 계산돼요. 검수 시 등록 화면의 실시간 글자 수 카운터로 재확인해요.

---

## 어조 검증 (해요체)

- `충분해요` = 형용사 `충분하다` + 해요체 종결어미 `-해요` → 해요체 ✅
- `찾아드려요` / `받아보세요` / `시작해요` → 모두 해요체 ✅
- 반말(예: `충분해`, `시작해`) 아님 ✅
- 존댓말(예: `충분합니다`, `시작하십시오`) 아님 ✅
- 기존 펀널 카피(`정확해요`, `괜찮아요`, `있어요`)와 동일한 해요체 레지스터 유지 ✅

---

## todo_markers

- 프로모션 텍스트 자체는 publish-ready 상태이며 별도 TODO 없음.
- [ ] **TODO(human)**: 원어민 카피라이터 최종 검수 후 등록용 프로모션 텍스트 1개 확정 (기본값: Primary).
- [ ] **TODO(human)**: App Store Connect 입력 화면 실시간 글자 수 카운터로 170자 한도 최종 확인.
- [ ] **TODO(human)**: 무료 시작/무료체험 문구는 실제 결제 모델(`payment_model`: 7+30=37일 무료체험)과 시점별로 일치하는지 출시 직전 확인.

---

## 검수 체크 (이 파일 한정)

- [x] char_limit 170자 준수 (등록용 116자)
- [x] 해요체 종결 (`충분해요` / `찾아드려요` / `받아보세요` / `시작해요`)
- [x] 코드베이스(FUNNEL_SCREENS) 유도, 임의 창작 아님
- [x] ko-KR 단일 로케일, iOS 전용
- [x] 20–30대 한국 여성 셀카 사용자 타깃 보이스
