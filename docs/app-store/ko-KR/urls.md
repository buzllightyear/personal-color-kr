# 앱 URL 정보 (URLs) — ko-KR

> iOS App Store Connect의 **App 정보 / 버전 정보**에 입력할 URL 항목이에요.
> 로케일: `ko-KR` · 플랫폼: iOS App Store 전용
> 이 3개 URL은 모두 **실제 운영 URL이 확정되지 않은 상태**라서 제출 전 사람이 채워야 하는 진짜 미지값(TODO)이에요.

---

## 메타데이터

| 항목 | 값 |
| --- | --- |
| 로케일 | ko-KR |
| 플랫폼 | iOS App Store 전용 |
| URL 항목 수 | 3 (개인정보 처리방침 · 지원 · 마케팅) |
| 상태 | 전부 **TODO** (운영 URL 미확정) |

---

## URL 목록

| App Store Connect 필드 | 키 | 필수 여부 | 값 |
| --- | --- | --- | --- |
| 개인정보 처리방침 URL (Privacy Policy URL) | `privacy-policy-url` | **필수** (앱 심사 차단 항목) | **TODO** |
| 지원 URL (Support URL) | `support-url` | **필수** (앱 심사 차단 항목) | **TODO** |
| 마케팅 URL (Marketing URL) | `marketing-url` | 선택 (Optional) | **TODO** |

---

## 항목별 상세

### 1. 개인정보 처리방침 URL (`privacy-policy-url`)

```
privacy-policy-url: TODO
```

- **필드 위치**: App Store Connect → App 정보 → 개인정보 처리방침 URL
- **필수 여부**: 필수 — 미입력 시 앱 심사가 차단돼요.
- **요구 조건**: 앱이 수집하는 데이터(셀카 이미지, Apple 로그인 식별자, Sentry 오류 진단 데이터 등)와 처리 방침을 명시한 공개 페이지여야 해요.
- [ ] **TODO**: 운영 도메인에 개인정보 처리방침 페이지를 게시하고 최종 URL을 여기에 기입 (법무 검토 + 운영 도메인 확정 필요)

### 2. 지원 URL (`support-url`)

```
support-url: TODO
```

- **필드 위치**: App Store Connect → 버전 정보 → 지원 URL
- **필수 여부**: 필수 — 미입력 시 앱 심사가 차단돼요.
- **요구 조건**: 사용자가 문의·고객지원을 받을 수 있는 공개 페이지(FAQ, 문의 폼, 이메일 안내 등)여야 해요.
- [ ] **TODO**: 지원/문의 페이지를 게시하고 최종 URL을 여기에 기입 (운영 도메인 또는 고객지원 채널 확정 필요)

### 3. 마케팅 URL (`marketing-url`)

```
marketing-url: TODO
```

- **필드 위치**: App Store Connect → 버전 정보 → 마케팅 URL
- **필수 여부**: 선택 — 비워둘 수 있지만, 앱 소개 랜딩 페이지가 있으면 ASO에 도움이 돼요.
- **요구 조건**: 앱을 소개하는 마케팅/랜딩 페이지여야 해요.
- [ ] **TODO**: 마케팅 랜딩 페이지를 게시하고 최종 URL을 여기에 기입하거나, 운영하지 않으면 이 항목은 빈 값으로 제출 (운영 도메인 확정 필요)

---

## 작성 원칙 (왜 전부 TODO인가)

이 3개 URL은 모두 **운영 도메인·법무 문서·고객지원 채널이 확정되어야 채울 수 있는 진짜 미지값**이에요.
코드베이스나 카피에서 도출할 수 있는 값이 아니므로, 임의의 placeholder를 publish-ready 값처럼 적지 않고 명시적으로 `TODO`로 표기했어요.

> 이 원칙은 다른 메타데이터 파일(`app-review-info.md`의 데모 계정, `app.json`의 Apple Team ID 등)에서 URL/자격증명/법무 미지값만 TODO로 남기는 규칙과 동일해요.

---

## TODO 요약 (제출 전 사람 확인 필요)

- [ ] **TODO**: `privacy-policy-url` — 개인정보 처리방침 페이지 게시 후 최종 URL 기입 (법무 검토 필요)
- [ ] **TODO**: `support-url` — 지원/문의 페이지 게시 후 최종 URL 기입
- [ ] **TODO**: `marketing-url` — 마케팅 랜딩 페이지 게시 후 최종 URL 기입 (선택, 없으면 빈 값 제출)

> 위 3개 TODO는 모두 운영 인프라·법무 문서가 확정되어야 해소돼요. README `검수 체크리스트`의 법무 검토 / Apple Developer 설정 항목과 연동돼요.
