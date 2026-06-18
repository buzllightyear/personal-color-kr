# Phase 7.4 — Production deploy runbook (Fly.io API + iOS launch)

The launch critical path is **backend-first**: the mobile app is inert until a
hosted API answers `EXPO_PUBLIC_API_BASE_URL`. This runbook deploys the
FastAPI backend (`apps/api`) to Fly.io, then walks the iOS submit chain.

Artifacts already in the repo (created in `chore/launch-prep-fly`):

- `Dockerfile` (repo root) — installs `core-python` + `apps/api`, pinned Python 3.12 (mediapipe).
- `fly.toml` (repo root) — Tokyo `nrt`, health check `/v1/health`, migrations via `release_command`.
- `.dockerignore` — keeps secrets/node/tests out of the image.
- `.gitignore` — now ignores `credentials/`, `*.p8`, `*.pem`, `*.mobileprovision`.

Everything below this line needs **your** Apple/Fly accounts — it cannot be
automated from the repo.

---

## 0. Prerequisites (one-time)

```bash
# Fly CLI
brew install flyctl          # or: curl -L https://fly.io/install.sh | sh
fly auth login

# Expo / EAS CLI (for the iOS half)
npm i -g eas-cli
eas login
```

You also need: an **Apple Developer Program** membership ($99/yr), and an
**App Store Connect API key** (`.p8`) — created at App Store Connect ›
Users and Access › Integrations › App Store Connect API.

---

## 1. Create the Fly app + Postgres

```bash
# From repo root (where fly.toml lives). Do NOT run `fly launch` (it would
# overwrite our tuned fly.toml) — create the app explicitly instead.
fly apps create pov-api      # match `app` in fly.toml, or edit it

# Provision a managed Postgres 16 in the SAME region for low latency.
fly postgres create --name personal-color-kr-db --region nrt
fly postgres attach personal-color-kr-db --app pov-api
#   ^ this sets the DATABASE_URL secret on the app automatically, BUT it uses
#     the postgresql:// scheme. asyncpg needs postgresql+asyncpg:// — see §2.
```

> Alternative (MVP-PLAN's original intent): use **Supabase** managed Postgres
> and skip `fly postgres`. Then set `DATABASE_URL` manually in §2 to the
> Supabase connection string (with `+asyncpg`).

---

## 2. Set secrets

The app reads these at runtime; missing `DATABASE_URL` / `JWT_SECRET` /
`APPLE_BUNDLE_ID` make it fail to start (by design).

```bash
fly secrets set \
  DATABASE_URL='postgresql+asyncpg://USER:PASS@HOST:5432/DB' \
  JWT_SECRET="$(python3 -c 'import secrets; print(secrets.token_hex(32))')" \
  APPLE_BUNDLE_ID='com.method.pov' \
  FAL_API_KEY='...' \
  SENTRY_DSN_API='https://...ingest.sentry.io/...' \
  --app pov-api
```

- If you used `fly postgres attach`, **overwrite** the auto-set `DATABASE_URL`
  with the `postgresql+asyncpg://` scheme (asyncpg rejects bare `postgresql://`).
- `FAL_API_KEY` is the server-side image vendor key — backend only, never in
  the mobile bundle.

---

## 3. Deploy

```bash
fly deploy --app pov-api
```

What happens: image builds from `Dockerfile` → Fly runs the `release_command`
(`cd apps/api && alembic upgrade head`) once against `DATABASE_URL` → new
machine boots `uvicorn api.main:app` → `/v1/health` goes green → traffic routes.

### Smoke-test the live API

```bash
APP=https://pov-api.fly.dev
curl -fsS $APP/v1/health      # {"status":"ok"} — pure liveness
curl -fsS $APP/v1/db-health   # confirms Postgres connectivity + migrations
fly logs --app pov-api   # watch for OOM (raise vm.memory if seen)
```

---

## 4. Point the mobile app at the deployed API

`EXPO_PUBLIC_API_BASE_URL` is inlined into the JS bundle at build time, so it
must be set in the build environment for `preview`/`production` EAS builds:

```bash
eas secret:create --scope project \
  --name EXPO_PUBLIC_API_BASE_URL \
  --value https://pov-api.fly.dev
```

(No trailing slash. Local simulator dev keeps `http://127.0.0.1:8000` via the
root `.env`.)

---

## 5. iOS submit credentials

`eas.json` intentionally holds **no** ASC credentials (they were `TODO_`
placeholders). Provide them one of two ways:

**A. Env vars at submit time** (key file stays in the gitignored `credentials/`):

```bash
mkdir -p credentials && cp ~/Downloads/AuthKey_XXXX.p8 credentials/asc-api-key.p8
export EXPO_ASC_API_KEY_PATH=./credentials/asc-api-key.p8
export EXPO_ASC_KEY_ID=XXXXXXXXXX
export EXPO_ASC_ISSUER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
export EXPO_APPLE_TEAM_ID=YYYYYYYYYY
```

**B. EAS-managed credentials** (upload once, no env vars after):

```bash
eas credentials   # iOS › App Store Connect API Key › upload the .p8
```

Also set `app.json` › `ios.appleTeamId` (currently `TODO_APPLE_TEAM_ID`) to
your real Team ID — it is semi-public and fine to commit.

---

## 6. iOS build → TestFlight → App Store

```bash
# 1) Production build (eas.json `production` profile auto-increments buildNumber)
eas build --platform ios --profile production

# 2) Upload to App Store Connect / TestFlight
eas submit --platform ios --profile production --latest

# 3) In App Store Connect: add the build to a TestFlight group, invite beta
#    testers, validate the funnel end-to-end against the live Fly API.

# 4) When beta is clean: attach the build to the App Store version, paste the
#    metadata from docs/app-store/ko-KR/, submit for review.
```

### EAS build profiles (eas.json)

> ⚠️ `eas.json` is strict JSON validated against EAS's schema — it does NOT
> allow arbitrary keys (a `_comments` block fails with "is not allowed" and
> blocks every `eas` command). Keep profile docs HERE, not in eas.json.

- **`development-simulator`** — unsigned iOS Simulator `.app` (dev client).
  Needs **no Apple credentials / Team ID**, so it builds before the Apple
  membership activates. Use it to validate the app + live API on the
  simulator (funnel / diagnosis / generation). IAP can't be tested here.
- **`development`** — signed dev-client `.ipa` for a physical device (ASC
  sandbox subscription testing). Needs Apple credentials.
- **`preview`** — internal-distribution build (ad-hoc / TestFlight-style).
- **`production`** — App Store build, `autoIncrement` bumps `buildNumber`.

First `eas build`/`eas config` run prompts to create the EAS project
(`@<owner>/personal-color-kr`) — run it in a real terminal (interactive)
and accept, or run `eas init` first. Android profiles are intentionally
absent: the app is iOS-only (no Play Billing).

---

## Pre-submit checklist

- [ ] `app.json` version is `1.0.0` (done in this branch); `ios.appleTeamId` set.
- [ ] Fly API green: `/v1/health` + `/v1/db-health` both 200.
- [ ] `EXPO_PUBLIC_API_BASE_URL` EAS secret points at the Fly origin.
- [ ] `SENTRY_DSN_API` (Fly secret) + `SENTRY_DSN_MOBILE` + `SENTRY_AUTH_TOKEN`
      (EAS secret) set; replace `TODO_SENTRY_ORG_SLUG` in `app.config.ts`.
- [ ] StoreKit / Superwall products promoted from ASC **sandbox** to production.
- [ ] App Store metadata reviewed (`docs/app-store/ko-KR/`).
- [ ] Product decisions resolved: Phase 5.3 real content, Phase 6.1
      `SKStoreReviewController` — ship-or-defer.
