# `credentials/` — Apple · Sentry 자격 증명 (절대 커밋 금지)

> Phase 7.3 베타 준비(TestFlight 업로드)용 자격 증명을 보관하는 디렉터리예요.
> 이 폴더 안의 **`.p8` 키 파일과 모든 비밀값은 Git에 절대 커밋하면 안 돼요.**
> `apps/mobile/.gitignore` 가 `credentials/*` 를 무시하고, `README.md` 와 `.gitkeep` 만 추적해요.
> 표기는 저장소 전체 규칙대로 **해요체** 로 통일했어요.

---

## 0. 이 문서가 다루는 것

사람이 실제 자격 증명을 손에 넣었을 때, **소스 코드를 한 줄도 고치지 않고** TestFlight 업로드까지 갈 수 있도록
아래 3가지를 정리했어요.

1. App Store Connect **API Key(`.p8`)** 내려받기
2. 코드에 들어가는 **3개의 ID**(`ascApiKeyId` · `ascApiKeyIssuerId` · `appleTeamId`) 채우는 위치
3. Sentry 관측을 위한 **EAS Secret 등록**(`SENTRY_DSN_MOBILE` · `SENTRY_AUTH_TOKEN`)

> 빌드·제출 명령 전체 흐름(드라이런)은 [`docs/testflight-dry-run.md`](../../../docs/testflight-dry-run.md) 를 함께 봐 주세요.

---

## 1. App Store Connect API Key(`.p8`) 내려받기

App Store Connect 의 **API Key** 는 `eas submit` 이 사람 개입 없이 TestFlight 에 업로드할 때 쓰는 인증 수단이에요.

1. [App Store Connect](https://appstoreconnect.apple.com) 에 **Account Holder** 또는 **Admin** 권한으로 로그인해요.
2. **사용자 및 액세스(Users and Access)** → **통합(Integrations)** 탭 → **App Store Connect API** 로 이동해요.
3. **팀 키(Team Keys)** 에서 **키 생성(+)** 을 눌러요.
   - 이름: 예) `pck-eas-submit`
   - 액세스 권한: **App Manager** 이상(빌드 업로드에 필요한 최소 권한)
4. 생성 직후 표시되는 **`Download API Key`** 로 `.p8` 파일을 받아요.
   - ⚠️ **`.p8` 는 단 한 번만 내려받을 수 있어요.** 분실하면 키를 폐기하고 새로 만들어야 해요.
5. 받은 파일 이름을 **`asc-api-key.p8`** 로 바꿔 이 디렉터리에 둬요.

```
apps/mobile/credentials/asc-api-key.p8
```

> 이 경로는 `apps/mobile/eas.json` 의 `submit.production.ios.ascApiKeyPath`(`./credentials/asc-api-key.p8`) 와 정확히 일치해야 해요.
> 파일만 떨궈 두면 경로 수정은 필요 없어요.

---

## 2. 코드에 채워 넣는 3개의 ID

아래 3개 값은 현재 `apps/mobile/eas.json` 에 **`TODO_` 플레이스홀더** 로 들어가 있어요.
실제 값으로만 바꾸면 되고, 그 외 구조는 손대지 않아요.

| 값 | `eas.json` 키 (`submit.production.ios`) | 현재 플레이스홀더 | 어디서 얻나요 |
| --- | --- | --- | --- |
| ASC API Key **ID** | `ascApiKeyId` | `TODO_ASC_API_KEY_ID` | 1번에서 키 생성 후 **키 목록의 `Key ID`**(예: `2X9R4...`) |
| ASC API Key **Issuer ID** | `ascApiKeyIssuerId` | `TODO_ASC_API_KEY_ISSUER_ID` | **Integrations** 화면 상단의 **`Issuer ID`**(팀 전체 공통 UUID) |
| Apple **Team ID** | `appleTeamId` | `TODO_APPLE_TEAM_ID` | [Apple Developer → Membership](https://developer.apple.com/account) 의 **`Team ID`**(10자리, 예: `A1B2C3D4E5`) |

### 채우는 위치 (`apps/mobile/eas.json`)

```jsonc
{
  "submit": {
    "production": {
      "ios": {
        "ascApiKeyPath": "./credentials/asc-api-key.p8",
        "ascApiKeyId": "TODO_ASC_API_KEY_ID",        // ← Key ID 로 교체
        "ascApiKeyIssuerId": "TODO_ASC_API_KEY_ISSUER_ID", // ← Issuer ID 로 교체
        "appleTeamId": "TODO_APPLE_TEAM_ID"           // ← Team ID 로 교체
      }
    }
  }
}
```

> ✅ **체크포인트** — 3개 값 모두 `TODO_` 가 사라졌는지 확인해요. 하나라도 남아 있으면 `eas submit` 이 인증 단계에서 실패해요.

---

## 3. Sentry 관측용 EAS Secret 등록

`SENTRY_DSN_MOBILE` 과 `SENTRY_AUTH_TOKEN` 은 **저장소에 절대 커밋하지 않고** EAS Secret 으로만 보관해요.
(API Phase 7.2 의 `SENTRY_DSN_API` 패턴과 동일한 원칙이에요.)

### 3-1. 값을 어디서 얻나요

- **`SENTRY_DSN_MOBILE`** — Sentry 의 **`pck-mobile`** 프로젝트(`pck-api` 와 분리) → **Settings → Client Keys (DSN)** 에서 복사해요.
- **`SENTRY_AUTH_TOKEN`** — Sentry **User/Org Settings → Auth Tokens** 에서 발급해요.
  - 권한 스코프: **`project:releases`** 와 **`org:read`**(소스맵·dSYM 업로드용 = Releases/Builds)만 부여한 최소 권한 토큰으로 만들어요.

### 3-2. EAS Secret 생성 명령

프로젝트 루트(`apps/mobile`)에서 실행해요. 값은 따옴표로 감싸고, 셸 히스토리에 남지 않도록 주의해요.

```bash
# Sentry DSN (4개 빌드 프로파일 공통 주입)
eas secret:create --scope project \
  --name SENTRY_DSN_MOBILE \
  --value "https://<public-key>@o<org-id>.ingest.sentry.io/<project-id>"

# Sentry Auth Token (네이티브 심볼리케이션 = 소스맵 + dSYM 업로드용)
eas secret:create --scope project \
  --name SENTRY_AUTH_TOKEN \
  --value "sntrys_xxxxxxxxxxxxxxxxxxxxxxxx"
```

등록 결과는 아래로 확인해요(값은 마스킹돼요).

```bash
eas secret:list
```

> ⚠️ `SENTRY_AUTH_TOKEN` 이 설정되어 있을 때만 빌드 중 소스맵·dSYM 업로드가 동작해요(토큰 부재 시 자동 스킵).
> production 프로파일에서 `SENTRY_DSN_MOBILE` 이 비어 있으면 `app.config.ts` 의 빌드 타임 검증이 빌드를 즉시 실패시켜요.

### 3-3. Sentry 슬러그 플레이스홀더

조직 슬러그는 아직 미정이라 코드에 `TODO_SENTRY_ORG_SLUG` 로 들어가 있어요. 조직 프로비저닝 후 실제 슬러그로 바꿔 주세요.

| 값 | 현재 플레이스홀더 | 비고 |
| --- | --- | --- |
| Sentry Org Slug | `TODO_SENTRY_ORG_SLUG` | 조직 생성 후 교체 |
| Sentry Project Slug | `pck-mobile` | 확정값(모바일 전용, `pck-api` 와 분리) |

---

## 4. 보안 수칙 (반드시 지켜요)

- [ ] `.p8` 파일과 DSN·Auth Token 실제 값을 **Git에 커밋하지 않아요.** (`.gitignore` 로 차단되어 있어요)
- [ ] DSN·Auth Token 은 **EAS Secret** 으로만 보관하고, `.env`/소스 코드에 직접 넣지 않아요.
- [ ] `.p8` 분실 시 즉시 App Store Connect 에서 **키 폐기 후 재발급** 해요.
- [ ] Auth Token 은 **최소 권한 스코프**(Releases/Builds)만 부여해요.
- [ ] 자격 증명을 슬랙·이메일 등 평문 채널로 공유하지 않아요.

---

## 5. 디렉터리 상태

| 파일 | 추적 여부 | 설명 |
| --- | --- | --- |
| `README.md` | ✅ 커밋 | 이 문서 (비밀값 없음) |
| `.gitkeep` | ✅ 커밋 | 빈 디렉터리 유지용 |
| `asc-api-key.p8` | ❌ 무시 | 사람이 직접 떨궈 두는 Apple API Key |

---

## 참고

- EAS 제출 드라이런 절차: [`docs/testflight-dry-run.md`](../../../docs/testflight-dry-run.md)
- App Store 검수 체크리스트: [`docs/app-store/ko-KR/README.md`](../../../docs/app-store/ko-KR/README.md)
- EAS 제출 설정: `apps/mobile/eas.json` (`submit.production.ios`)
- Sentry 초기화 모듈: `apps/mobile/src/sentry.ts`
