# TestFlight 업로드 드라이런 (Dry-Run Runbook) — Phase 7.3

> personal-color-kr iOS 앱을 **TestFlight 베타**에 올리기까지의 정확한 명령어 순서를 정리한 런북이에요.
> Sentry 네이티브 크래시 심볼리케이션과 EAS 프로덕션 제출(submit)을 **하나의 원자적 빌드 게이트**로 묶어서 다뤄요.
> 로케일: `ko-KR` · 어조: 해요체 · 대상: 실제 자격증명을 가진 사람이 코드 변경 없이 그대로 따라 할 수 있도록 작성했어요.

---

## ⚠️ 시작 전 안내

- 이 문서는 **드라이런(dry-run) 런북**이에요. 명령어 순서와 사전 조건을 검증하기 위한 문서이며, **CI에서 실제 `eas build`·`eas submit`을 실행하지 않아요.** 실제 빌드/제출은 자격증명이 모두 채워진 뒤 **사람이 로컬 또는 EAS 클라우드에서 직접** 실행해요.
- 모든 민감값(`SENTRY_DSN_MOBILE`, `SENTRY_AUTH_TOKEN`)은 **EAS Secrets로만** 주입해요. **절대 레포에 커밋하지 않아요.**
- App Store Connect API 키(`credentials/asc-api-key.p8`)와 `credentials/` 디렉터리는 `.gitignore`로 제외돼 있어요. `.p8` 파일을 커밋하지 않아요.
- 아래 `TODO_...` placeholder는 **진짜 미지값**이에요. Apple Developer · Sentry 조직이 확정되어야 채울 수 있어요. **임의의 값을 publish-ready 값처럼 적지 않아요.**

---

## 0단계 — 사전 준비 (Prerequisites)

### 0.1 도구 설치 확인

```bash
# EAS CLI (apps/mobile에 devDependency로 고정돼 있어요 — eas-cli ^12.0.0)
eas --version

# Expo 계정 로그인 (한 번만)
eas login

# 현재 로그인 계정 확인
eas whoami
```

### 0.2 작업 디렉터리

모든 `eas` 명령은 **`apps/mobile/`** 에서 실행해요 (`eas.json`·`app.config.ts`가 이 디렉터리에 있어요).

```bash
cd apps/mobile
```

### 0.3 채워야 할 placeholder 목록

| placeholder | 위치 | 출처 (사람이 확정) |
| --- | --- | --- |
| `TODO_SENTRY_ORG_SLUG` | `app.config.ts` (`SENTRY_ORG_SLUG`) | Sentry 조직 프로비저닝 후 |
| `pck-mobile` | `app.config.ts` (`SENTRY_PROJECT_SLUG`) | 이미 확정 — 모바일 전용 프로젝트 슬러그 (수정 불필요) |
| `TODO_ASC_API_KEY_ID` | `eas.json` (`submit.production.ios.ascApiKeyId`) | App Store Connect → 사용자 및 액세스 → 통합(Integrations) |
| `TODO_ASC_API_KEY_ISSUER_ID` | `eas.json` (`submit.production.ios.ascApiKeyIssuerId`) | 동일 화면의 Issuer ID |
| `TODO_APPLE_TEAM_ID` | `eas.json` (`submit.production.ios.appleTeamId`) | Apple Developer → Membership → Team ID |
| `credentials/asc-api-key.p8` | 파일 자체 | ASC API 키 발급 시 1회만 다운로드되는 `.p8` 파일을 이 경로에 저장 |

> ASC API 키 발급·다운로드 절차와 3종 ID의 의미는 `apps/mobile/credentials/README.md`를 참고해요.

---

## 1단계 — EAS Secrets 생성 (`eas secret:create`)

Sentry DSN과 Auth Token을 **EAS Secrets**로 등록해요. 이 두 값은 4개 빌드 프로파일 전체(`development-simulator`·`development`·`preview`·`production`)에서 공유돼요.

### 1.1 `SENTRY_DSN_MOBILE` — Sentry DSN

런타임 Sentry 초기화와 네이티브 심볼리케이션 플러그인이 모두 이 값을 읽어요. `production` 프로파일에서 이 값이 없으면 `app.config.ts`의 빌드 타임 가드가 **빌드를 실패(fail-fast)** 시켜요.

```bash
eas secret:create \
  --scope project \
  --name SENTRY_DSN_MOBILE \
  --value "https://<공개키>@<org>.ingest.sentry.io/<project-id>" \
  --type string
```

- `--value` 의 DSN은 Sentry → `pck-mobile` 프로젝트 → Settings → Client Keys (DSN)에서 가져와요.
- DSN은 공개 키라 노출돼도 비교적 안전하지만, **레포 커밋은 하지 않고** EAS Secret으로만 주입하는 게 api(`SENTRY_DSN_API`)와 동일한 원칙이에요.

### 1.2 `SENTRY_AUTH_TOKEN` — 소스맵·dSYM 업로드 토큰

빌드 타임에 JS 소스맵과 iOS dSYM을 Sentry로 업로드해 네이티브 스택 트레이스를 심볼리케이션하는 데 쓰여요. **`Releases` + `Builds` 권한**으로만 스코프해요(최소 권한).

```bash
eas secret:create \
  --scope project \
  --name SENTRY_AUTH_TOKEN \
  --value "<sntrys_...>" \
  --type string
```

- 토큰은 Sentry → Settings → Auth Tokens 에서 `Releases`·`Builds` 권한만 부여해 발급해요.
- 이 토큰은 **민감값**이에요. 절대 레포·로그·PR에 노출하지 않아요.
- 토큰이 **없으면** Sentry 플러그인이 업로드 단계를 **no-op** 으로 건너뛰어요. 그래서 토큰이 없는 개발자의 로컬 `expo prebuild`는 실패하지 않아요. (업로드는 `SENTRY_AUTH_TOKEN` 존재 여부로 가드돼요.)

### 1.3 등록 확인

```bash
# 등록된 시크릿 목록 확인 (값은 표시되지 않아요)
eas secret:list
```

`SENTRY_DSN_MOBILE` 과 `SENTRY_AUTH_TOKEN` 두 개가 보이면 돼요.

---

## 2단계 — placeholder 치환 (코드 변경 아님, 값만 교체)

> 이 단계는 **소스 로직 변경이 아니라** 자격증명 placeholder를 실제 값으로 바꾸는 작업이에요. 사람이 실제 값을 확보한 뒤에만 가능해요.

1. **Sentry 조직 슬러그** — `apps/mobile/app.config.ts`의 `SENTRY_ORG_SLUG` 값 `'TODO_SENTRY_ORG_SLUG'` 를 실제 조직 슬러그로 교체해요.
   - ⚠️ 주의: `SENTRY_AUTH_TOKEN` 이 있는데 슬러그가 아직 `TODO_...` 면 빌드 타임 드리프트 가드가 이를 감지해요. 토큰을 등록하기 **전에** 슬러그부터 확정하거나, 둘을 같은 시점에 맞춰요.
2. **ASC API 키 파일** — 발급받은 `.p8` 파일을 `apps/mobile/credentials/asc-api-key.p8` 경로에 그대로 저장해요. (`eas.json`의 `submit.production.ios.ascApiKeyPath`가 이 경로를 가리켜요. `.gitignore`로 제외돼 커밋되지 않아요.)
3. **ASC ID 3종** — `apps/mobile/eas.json`의 아래 값을 실제 값으로 교체해요.
   - `ascApiKeyId`: `TODO_ASC_API_KEY_ID` → 실제 Key ID
   - `ascApiKeyIssuerId`: `TODO_ASC_API_KEY_ISSUER_ID` → 실제 Issuer ID
   - `appleTeamId`: `TODO_APPLE_TEAM_ID` → 실제 Team ID

---

## 3단계 — 프로덕션 빌드 (`eas build`)

`production` 프로파일은 `autoIncrement: true` 라서 빌드 번호가 자동으로 1씩 올라가요. iOS 한정으로 빌드해요.

```bash
eas build \
  --profile production \
  --platform ios
```

빌드가 진행되는 동안 일어나는 일:

1. `app.config.ts`가 평가되면서 `EAS_BUILD=true`·`EAS_BUILD_PROFILE=production`이 주입돼요.
2. **빌드 타임 가드** — `production` 프로파일인데 `SENTRY_DSN_MOBILE`이 비어 있으면 여기서 **즉시 실패**해요(크래시 관측 없는 깜깜이 TestFlight 바이너리 방지). 1단계에서 시크릿을 먼저 등록한 이유예요.
3. Sentry Expo 플러그인(`@sentry/react-native/expo`)이 네이티브 프로젝트에 Sentry SDK와 소스맵/dSYM 업로드 빌드 페이즈를 주입해요.
4. `SENTRY_AUTH_TOKEN`이 있으면 소스맵·dSYM이 `pck-mobile` 프로젝트로 업로드돼 네이티브 크래시가 서버에서 심볼리케이션돼요.
5. Sentry `environment` 태그는 빌드 프로파일에서 파생돼 `production`으로 찍혀요. (tracesSampleRate `0.1`, errorSampleRate `1.0`)

> CI 메모: 위 명령은 **사람이 직접** 실행해요. CI 파이프라인에서 `eas build`를 호출하지 않아요(Seed 제약).

빌드 완료 후 EAS가 출력한 빌드 URL/ID를 확인해 둬요. 다음 단계에서 이 빌드를 제출해요.

---

## 4단계 — TestFlight 제출 (`eas submit`)

`eas.json`의 `submit.production.ios` 블록 설정을 사용해 방금 만든 빌드를 App Store Connect(TestFlight)로 업로드해요.

```bash
# 가장 최근 production 빌드를 자동 선택해 제출
eas submit \
  --profile production \
  --platform ios \
  --latest
```

또는 특정 빌드를 지정해서 제출할 수 있어요:

```bash
eas submit \
  --profile production \
  --platform ios \
  --id <빌드-ID>
```

제출 시 `eas.json`의 아래 값이 사용돼요:

| 필드 | 값 | 의미 |
| --- | --- | --- |
| `ascApiKeyPath` | `./credentials/asc-api-key.p8` | ASC API 키 파일 경로 (gitignored) |
| `ascApiKeyId` | (2단계에서 교체) | ASC API Key ID |
| `ascApiKeyIssuerId` | (2단계에서 교체) | ASC API Key Issuer ID |
| `appleTeamId` | (2단계에서 교체) | Apple Developer Team ID |

업로드가 끝나면 App Store Connect → TestFlight 탭에 빌드가 "처리 중(Processing)"으로 나타나요. 처리가 끝나면 내부/외부 테스터에게 배포할 수 있어요.

> 외부 테스터 배포는 Apple의 베타 앱 심사를 거쳐요. 실제 베타 런칭 활동은 **Phase 7.4로 이연**됐어요(이 런북 범위 밖).

---

## 5단계 — 사후 검증 (Post-Submit Verification)

1. **TestFlight 처리 확인** — App Store Connect → TestFlight 에서 빌드 상태가 "테스트 준비 완료"로 바뀌는지 확인해요.
2. **크래시 심볼리케이션 확인** — 테스트 기기에서 의도적으로 크래시를 한 번 유발한 뒤, Sentry `pck-mobile` 프로젝트에서 **심볼리케이션된 네이티브 스택 트레이스**가 보이는지 확인해요. (소스맵/dSYM 업로드가 정상 동작했다는 증거예요.)
3. **environment 태그 확인** — Sentry 이슈의 `environment`가 `production`으로 찍혔는지 확인해요.
4. **사용자 식별 확인** — 로그인한 사용자의 이슈에 `user.id`만 붙고 그 외 PII는 없는지 확인해요. (`setSentryUser`는 `{ id }`만 전송해요.)

---

## 전체 명령 순서 요약 (Cheat Sheet)

```bash
# 0) 준비
cd apps/mobile
eas login

# 1) EAS Secrets 등록 (값은 실제 값으로 교체)
eas secret:create --scope project --name SENTRY_DSN_MOBILE  --value "https://...@...ingest.sentry.io/..." --type string
eas secret:create --scope project --name SENTRY_AUTH_TOKEN  --value "sntrys_..."                          --type string
eas secret:list

# 2) placeholder 치환 (app.config.ts 조직 슬러그, eas.json ASC 3종, credentials/asc-api-key.p8 배치)

# 3) 프로덕션 빌드 (사람이 직접 실행 — CI 아님)
eas build  --profile production --platform ios

# 4) TestFlight 제출
eas submit --profile production --platform ios --latest
```

---

## 안전·범위 체크리스트

- [ ] `SENTRY_DSN_MOBILE`·`SENTRY_AUTH_TOKEN`은 **EAS Secret으로만** 등록했고, 레포 어디에도 커밋하지 않았어요.
- [ ] `credentials/asc-api-key.p8`·`credentials/` 가 `.gitignore`로 제외돼 있어요.
- [ ] `eas build`·`eas submit`은 **CI가 아니라 사람이** 실행해요.
- [ ] `TODO_...` placeholder는 실제 값 확보 전에는 그대로 둬요(임의 값 금지).
- [ ] 실제 베타 런칭 활동은 **Phase 7.4**로 이연됐어요.

---

## 관련 문서

- `apps/mobile/credentials/README.md` — ASC API 키(`.p8`) 발급·저장 절차와 3종 ID 설명
- `docs/app-store/ko-KR/README.md` — `검수 체크리스트`(ASC API Key ID·Issuer ID TODO 포함)
- `docs/app-store/ko-KR/app-review-info.md` — App 심사 정보(데모 계정·심사 메모)
- `apps/mobile/app.config.ts` — Sentry 플러그인 등록·프로덕션 DSN 빌드 타임 가드
- `apps/mobile/eas.json` — 빌드 프로파일·`submit.production.ios` 블록
