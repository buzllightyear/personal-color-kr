# App 심사 정보 (App Review Information) — ko-KR

> iOS App Store Connect의 **App 심사 정보(App Review Information)** 에 입력할 심사자 메모예요.
> App Store 심사자(영문)가 앱 전체 흐름을 막힘 없이 확인할 수 있도록, 데모 계정·테스트 동선·결제/권한/심사 주의 사항을 정리했어요.
> 로케일: `ko-KR` · 플랫폼: iOS App Store 전용

---

## 메타데이터

| 항목 | 값 |
| --- | --- |
| `file_path` | docs/app-store/ko-KR/app-review-info.md |
| `file_type` | review_template |
| `locale` | ko-KR |
| `brand_voice` | 해요체 (semi-formal) |
| `char_limit` | 해당 없음 — App 심사 정보 메모 필드는 Apple이 별도 글자 수 제한을 강제하지 않아요 |
| 포함 섹션 | 데모 계정 · 연락처 · 테스트 동선 가이드 · 결제/구독 · 권한 · 심사 주의 사항 · TODO |

> 아래 **App Store Connect 입력용** 블록의 영문 메모를 "심사 정보 → 비고(Notes)" 필드에 그대로 붙여넣어요.
> 심사자는 영문을 읽으므로 제출용 메모는 영문으로 작성했고, 코드 블록 바깥의 한국어 표·설명은 우리 팀 내부 검수용이에요.

---

## 데모 계정 (Demo Account)

이 앱은 **Sign in with Apple(Apple로 로그인)** 을 인증 수단으로 사용해요. 심사자가 실제 Apple ID로 로그인하기 어려운 흐름(또는 로그인 없이 접근이 막히는 화면)이 있으므로, **데모 계정을 제공**하는 걸 원칙으로 해요.

| 항목 | 키 | 값 |
| --- | --- | --- |
| 데모 계정 필요 여부 | `demo-account-required` | **예 (Yes)** — 로그인 게이트가 있는 화면 검증에 필요 |
| 데모 계정 아이디 | `demo-account-username` | **TODO** |
| 데모 계정 비밀번호 | `demo-account-password` | **TODO** |
| 로그인 방식 메모 | `demo-account-notes` | **TODO** (Apple Sign In 우회용 테스트 자격증명 발급 방식 확정 필요) |

- [ ] **TODO**: Apple Sign In 환경에서 심사자가 사용할 **데모 계정 자격증명**을 발급하고 위 표에 기입 (백엔드 인증 연동 완료 후 — 진짜 미지값)
- [ ] **TODO**: 데모 계정이 **유료 기능(결제 잠금 해제 후 화면)** 까지 미리 열려 있도록 구성할지 결정. 심사자가 결제 없이도 잠금 해제 후 화면을 확인할 수 있게 해두면 심사가 매끄러워요.

> 데모 계정 자격증명은 코드베이스에서 도출할 수 없는 **진짜 미지값**이라 `TODO`로 남겼어요. 임의의 placeholder를 publish-ready 값처럼 적지 않아요. (`urls.md`·`app.json`의 TODO 원칙과 동일)

---

## 심사 연락처 (Contact Information)

| 항목 | 키 | 값 |
| --- | --- | --- |
| 담당자 이름 | `contact-first-name` / `contact-last-name` | **TODO** |
| 연락처 전화번호 | `contact-phone` | **TODO** |
| 연락처 이메일 | `contact-email` | **TODO** (지원 채널과 동기화 — `urls.md`의 `support-url` 참고) |

- [ ] **TODO**: 심사 중 Apple이 연락할 담당자 정보(이름·전화·이메일)를 기입 (Apple Developer 계정·운영 담당 확정 필요)

---

## 테스트 동선 가이드 (Test Flow Guide)

이 앱의 핵심 흐름은 **셀카 1장 → 퍼스널 컬러 진단 → 결과/맞춤 편집** 으로 이어지는 12단계 온보딩 깔때기예요.
화면 순서는 코드베이스의 `FUNNEL_STEPS_ORDERED`(`packages/core-ts/src/funnel/types.ts`)에서 그대로 도출했어요. 심사자는 아래 순서대로 진행하면 전체 기능을 빠짐없이 확인할 수 있어요.

| 단계 | 화면 (funnel step) | 심사자가 보게 되는 것 | 진행 방법 |
| --- | --- | --- | --- |
| 1 | `welcome_hook` (welcome-hook) | 퍼스널 컬러 진단 소개 hook | "시작" CTA를 눌러 다음으로 진행해요 |
| 2 | `value_props` (value-props) | 트렌드 맞춤 편집·매월 큐레이션 가치 제안 | 다음 버튼으로 진행해요 |
| 3 | `onboarding_priming` (onboarding-priming) | 진단 시작 전 priming 안내 | 다음 버튼으로 진행해요 |
| 4 | `rating_gate` (rating-gate) | iOS 네이티브 별점 요청 시트(모달, 건너뛰기 가능) | 별점 없이 시트를 닫으면(dismiss) 다음 단계로 이어져요 |
| 5 | `fake_loader` (fake-loader) | "분석 준비 중" 로딩 연출(약 5초) | 자동으로 다음 화면으로 넘어가요 |
| 6 | `scan_option_select` (scan-option-select) | 3개 스캔 옵션 중 **퍼스널 컬러** 선택 | "퍼스널 컬러" 옵션을 선택해요 |
| 7 | `diagnosis_input` (diagnosis-input) | **셀카 1장 업로드/촬영**(정면·자연광·민낯 권장) | 카메라/사진 권한을 허용하고 셀카 1장을 올려요 |
| 8 | `fake_scan_animation` (fake-scan-animation) | 셀카 위 24개 포인트 얼굴 스캔 애니메이션(8단계, 약 3.2초) | 자동으로 진행돼요. 스캔 단계 라벨: 얼굴 감지 → 윤곽 분석 → 피부 영역 추출 → 눈 영역 분석 → 입술 영역 분석 → 컬러 샘플링 → 톤 매칭 → 결과 준비 |
| 9 | `result_reveal` (result-reveal) | 진단 결과 일부 공개(잠금) + 어울리는 메이크업·코디 안내 | 결과 일부가 보이고, 전체 잠금 해제는 다음 단계로 유도돼요 |
| 10 | `referral_gate` (referral-gate) | 친구 1명 추천(추천 코드) 게이트 | 추천을 건너뛰거나 진행해요. 추천 딥링크 형식은 `/r/<code>` 예요 |
| 11 | `social_evolution` (social-evolution) | 사용자 후기(UGC)·인용 등 사회적 증거 | 다음 버튼으로 진행해요 |
| 12 | `payment_model` (payment-model) | 구독 결제 모델 안내 + 결제하고 잠금 해제 / "나중에 할게요" | 결제 또는 건너뛰기로 결과 화면에 도달해요 |

### 빠른 확인 동선 (요약)

1. 앱 실행 → 1~6단계는 안내/연출이라 다음 버튼으로 빠르게 진행해요.
2. 7단계에서 **카메라 또는 사진 라이브러리 권한**을 허용하고 셀카 1장을 올려요. (권한을 거부해도 앱이 비정상 종료되지 않도록 설계돼 있어요.)
3. 8단계 스캔 애니메이션은 자동 진행되고, 9단계에서 진단 결과 일부가 공개돼요.
4. 12단계에서 **"나중에 할게요"** 를 누르면 결제 없이도 결과 화면(잠금 상태)으로 이동해 흐름을 끝까지 확인할 수 있어요.

---

## 결제·구독 안내 (In-App Purchase / Subscription)

- 이 앱은 **Superwall 페이월**을 통해 자동 갱신 구독을 제공해요. (12단계 `payment_model`)
- 구독 옵션: **월 구독 / 연 구독** 2종이며, 연 구독에는 무료 체험 기간이 포함돼요. (정확한 가격·체험 기간은 App Store Connect의 구독 상품 설정 값을 따라요.)
- **샌드박스 결제**: 심사자는 Apple 제공 샌드박스 테스터 계정으로 결제 흐름을 테스트할 수 있어요. 실제 과금은 발생하지 않아요.
- 결제를 완료하지 않아도 **"나중에 할게요"** 소프트 게이트로 결과 화면까지 진행할 수 있어, 결제 없이도 앱의 핵심 흐름 검증이 가능해요.
- 결제 연결 실패 시 인라인 한국어 오류 문구("결제 연결에 실패했어요. 잠시 후 다시 시도해 주세요.")가 노출돼요. 앱이 중단되지 않아요.

- [ ] **TODO**: App Store Connect에 **자동 갱신 구독 상품(월/연)** 을 등록하고 샌드박스에서 결제 흐름이 정상 동작하는지 확인 (Apple Developer · 상품 설정 필요)
- [ ] **TODO**: 구독 약관·자동 갱신 안내 문구 및 개인정보 처리방침 링크가 페이월/메타데이터에 연결됐는지 확인 (`urls.md` 동기화)

---

## 권한 사용 목적 (Permissions)

| 권한 | 사용 시점 | 사용 목적 (심사자 설명용) |
| --- | --- | --- |
| 카메라 (Camera) | 7단계 `diagnosis_input` | 퍼스널 컬러 진단을 위한 셀카 1장 촬영 |
| 사진 라이브러리 (Photo Library) | 7단계 `diagnosis_input` | 기존 셀카 1장을 선택해 진단에 사용 |

- 올려주신 셀카는 **퍼스널 컬러 진단 목적**으로만 사용해요. 데이터 처리 방침은 개인정보 처리방침에서 확인할 수 있어요(`urls.md`의 `privacy-policy-url`).
- [ ] **TODO**: `app.json`의 `infoPlist` 권한 사용 설명 문자열(`NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`)이 위 목적과 일치하는지 확인 (app.json 담당 항목과 동기화)

---

## 심사 주의 사항 (Notes for the Reviewer)

- **스캔 애니메이션은 시각 연출이에요.** 8단계 `fake_scan_animation`은 진단 진행 과정을 보여주는 UX 애니메이션이며, 사용자에게 의료·진단적 정확성을 보장하는 화면이 아니에요. 퍼스널 컬러 결과는 참고용 뷰티/스타일 가이드예요.
- **Sign in with Apple** 을 인증 수단으로 제공해요. 제3자 로그인을 추가로 붙일 경우에도 Apple 로그인 옵션을 함께 제공하는 App Store 가이드라인을 준수해요.
- **오류 추적(Sentry)** 을 사용해 비정상 종료·오류 진단 데이터를 수집해요. 개인 식별 정보는 개인정보 처리방침 범위 내에서만 처리해요.
- **연령 등급**: 본 앱은 17+ 로 분류했어요. 상세 근거는 `age-rating.md`를 참고해 주세요.
- **카테고리**: 기본 라이프스타일(Lifestyle) / 보조 사진 및 비디오(Photo & Video). 상세는 `categories.md` 참고예요.

---

## App Store Connect 입력용 (심사자 메모 · 영문)

> 아래 블록을 App Store Connect "App 심사 정보 → 비고(Notes)" 필드에 붙여넣어요. `[TODO: ...]` 부분은 제출 전에 실제 값으로 교체해야 해요.

```text
DEMO ACCOUNT
- Sign in with Apple is the primary authentication method.
- A demo account is provided so the reviewer can pass the login gate without a personal Apple ID.
  Username: [TODO: demo account username]
  Password: [TODO: demo account password]
  Notes:    [TODO: how to use the demo credentials with the Apple Sign In bypass]

TEST FLOW (12-step onboarding funnel)
1. welcome-hook — intro hook; tap the start CTA.
2. value-props — value proposition; tap next.
3. onboarding-priming — pre-diagnosis priming; tap next.
4. rating-gate — native iOS rating sheet (modal, dismissable). Dismiss it to continue.
5. fake-loader — ~5s "preparing analysis" loader; auto-advances.
6. scan-option-select — choose the "Personal Color" option.
7. diagnosis-input — grant Camera or Photo Library permission and upload ONE selfie
   (front-facing, natural light, minimal makeup recommended).
8. fake-scan-animation — ~3.2s 8-stage face-scan overlay (24 points); auto-advances.
9. result-reveal — partial (locked) diagnosis result + makeup/style guidance.
10. referral-gate — 1-friend referral code gate (deep link form: /r/<code>); can be skipped.
11. social-evolution — UGC / social proof; tap next.
12. payment-model — subscription paywall (Superwall). Monthly / yearly auto-renewable
    subscription; yearly includes a free trial. Use an Apple sandbox tester to test purchase
    (no real charge). Tapping "나중에 할게요" (skip) reaches the result screen WITHOUT payment,
    so the full flow can be verified without buying.

PAYMENTS
- Auto-renewable subscriptions via Superwall + StoreKit. Test with a sandbox tester account.
- The flow is fully reachable without purchasing (soft-gate skip on step 12).

PERMISSIONS
- Camera & Photo Library: used only on step 7 to capture/select one selfie for the
  personal-color diagnosis. Denying permission does not crash the app.

NOTES
- The 8-stage scan animation (step 8) is a visual UX effect, not a medical/diagnostic claim.
  Results are a reference beauty/style guide.
- Sign in with Apple is offered. Crash/error diagnostics via Sentry.
- Age rating: 17+. Privacy policy & support URLs: [TODO: see urls.md once finalized].

CONTACT
- Name:  [TODO: contact name]
- Phone: [TODO: contact phone]
- Email: [TODO: contact email]
```

---

## 근거 (codebase derivation)

모든 동선·기능 설명은 기존 코드베이스에서 도출했어요(임의 창작 아님).

| 메모 요소 | 출처 |
| --- | --- |
| 12단계 순서·각 단계 식별자 | `packages/core-ts/src/funnel/types.ts` `FUNNEL_STEPS_ORDERED` |
| 8단계 스캔 라벨(얼굴 감지 … 결과 준비) | `packages/core-ts/src/scan_option/scan-animation.ts` `SCAN_ANIMATION_STAGE_LABELS` |
| 셀카 1장 업로드(정면·자연광·민낯) | `app/(funnel)/diagnosis-input.tsx` · `FUNNEL_SCREENS.diagnosis_input` |
| 24개 포인트 얼굴 스캔 오버레이 | `app/(funnel)/fake-scan-animation.tsx` · `FUNNEL_SCREENS.fake_scan_animation` |
| rating-gate 모달·dismiss 동작 | `app/(funnel)/_layout.tsx` (presentation: 'modal') · `_guards.ts` `shouldDismissRating` |
| Superwall 구독·"나중에 할게요" 소프트 게이트·인라인 오류 문구 | `app/(funnel)/payment-model.tsx` |
| 친구 추천 코드 `/r/<code>` 딥링크 | `_guards.ts` `shouldBypassReferral` 주석 (referral 딥링크) |
| Apple Sign In 인증 · Sentry 오류 추적 | Seed 도메인 컨텍스트(인증 방식·오류 추적 의존성) |
| 카메라·사진 권한 목적 | `FUNNEL_SCREENS.diagnosis_input` requiredInputs `['selfie_image']` |

---

## 어조 검증 (해요체)

- 모든 한국어 설명은 해요체로 작성했어요(`~확인할 수 있어요`, `~진행해요`, `~참고해 주세요`). ✅
- 반말(예: `진행해`) 아님 ✅ · 존댓말(예: `진행합니다`) 아님 ✅
- 기존 메타데이터 문서(`description.md`, `categories.md`, `urls.md`)와 동일한 해요체 레지스터 유지 ✅
- App Store Connect 제출용 블록만 심사자(영문 사용)를 위해 영문으로 작성했어요.

---

## TODO 요약 (제출 전 사람 확인 필요)

- [ ] **TODO**: 데모 계정 아이디/비밀번호 발급 후 기입 (Apple Sign In 우회 자격증명 — 진짜 미지값)
- [ ] **TODO**: 데모 계정이 유료 잠금 해제 후 화면까지 열려 있도록 구성할지 결정
- [ ] **TODO**: 심사 연락처(이름·전화·이메일) 기입 (운영 담당 확정 필요)
- [ ] **TODO**: 자동 갱신 구독 상품(월/연) 등록 + 샌드박스 결제 흐름 확인 (Apple Developer 설정 필요)
- [ ] **TODO**: 권한 사용 설명 문자열(`NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`)이 목적과 일치하는지 `app.json`과 동기화
- [ ] **TODO**: 개인정보 처리방침/지원 URL 확정 후 심사 메모의 `[TODO: ...]` 링크 교체 (`urls.md` 동기화)

> 위 TODO는 모두 Apple Developer 자격증명·운영 인프라·법무 문서가 확정되어야 해소돼요. README `검수 체크리스트`의 데모 계정 / Apple Developer 설정 / 법무 검토 항목과 연동돼요.
