# App Store 메타데이터 — ko-KR (퍼스널 컬러 진단 앱)

> iOS App Store 한국 출시를 위한 **한국어(ko-KR) 메타데이터·스크린샷 카피·심사 자료** 모음이에요.
> 모든 카피는 **해요체(semi-formal)** 로 통일했고, 가치 제안은 코드베이스(`FUNNEL_SCREENS` 등)에서 도출했어요.
> 로케일: `ko-KR` 전용 · 플랫폼: iOS App Store 전용 (Android Play Store 미포함)

---

## 디렉터리 구성 (13개 마크다운 + app.json)

| # | 파일 | 내용 | Apple 문자 제한 |
| :-: | --- | --- | --- |
| 1 | [`README.md`](./README.md) | 인덱스 + 검수 체크리스트 (이 문서) | — |
| 2 | [`title.md`](./title.md) | App 이름 (현지화) | 30자 |
| 3 | [`subtitle.md`](./subtitle.md) | 부제 (Subtitle) | 30자 |
| 4 | [`description.md`](./description.md) | 설명 (Description) | 4000자 |
| 5 | [`keywords.md`](./keywords.md) | ASO 키워드 + 보강 권장 | 100자 |
| 6 | [`promotional-text.md`](./promotional-text.md) | 프로모션 텍스트 | 170자 |
| 7 | [`whats-new.md`](./whats-new.md) | 새로운 기능 (0.1.0) | 4000자 |
| 8 | [`categories.md`](./categories.md) | 기본/보조 카테고리 | — |
| 9 | [`age-rating.md`](./age-rating.md) | 연령 등급 설문 (17+) | — |
| 10 | [`urls.md`](./urls.md) | 개인정보·지원·마케팅 URL | — |
| 11 | [`app-review-info.md`](./app-review-info.md) | 심사용 메모·데모 계정 | — |
| 12 | [`reviews/response-templates.md`](./reviews/response-templates.md) | 리뷰 응답 템플릿 4종 | — |
| 13 | [`screenshots/specs.md`](./screenshots/specs.md) | 스크린샷 6장 카피 사양 (6.7형·6.5형) | — |
| — | `apps/mobile/app.json` | Expo iOS 제출 필드 보강 | — |

---

## 내러티브 아크 (스크린샷 순서)

스크린샷은 `FUNNEL_SCREENS` 퍼널 흐름을 그대로 따라요:

`welcome_hook → selfie_capture → fake_scan_animation → scan_animation(8단계) → result_reveal → social_evolution`

자세한 카피·캡처 사양은 [`screenshots/specs.md`](./screenshots/specs.md) 를 참고해요.

---

## 어조·표기 원칙

- **해요체** 로 전체 통일 (반말 ✗, 과도한 존댓말/하십시오체 ✗).
- 가치 제안은 코드베이스(`FUNNEL_SCREENS`, 8단계 스캔 라벨) 도출 — 임의 창작 ✗.
- 타깃: **20–30대 한국 여성 셀카 사용자** — 친근한 큐레이션 보이스.
- 진짜 미정값(URL·법무 문구·연령 등급 확정·Apple 자격증명·데모 계정)만 `TODO` 로 표기, 그 외는 출고 가능 상태.

---

## App Store Connect 제출 체크리스트 (검수 — 제출 전 사람 승인 게이트)

아래 **9개 사인오프 항목**은 App Store Connect 제출 전에 **사람이 직접 확인하고 서명**해야 해요. 각 줄을 모두 체크해 주세요.

- [ ] **1. 원어민 카피 검수** — 13개 파일 전체의 해요체 일관성·맞춤법·자연스러움을 한국어 원어민이 검수했어요. (담당/일자: ___)
- [ ] **2. 법무 검토** — 개인정보처리방침·이용약관·"AI 분석"·결제 고지 문구를 법무가 검토했어요. (담당/일자: ___)
- [ ] **3. Apple Developer 설정** — `appleTeamId`·`bundleIdentifier` 확정, App Store Connect 앱 레코드 생성, 인증서/프로비저닝 완료했어요. (담당/일자: ___)
- [ ] **4. 데모 계정 준비** — Apple 심사용 데모 계정·비밀번호를 발급하고 `app-review-info.md` TODO 를 실제 값으로 채웠어요. (담당/일자: ___)
- [ ] **5. 연령 등급 확정** — `age-rating.md` 17+ 설문 답변을 App Store Connect 설문과 대조해 확정했어요. (담당/일자: ___)
- [ ] **6. 스크린샷 캡처** — 6.7형·6.5형 각각 6장(총 12장)을 퍼널 순서대로 캡처·합성하고 오버레이 카피를 적용했어요. (담당/일자: ___)
- [ ] **7. ASO 카테고리 확정** — 기본(Lifestyle)·보조 카테고리와 100자 키워드를 App Store Connect에 입력·확정했어요. (담당/일자: ___)
- [ ] **8. 리뷰 응답 SOP** — `reviews/response-templates.md` 4종(positive·negative-bug·negative-feature·neutral) 운영 담당자와 응답 SLA를 지정했어요. (담당/일자: ___)
- [ ] **9. 최종 문자 수 검수 + 빌드 업로드** — 전 필드 Apple 문자 제한 재확인, `usesNonExemptEncryption` 등 `app.json` 필드 점검, 심사 빌드 업로드를 완료했어요. (담당/일자: ___)

---

## 참고 (출처 코드)

- 퍼널 화면 카탈로그: `packages/core-ts/src/funnel/screens.ts` (`FUNNEL_SCREENS`)
- 8단계 스캔 라벨: `packages/core-ts/src/scan_option/scan-animation.ts` (`SCAN_ANIMATION_STAGE_LABELS`)
- 5단계 Analyzing 로더: `packages/core-ts/src/funnel/analyzing-loader.ts`
- Expo 설정: `apps/mobile/app.json`
