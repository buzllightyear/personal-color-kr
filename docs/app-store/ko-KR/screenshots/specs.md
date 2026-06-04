# 스크린샷 카피 사양 (Screenshot Copy Specs) — ko-KR

> iOS App Store Connect의 **스크린샷(미리보기)** 슬롯에 올릴 6장의 한국어 카피 사양이에요.
> 이 문서는 **카피 전용**이라 오버레이 텍스트와 캡처 대상 화면만 정의해요.
> 실제 비주얼 디자인·렌더링된 PNG 자산은 캡처 단계(아래 TODO)에서 만들어요.
> 로케일: `ko-KR` · 플랫폼: iOS App Store 전용

---

## 메타데이터

| 항목 | 값 |
| --- | --- |
| 필드 (App Store Connect) | App 미리보기 및 스크린샷 |
| 로케일 | ko-KR |
| 어조 (brand voice) | 해요체 (semi-formal) |
| 타깃 사용자 | 20–30대 한국 여성 셀카 사용자 |
| 사이즈 클래스 (필수) | 6.7형 `1290 x 2796`, 6.5형 `1284 x 2778` |
| 사이즈 클래스 (생략) | 5.5형 (Apple 현행 권장에서 제외 → SKIP) |
| 슬롯당 장수 | 사이즈 클래스마다 6장 (총 12장) |
| 내러티브 출처 | `packages/core-ts/src/funnel/screens.ts` (`FUNNEL_SCREENS`) |

---

## 내러티브 아크 (퍼널 순서 고정)

스크린샷 6장은 `FUNNEL_SCREENS` 카탈로그가 정의한 퍼널 흐름을 그대로 따라가요.
순서는 **welcome_hook → selfie_capture → fake_scan_animation → scan_animation(8단계) → result_reveal → social_evolution** 으로 고정돼요. 이 순서는 변경하지 않아요.

```
1. welcome_hook         → 1분 진단 hook 인입 (가치 한눈에)
2. selfie_capture       → 셀카 1장 업로드 (입력 간편함)
3. fake_scan_animation  → AI 24개 포인트 얼굴 스캔 시작
4. scan_animation(8단계) → 8단계 정밀 스캔 진행 (얼굴 감지 → 결과 준비)
5. result_reveal        → 4계절 퍼스널 컬러 결과 (가을 웜톤 티저)
6. social_evolution     → 실제 후기·인플루언서·친구 추천 사회 증명
```

> 스크린샷 3과 4는 같은 화면(`fake-scan-animation.tsx`)에서 **다른 순간**을 캡처해요.
> 3은 스캔 시작(24개 포인트 오버레이) 순간, 4는 8단계 진행 사다리가 보이는 순간이에요.

---

## 마스터 카피 표 (6장 · 6열)

오버레이 카피는 두 사이즈 클래스에서 **동일**하게 사용해요. 아래 표가 단일 기준이에요.

| # | 내러티브 위치 (narrative_position) | 화면 소스 경로 (screen_source_path · repo-relative) | 헤드라인 오버레이 (headline_overlay_ko) | 서브타이틀 오버레이 (subtitle_overlay_ko) | 핵심 가치 (value_prop) |
| :-: | --- | --- | --- | --- | --- |
| 1 | `welcome_hook` | `apps/mobile/app/(funnel)/welcome-hook.tsx` | 내 퍼스널 컬러로 셀카가 빛나요 | 1분 진단으로 봄·여름·가을·겨울까지 한 번에 | 1분 퍼스널 컬러 진단 hook |
| 2 | `selfie_capture` | `apps/mobile/app/(funnel)/diagnosis-input.tsx` | 셀카 한 장이면 충분해요 | 정면·자연광·민낯에 가까울수록 더 정확해요 | 셀카 1장 입력의 간편함 |
| 3 | `fake_scan_animation` | `apps/mobile/app/(funnel)/fake-scan-animation.tsx` | AI가 얼굴 24개 포인트를 스캔해요 | 셀카 위에서 스캔 라인이 24개 포인트를 짚어요 | AI 24포인트 얼굴 스캔 |
| 4 | `scan_animation_8stage` | `apps/mobile/app/(funnel)/fake-scan-animation.tsx` | 8단계로 꼼꼼하게 분석해요 | 얼굴 감지부터 톤 매칭까지 단계별로 진행돼요 | 8단계 정밀 스캔 애니메이션 |
| 5 | `result_reveal` | `apps/mobile/app/(funnel)/result-reveal.tsx` | 당신의 카테고리는 가을 웜톤이에요 | 어울리는 메이크업·코디까지 한눈에 확인해요 | 4계절 퍼스널 컬러 결과 |
| 6 | `social_evolution` | `apps/mobile/app/(funnel)/social-evolution.tsx` | 12만 명 넘게 함께하고 있어요 | 실제 후기·인플루언서, 친구 추천으로 이어져요 | 실제 UGC·인플루언서 사회 증명 + 친구 추천 코드 |

### 화면 소스 경로 검증 (screen_source_path 실재 확인)

아래 6장이 가리키는 **모든 화면 소스 경로는 리포지터리에 실재하는 정확한 파일**이에요(추정 경로 아님). 캡처 담당자는 이 경로를 그대로 열어 해당 화면을 캡처하면 돼요.

| # | narrative_position | screen_source_path (repo-relative) | FUNNEL_SCREENS 키 | 실재 여부 |
| :-: | --- | --- | --- | :-: |
| 1 | `welcome_hook` | `apps/mobile/app/(funnel)/welcome-hook.tsx` | `FUNNEL_SCREENS.welcome_hook` | ✅ 존재 |
| 2 | `selfie_capture` | `apps/mobile/app/(funnel)/diagnosis-input.tsx` | `FUNNEL_SCREENS.diagnosis_input` (셀카 단독 입력) | ✅ 존재 |
| 3 | `fake_scan_animation` | `apps/mobile/app/(funnel)/fake-scan-animation.tsx` | `FUNNEL_SCREENS.fake_scan_animation` | ✅ 존재 |
| 4 | `scan_animation_8stage` | `apps/mobile/app/(funnel)/fake-scan-animation.tsx` | `FUNNEL_SCREENS.fake_scan_animation` + `SCAN_ANIMATION_STAGE_LABELS` | ✅ 존재 |
| 5 | `result_reveal` | `apps/mobile/app/(funnel)/result-reveal.tsx` | `FUNNEL_SCREENS.result_reveal` | ✅ 존재 |
| 6 | `social_evolution` | `apps/mobile/app/(funnel)/social-evolution.tsx` | `FUNNEL_SCREENS.social_evolution` | ✅ 존재 |

> 카피 근거가 되는 소스 카탈로그 경로도 실재해요: `packages/core-ts/src/funnel/screens.ts`(`FUNNEL_SCREENS`), `packages/core-ts/src/scan_option/scan-animation.ts`(`SCAN_ANIMATION_STAGE_LABELS`, `SCAN_ANIMATION_TOTAL_STAGES = 8`).
> 스크린샷 2의 `narrative_position`은 `selfie_capture`지만 실제 화면은 `diagnosis_input`(셀카 1장 단독 입력) 이에요 — `FUNNEL_SCREENS` 카탈로그 주석 "Step 7 (`diagnosis_input`) is 셀카만 단독"과 일치해요.

### 카피 근거 (codebase 도출)

모든 오버레이는 `FUNNEL_SCREENS` 및 스캔 애니메이션 라벨에서 도출했고, 새로 지어내지 않았어요.

- **1** `welcome_hook.headline` "내 퍼스널 컬러로 셀카가 한 장 더 빛나도록" + `subhead` "1분 진단으로 봄·여름·가을·겨울 카테고리…"
- **2** `diagnosis_input.headline` "셀카 1장만 올려주세요" + `subhead` "정면 · 자연광 · 민낯에 가까울수록 결과가 정확해요"
- **3** `fake_scan_animation.headline` "얼굴 24개 포인트 스캔 중" + `subhead` "셀카 위에서 스캔 라인이 24개 포인트를 짚어내고 있어요" (`metadata.analysisPoints: 24`)
- **4** 8단계 스캔 라벨 `SCAN_ANIMATION_STAGE_LABELS` (`packages/core-ts/src/scan_option/scan-animation.ts`): 얼굴 감지 → 윤곽 분석 → 피부 영역 추출 → 눈 영역 분석 → 입술 영역 분석 → 컬러 샘플링 → 톤 매칭 → 결과 준비 (`SCAN_ANIMATION_TOTAL_STAGES = 8`)
- **5** `result_reveal.headline` "당신의 카테고리는 ✦ 가을 웜톤 ✦" + `subhead` "어울리는 메이크업·코디 + 맞춤 편집 결과는 다음 단계에서…" (`metadata.teaserCategory: autumn_warm`)
- **6** `social_evolution.subhead` "실제 UGC + 인플루언서 인용 + 12만+ 사용자 진단 누적" (`metadata.userCountClaim: 120000`) + `referral_gate` 친구 추천 코드(`requiredReferrals: 1`)

---

## 사이즈 클래스 ① — 6.7형 (`1290 x 2796`)

| # | 내러티브 위치 | 화면 소스 경로 | 헤드라인 오버레이 | 서브타이틀 오버레이 | 핵심 가치 |
| :-: | --- | --- | --- | --- | --- |
| 1 | `welcome_hook` | `apps/mobile/app/(funnel)/welcome-hook.tsx` | 내 퍼스널 컬러로 셀카가 빛나요 | 1분 진단으로 봄·여름·가을·겨울까지 한 번에 | 1분 퍼스널 컬러 진단 hook |
| 2 | `selfie_capture` | `apps/mobile/app/(funnel)/diagnosis-input.tsx` | 셀카 한 장이면 충분해요 | 정면·자연광·민낯에 가까울수록 더 정확해요 | 셀카 1장 입력의 간편함 |
| 3 | `fake_scan_animation` | `apps/mobile/app/(funnel)/fake-scan-animation.tsx` | AI가 얼굴 24개 포인트를 스캔해요 | 셀카 위에서 스캔 라인이 24개 포인트를 짚어요 | AI 24포인트 얼굴 스캔 |
| 4 | `scan_animation_8stage` | `apps/mobile/app/(funnel)/fake-scan-animation.tsx` | 8단계로 꼼꼼하게 분석해요 | 얼굴 감지부터 톤 매칭까지 단계별로 진행돼요 | 8단계 정밀 스캔 애니메이션 |
| 5 | `result_reveal` | `apps/mobile/app/(funnel)/result-reveal.tsx` | 당신의 카테고리는 가을 웜톤이에요 | 어울리는 메이크업·코디까지 한눈에 확인해요 | 4계절 퍼스널 컬러 결과 |
| 6 | `social_evolution` | `apps/mobile/app/(funnel)/social-evolution.tsx` | 12만 명 넘게 함께하고 있어요 | 실제 후기·인플루언서, 친구 추천으로 이어져요 | 실제 UGC·인플루언서 사회 증명 + 친구 추천 코드 |

- 캡처 해상도: `1290 x 2796` (세로형)
- 안전 영역: 상단 상태바·하단 홈 인디케이터를 오버레이 텍스트가 가리지 않도록 여백 확보
- TODO: 위 6개 화면을 6.7형 시뮬레이터(예: iPhone 15 Pro Max)에서 캡처 → 오버레이 합성 → PNG 6장 저장

---

## 사이즈 클래스 ② — 6.5형 (`1284 x 2778`)

| # | 내러티브 위치 | 화면 소스 경로 | 헤드라인 오버레이 | 서브타이틀 오버레이 | 핵심 가치 |
| :-: | --- | --- | --- | --- | --- |
| 1 | `welcome_hook` | `apps/mobile/app/(funnel)/welcome-hook.tsx` | 내 퍼스널 컬러로 셀카가 빛나요 | 1분 진단으로 봄·여름·가을·겨울까지 한 번에 | 1분 퍼스널 컬러 진단 hook |
| 2 | `selfie_capture` | `apps/mobile/app/(funnel)/diagnosis-input.tsx` | 셀카 한 장이면 충분해요 | 정면·자연광·민낯에 가까울수록 더 정확해요 | 셀카 1장 입력의 간편함 |
| 3 | `fake_scan_animation` | `apps/mobile/app/(funnel)/fake-scan-animation.tsx` | AI가 얼굴 24개 포인트를 스캔해요 | 셀카 위에서 스캔 라인이 24개 포인트를 짚어요 | AI 24포인트 얼굴 스캔 |
| 4 | `scan_animation_8stage` | `apps/mobile/app/(funnel)/fake-scan-animation.tsx` | 8단계로 꼼꼼하게 분석해요 | 얼굴 감지부터 톤 매칭까지 단계별로 진행돼요 | 8단계 정밀 스캔 애니메이션 |
| 5 | `result_reveal` | `apps/mobile/app/(funnel)/result-reveal.tsx` | 당신의 카테고리는 가을 웜톤이에요 | 어울리는 메이크업·코디까지 한눈에 확인해요 | 4계절 퍼스널 컬러 결과 |
| 6 | `social_evolution` | `apps/mobile/app/(funnel)/social-evolution.tsx` | 12만 명 넘게 함께하고 있어요 | 실제 후기·인플루언서, 친구 추천으로 이어져요 | 실제 UGC·인플루언서 사회 증명 + 친구 추천 코드 |

- 캡처 해상도: `1284 x 2778` (세로형)
- 안전 영역: 6.7형과 동일 기준
- TODO: 위 6개 화면을 6.5형 시뮬레이터(예: iPhone 11 Pro Max / Xs Max)에서 캡처 → 오버레이 합성 → PNG 6장 저장

---

## 캡처 가이드 (운영 메모)

1. 퍼널을 `welcome-hook`부터 순서대로 진입해 각 화면에서 캡처해요.
2. 스크린샷 4(8단계 스캔)는 진행 사다리가 보이는 중간 프레임을 캡처해요 (`ScanAnimation` 8단계 컴포넌트).
3. 스크린샷 5는 잠금(`locked: true`) 상태의 "가을 웜톤" 티저 카드 프레임을 캡처해요.
4. 모든 텍스트 오버레이는 해요체로 통일하고, 위 마스터 카피 표를 그대로 써요.
5. 데모/캡처용 셀카는 권리 확보된 이미지만 사용해요. — TODO: 캡처용 모델/셀카 자산 권리 확인.

### TODO (캡처 전 사람이 처리)

- [ ] TODO: 6.7형 6장 캡처 + 오버레이 합성 (PNG)
- [ ] TODO: 6.5형 6장 캡처 + 오버레이 합성 (PNG)
- [ ] TODO: 캡처용 셀카/모델 이미지 사용 권리 확인
- [ ] TODO: 오버레이 폰트·컬러 비주얼 가이드 확정 (본 문서는 카피 전용)
