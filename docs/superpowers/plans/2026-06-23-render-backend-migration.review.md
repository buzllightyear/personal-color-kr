## Round 1 (2026-06-24T09:30:24+09:00)

_severity:_ critical=2 high=3 medium=3  _turn:_ completed

플랜 본문과 companion design spec를 먼저 읽고, Render Blueprint 항목은 현재 문서 기준으로 따로 확인하겠습니다. 그 다음 요청한 네 개 섹션 형식으로 이슈만 정리하겠습니다.

본문 기준으로는 세 가지 축이 이미 눈에 띕니다: Render URL을 “선택값”처럼 고정하는 부분, OTA 전달 가능성의 검증 부재, 그리고 Blueprint 스키마 검증이 실제 Render 검증이 아니라 토큰 검사에 가깝다는 점입니다. 나머지 작업/런북 범위를 끝까지 읽은 뒤 severity를 나누겠습니다.

### Critical

- OTA가 새 API URL을 실제 번들에 싣는다는 핵심 가정이 깨져 있다. 플랜은 “`EXPO_PUBLIC_API_BASE_URL` is inlined into the JS bundle” 및 `eas update --channel production`으로 기존 TestFlight 빌드에 전달된다고 하지만, 현재 코드 `apps/mobile/src/config/api-base-url.ts`는 `process.env[API_BASE_URL_ENV_KEY]` bracket 접근을 쓴다. Expo 공식 문서는 `process.env.EXPO_PUBLIC_KEY` 같은 dot notation만 inline 대상이고 bracket 접근은 지원하지 않는다고 명시한다. 근거: 플랜 350-356행, 코드 `getApiBaseUrl()`, [Expo env docs](https://docs.expo.dev/guides/environment-variables/). 이 상태에서 “No application code changes” 제약을 지키면 `eas.json` 변경만으로 설치된 앱의 런타임 URL이 바뀐다는 보장이 없다.

- `eas update --channel production`이 `eas.json`의 `build.production.env` 값을 사용한다는 가정이 불명확하다. 플랜은 `apps/mobile/eas.json` 4개 build profile만 바꾸고 OTA 명령은 `eas update --channel production`만 제시한다. Expo 공식 문서는 EAS Update에서 환경값을 쓰려면 `--environment production`을 지정해야 하며, update bundle은 local/CI env를 사용한다고 설명한다. 근거: 플랜 238-249행, 350-356행, [EAS environment variables docs](https://docs.expo.dev/eas/environment-variables/). 결과적으로 guard test는 통과해도 OTA 번들은 old/empty URL로 나갈 수 있다.

### High

- Render URL 확정 순서가 spec와 어긋난다. design spec는 “real Render URL is unknown until the service is created”라고 하는데, 플랜은 `https://pov-api.onrender.com`을 먼저 `eas.json`, `.env.example`, docs, PR body에 고정하고 “operator updates”로 넘긴다. 근거: 플랜 18행, 190행, 249행, 306-341행. 실제 subdomain이 달라져도 guard는 regex 기반이라 green이고, 문서/PR/예시 smoke URL은 틀린 채 남을 수 있다.

- 구현 plan의 exit criteria가 “backend move” 완료를 검증하지 않는다. Task 4는 local gates + PR 생성으로 끝나고, 서비스 생성/secret 입력/Supabase resume/seed/eas update는 Self-Review에서 “operator steps”로 defer된다. 근거: 플랜 399-415행, 424행. 목표가 “device testing can resume”라면 최소한 post-merge Render deploy smoke와 OTA verification이 blocking acceptance로 있어야 한다.

- migration을 `dockerCommand`에 넣는 선택은 실패 시나리오가 과소평가되어 있다. 플랜은 `dockerCommand: ... alembic upgrade head && ... uvicorn`을 사용하지만, Render 현재 문서는 `preDeployCommand`를 DB migration 등에 권장하고 Docker service도 pre-deploy를 지원한다고 설명한다. 근거: 플랜 132행, [Render Blueprint docs](https://render.com/docs/blueprint-spec), [Docker on Render docs](https://render.com/docs/docker). 현재 방식은 cold start/restart마다 DB 연결이 uvicorn boot 전에 필요해져서 Supabase pause/network issue가 `/v1/health`까지 죽이는 boot dependency가 된다.

### Medium

- Blueprint “validity test”가 실제 Render schema validation이 아니다. 테스트는 YAML parse와 몇 개 string token만 확인한다. 현재 Render 문서상 `runtime: docker`, `dockerCommand`, `dockerfilePath`, `dockerContext`, `plan`, `region`, `healthCheckPath`, `envVars.sync:false` 자체는 유효하지만, 플랜의 테스트는 Render CLI/API/schema validation을 수행하지 않아 schema drift나 field typo를 잡지 못한다. 근거: 플랜 54-102행, [Render validation docs](https://render.com/docs/blueprint-spec).

- `APPLE_BUNDLE_ID`를 secret처럼 `sync:false`로 두는 것은 불필요한 수동 오류 경로다. 플랜은 필수값을 `APPLE_BUNDLE_ID=com.method.pov`로 알고 있으면서도 dashboard 입력에 맡긴다. 근거: 플랜 16행, 135-140행, 309-316행. 이 값은 secret이 아니므로 Blueprint에 `value: com.method.pov`로 고정하고 test가 exact value를 assert하는 편이 검증 가능하다.

- `render.yaml` test가 load-bearing fields를 충분히 pin하지 않는다. 현재 test는 `name`, `region`, `dockerContext`, `branch`, command ordering, `--host 0.0.0.0`, `--port $PORT`를 검증하지 않는다. 근거: 플랜 81-102행. 특히 command는 token 포함만 확인하므로 “migrate then serve on injected port”라는 주장보다 약하다.

### 권장 수정

- `getApiBaseUrl()`을 dot notation 기반으로 바꾸거나 `app.config.ts`의 `extra`로 URL을 전달하는 식으로 실제 Expo bundle에 들어가는 경로를 고쳐라. 그 다음 `eas update --environment production --channel production` 또는 명시적 `EXPO_PUBLIC_API_BASE_URL=... eas update ...`를 runbook에 넣어라.

- OTA 검증을 guard test가 아니라 bundle/update 검증으로 추가하라. 예: update 직전 `EXPO_PUBLIC_API_BASE_URL=https://real.onrender.com pnpm --filter mobile run typecheck` 후 `eas update --environment production ...`, 그리고 device에서 `GET /v1/health`/catalog fetch 로그 또는 Sentry breadcrumb로 확인.

- Render service URL을 Task 2 전에 확정하는 blocking step으로 바꿔라. 계정 권한 때문에 자동 생성이 불가하면 `https://<actual>.onrender.com` placeholder를 남기고, 실제 URL이 확인되기 전에는 `eas.json`/docs/PR body를 final로 고정하지 않게 하라.

- Render Blueprint는 현재 schema 기준으로 `runtime: docker`와 `dockerCommand`가 맞다. 다만 plan에는 Render CLI/API/schema validation step을 추가하고, migration은 가능하면 `preDeployCommand`로 옮기거나 `dockerCommand` 유지 시 cold-start DB dependency를 명시적으로 수용/검증하라.

- 확인 결과 `Path(__file__).resolve().parents[4]`와 `new URL('../eas.json', import.meta.url)`의 상대 경로 계산은 현재 repo 구조 기준으로 맞다. 이 둘은 수정 대상이 아니다.

---

## Round 2 (2026-06-24T09:37:07+09:00)

_severity:_ critical=2 high=1 medium=3  _turn:_ completed

현재 파일 시스템의 v2 플랜을 다시 읽고, R1에서 제가 critical/high로 잡았던 항목만 우선 매핑해 보겠습니다. Render/Expo 쪽은 실행 차단 여부 판단에 필요한 범위에서만 현재 문서와 대조하겠습니다.

v2는 R1의 큰 항목 대부분을 명시적으로 받아들였지만, OTA 쪽에 하나의 실질적인 잔여 위험이 남아 있습니다. 특히 `--environment production`을 쓰는 것만으로 `eas.json`의 `build.production.env`가 EAS Update에 공급된다고 보는 문장이 현재 Expo 문서와 맞지 않습니다.

### Critical
- **Residual / patch-created — R1 critical dot-notation fix can be left out of the PR.** Plan adds `apps/mobile/src/config/api-base-url.ts` and `apps/mobile/tests/api-base-url-inlining.test.ts` in Task 2 Step 0, but Task 2 commit only runs `git add apps/mobile/eas.json apps/mobile/tests/eas-api-base-url.test.ts` (lines 324-328). Following the plan can produce a local green dirty tree, then push a branch that omits the actual OTA inlining fix. That reopens the R1 execution blocker.

- **Residual — OTA env delivery is still not guaranteed.** The plan says “EAS Update resolves `EXPO_PUBLIC_*` from the build profile's environment” and runs `eas update --channel production --environment production` (lines 414-422), but Expo’s EAS env docs say `--environment` uses EAS Environment Variables configured in EAS, not `eas.json build.*.env`. The plan edits `eas.json` but never creates/updates the EAS production env var. Result: OTA can still ship empty/old API origin. Sources: [Expo env dot notation](https://docs.expo.dev/guides/environment-variables/), [EAS environment variables](https://docs.expo.dev/eas/environment-variables/).

### High
- **Residual — real Render URL confirmation is still internally inconsistent.** Task 2 says not to finalize guessed `pov-api.onrender.com` until “Task 3 step 1 creates the service” (lines 194-201), but Task 3 step 1 only writes the runbook (lines 343-442). Task 1 and Task 2 still commit `.env.example`/`eas.json` with the guessed URL (lines 161-187, 298-328), while Task 4 allows a post-merge follow-up correction (lines 501-507). This is less severe than R1 because blocking acceptance now exists, but the implementation order can still merge a known guess.

### Medium
- **Closed — R1 “merge is not done” issue is addressed.** Task 4 now makes live Render smoke and on-device OTA verification blocking acceptance (lines 471-515).

- **Closed — R1 `dockerCommand` boot dependency concern is now explicit.** The plan documents the failure mode, accepts it for testing, and points launch hosting toward pre-deploy/release migration (lines 17, 126-130).

- **Closed with caveat — R1 dot-notation design is correct.** The proposed code change to `process.env.EXPO_PUBLIC_API_BASE_URL` matches Expo’s documented inline form, but it remains critical until the commit command includes the changed source and new guard test.

### 권장 수정
- In Task 2 Step 6, add the missing files:
  `git add apps/mobile/src/config/api-base-url.ts apps/mobile/tests/api-base-url-inlining.test.ts apps/mobile/eas.json apps/mobile/tests/eas-api-base-url.test.ts`

- For OTA, either make the default command inline the value:
  `EXPO_PUBLIC_API_BASE_URL=$APP eas update --channel production ...`
  or add explicit `eas env:create/update --name EXPO_PUBLIC_API_BASE_URL --environment production ...` before using `--environment production`.

- Move “create Render service and confirm URL” before committing `.env.example`/`eas.json`/runbook, or keep `https://<actual>.onrender.com` as a visible unresolved placeholder until confirmation.

---

## Round 3 (2026-06-24T09:40:11+09:00)

_severity:_ critical=0 high=0 medium=0  _turn:_ completed

v3 파일만 다시 읽고 R2의 세 항목이 닫혔는지 확인하겠습니다. 최종 라운드라 critical/high가 0이면 요청하신 verdict만 반환하겠습니다.

### Verdict
- PASS

---

