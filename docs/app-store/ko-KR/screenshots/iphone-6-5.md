# 스크린샷 카피 사양 — iPhone 6.5형 (`1284 x 2778`) · ko-KR

> iOS App Store Connect의 **스크린샷(미리보기)** 슬롯 중 **6.5형(필수)** 사이즈 클래스용 한국어 카피 사양이에요.
> 이 문서는 **카피 전용**이라 오버레이 텍스트와 캡처 대상 화면만 정의해요. 비주얼 디자인·렌더링된 PNG 자산은 캡처 단계(아래 TODO)에서 만들어요.
> 로케일: `ko-KR` · 플랫폼: iOS App Store 전용 · 어조: 해요체 (semi-formal)

---

## 메타데이터

| 항목 | 값 |
| --- | --- |
| file_type | `screenshot_spec` |
| apple_size_class | 6.5형 (필수) |
| 캡처 해상도 | `1284 x 2778` (세로형) |
| 슬롯당 장수 | 6장 |
| 로케일 | ko-KR |
| brand_voice | 해요체 (펀널 화면 카피와 동일 톤) |
| 타깃 사용자 | 20–30대 한국 여성 셀카 사용자 |
| 권장 캡처 기기 | iPhone 11 Pro Max / Xs Max (6.5형 시뮬레이터) |
| 내러티브 출처 | `packages/core-ts/src/funnel/screens.ts` (`FUNNEL_SCREENS`) · `packages/core-ts/src/scan_option/scan-animation.ts` (`SCAN_ANIMATION_STAGE_LABELS`) |

> 오버레이 카피는 6.7형(`screenshots/iphone-6-7.md`)과 **동일**하게 사용해요. 해상도/안전 영역/좌표만 사이즈 클래스별로 달라요.

---

## 내러티브 아크 (퍼널 순서 고정)

스크린샷 6장은 `FUNNEL_SCREENS` 카탈로그의 퍼널 흐름을 그대로 따라가요. 순서는 변경하지 않아요.

```
1. welcome_hook          → 1분 진단 hook 인입 (가치 한눈에)
2. selfie_capture        → 셀카 1장 업로드 (입력 간편함)
3. fake_scan_animation   → AI 24개 포인트 얼굴 스캔 시작
4. scan_animation(8단계) → 8단계 정밀 스캔 진행 (얼굴 감지 → 결과 준비)
5. result_reveal         → 4계절 퍼스널 컬러 결과 (가을 웜톤 티저)
6. social_evolution      → 실제 후기·인플루언서·친구 추천 사회 증명
```

> 스크린샷 3과 4는 같은 화면(`fake-scan-animation.tsx`)에서 **다른 순간**을 캡처해요.
> 3은 스캔 시작(24개 포인트 오버레이) 순간, 4는 8단계 진행 사다리가 보이는 순간이에요.

---

## 마스터 카피 표 — 6.5형 (`1284 x 2778`) · 6장 · 6열

| index | app-screen-source | headline-overlay-ko | subtitle-overlay-ko | value-prop-highlighted | notes |
| :-: | --- | --- | --- | --- | --- |
| 1 | `apps/mobile/app/(funnel)/welcome-hook.tsx` | 내 퍼스널 컬러로 셀카가 빛나요 | 1분 진단으로 봄·여름·가을·겨울까지 한 번에 | 1분 퍼스널 컬러 진단 hook | `welcome_hook` 화면 진입 첫 프레임 캡처. 상단 상태바를 오버레이가 가리지 않게 여백 확보. 출처: `FUNNEL_SCREENS.welcome_hook.headline`("내 퍼스널 컬러로 셀카가 한 장 더 빛나도록") + `subhead`("1분 진단으로 봄·여름·가을·겨울 카테고리…") |
| 2 | `apps/mobile/app/(funnel)/diagnosis-input.tsx` | 셀카 한 장이면 충분해요 | 정면·자연광·민낯에 가까울수록 더 정확해요 | 셀카 1장 입력의 간편함 | 셀카 업로드 입력 화면 캡처. 낮은 진입 장벽을 강조. 출처: `FUNNEL_SCREENS.diagnosis_input.headline`("셀카 1장만 올려주세요") + `subhead`("정면 · 자연광 · 민낯에 가까울수록 결과가 정확해요") |
| 3 | `apps/mobile/app/(funnel)/fake-scan-animation.tsx` | AI가 얼굴 24개 포인트를 스캔해요 | 셀카 위에서 스캔 라인이 24개 포인트를 짚어요 | AI 24포인트 얼굴 스캔 | 스캔 시작 순간(24개 포인트 오버레이가 셀카 위에 뜬 프레임) 캡처. 출처: `FUNNEL_SCREENS.fake_scan_animation.headline`("얼굴 24개 포인트 스캔 중") + `subhead`("셀카 위에서 스캔 라인이 24개 포인트를 짚어내고 있어요"), `metadata.analysisPoints: 24` |
| 4 | `apps/mobile/app/(funnel)/fake-scan-animation.tsx` | 8단계로 꼼꼼하게 분석해요 | 얼굴 감지부터 톤 매칭까지 단계별로 진행돼요 | 8단계 정밀 스캔 애니메이션 | 같은 화면의 8단계 진행 사다리가 보이는 중간 프레임 캡처. 출처: `SCAN_ANIMATION_STAGE_LABELS`(얼굴 감지 → 윤곽 분석 → 피부 영역 추출 → 눈 영역 분석 → 입술 영역 분석 → 컬러 샘플링 → 톤 매칭 → 결과 준비), `SCAN_ANIMATION_TOTAL_STAGES = 8` |
| 5 | `apps/mobile/app/(funnel)/result-reveal.tsx` | 당신의 카테고리는 가을 웜톤이에요 | 어울리는 메이크업·코디까지 한눈에 확인해요 | 4계절 퍼스널 컬러 결과 | 잠금(`locked: true`) 상태의 "가을 웜톤" 티저 카드 프레임 캡처. 출처: `FUNNEL_SCREENS.result_reveal.headline`("당신의 카테고리는 ✦ 가을 웜톤 ✦") + `subhead`("어울리는 메이크업·코디…"), `metadata.teaserCategory: autumn_warm` |
| 6 | `apps/mobile/app/(funnel)/social-evolution.tsx` | 12만 명 넘게 함께하고 있어요 | 실제 후기·인플루언서, 친구 추천으로 이어져요 | 실제 UGC·인플루언서 사회 증명 + 친구 추천 코드 | UGC·인플루언서 인용이 보이는 프레임 캡처. 출처: `FUNNEL_SCREENS.social_evolution.subhead`("실제 UGC + 인플루언서 인용 + 12만+ 사용자 진단 누적"), `metadata.userCountClaim: 120000` + `referral_gate`(친구 추천 코드, `requiredReferrals: 1`) |

### 표 열 설명

| 열 | 의미 |
| --- | --- |
| `index` | 6장 내러티브 아크의 1-based 위치 (screenshot_index) |
| `app-screen-source` | 캡처 대상 펀널 화면 소스 경로 (screen_source_path) |
| `headline-overlay-ko` | 스크린샷에 얹는 한국어 헤드라인 오버레이 (해요체) |
| `subtitle-overlay-ko` | 헤드라인을 받쳐주는 한국어 서브타이틀 오버레이 (해요체) |
| `value-prop-highlighted` | 해당 스크린샷이 강조하는 핵심 가치 제안 (value_prop) |
| `notes` | 캡처 순간·안전 영역·코드베이스 유도 근거 메모 |

---

## 6.5형 오버레이 좌표 (6.7형 대비 조정)

6.5형 캔버스는 `1284 x 2778`로, 6.7형(`1290 x 2796`) 대비 가로 −6px·세로 −18px라서 안전 영역과 오버레이 좌표를 아래처럼 조정해요.
좌표 단위는 픽셀(px), 원점은 좌상단(0,0)이에요. 헤드라인·서브타이틀 오버레이는 6.5형 비율에 맞춰 세로 위치만 미세 축소했어요.

| index | 헤드라인 오버레이 박스 (x, y, w, h) | 서브타이틀 오버레이 박스 (x, y, w, h) | 비고 (6.7형 대비) |
| :-: | --- | --- | --- |
| 1 | `(96, 250, 1092, 300)` | `(96, 560, 1092, 180)` | 6.7형(상단 254 시작) 대비 세로 −4px 상향 |
| 2 | `(96, 250, 1092, 300)` | `(96, 560, 1092, 180)` | 입력 UI가 하단이라 오버레이는 상단 안전 영역 유지 |
| 3 | `(96, 230, 1092, 300)` | `(96, 540, 1092, 180)` | 셀카·스캔 라인을 가리지 않게 상단 배치 |
| 4 | `(96, 230, 1092, 300)` | `(96, 540, 1092, 180)` | 8단계 사다리(중앙~하단)와 겹치지 않게 상단 유지 |
| 5 | `(96, 240, 1092, 300)` | `(96, 560, 1092, 180)` | 티저 카드(중앙) 위 헤드라인, 카드 아래 서브타이틀 |
| 6 | `(96, 230, 1092, 300)` | `(96, 540, 1092, 180)` | UGC 인용 카드 위 여백에 오버레이 배치 |

- 좌우 여백: 각 96px (가로 `1284` 기준 좌우 대칭)
- 상단 안전 영역: 상태바 영역 상단 0–132px 구간에는 오버레이 텍스트를 두지 않아요.
- 하단 안전 영역: 홈 인디케이터 영역 하단 2678–2778px 구간에는 오버레이 텍스트를 두지 않아요.
- 위 좌표는 캡처 합성 시작점(가이드)이고, 최종 픽셀 정렬은 비주얼 가이드 확정(아래 TODO)에서 마무리해요.

---

## 캡처 가이드 (운영 메모)

1. 퍼널을 `welcome-hook`부터 순서대로 진입해 각 화면에서 캡처해요.
2. 스크린샷 3은 스캔 시작(24개 포인트 오버레이) 순간, 4는 8단계 진행 사다리가 보이는 중간 프레임을 캡처해요.
3. 스크린샷 5는 잠금(`locked: true`) 상태의 "가을 웜톤" 티저 카드 프레임을 캡처해요.
4. 모든 텍스트 오버레이는 해요체로 통일하고, 위 마스터 카피 표를 그대로 써요.
5. 안전 영역: 상단 상태바·하단 홈 인디케이터를 오버레이 텍스트가 가리지 않도록 위 6.5형 좌표를 따라요.
6. 데모/캡처용 셀카는 권리 확보된 이미지만 사용해요.

### TODO (캡처 전 사람이 처리 — true 미지수만)

- [ ] **TODO(human)**: 6.5형 6장 캡처 + 오버레이 합성 → PNG 6장 저장 (iPhone 11 Pro Max / Xs Max 시뮬레이터)
- [ ] **TODO(human)**: 캡처용 셀카/모델 이미지 사용 권리 확인
- [ ] **TODO(human)**: 오버레이 폰트·컬러 비주얼 가이드 확정 (본 문서는 카피 전용)

---

## 검수 체크 (이 파일 한정)

- [x] 6열(`index` / `app-screen-source` / `headline-overlay-ko` / `subtitle-overlay-ko` / `value-prop-highlighted` / `notes`) 마크다운 표 6행
- [x] 해상도 `1284 x 2778` (6.5형 필수 사이즈 클래스) 명시
- [x] 6.7형 대비 조정된 오버레이 좌표·안전 영역 표 포함
- [x] 내러티브 아크 퍼널 순서(`FUNNEL_SCREENS`) 고정
- [x] 오버레이 카피는 6.7형과 동일, 임의 창작 없이 코드베이스 유도
- [x] 8단계 라벨은 `SCAN_ANIMATION_STAGE_LABELS` 그대로 재사용
- [x] TODO는 캡처·권리·비주얼 등 true 미지수에만 한정
- [x] ko-KR 단일 로케일, iOS 전용, 코드/테스트 변경 없음
