# Deploy the API to Render (testing host)

> **Testing-only.** Render free has 512MB RAM (so `/v1/diagnose`'s `mediapipe`
> may OOM) and cold-starts after ~15 min idle. At launch, switch to Fly or
> Railway (≥1GB) — see "Launch-time revert" below. Builds the host-agnostic
> root `Dockerfile`; DB stays on Supabase.

## 0. Prerequisites
- A Render account (free, no card) with this GitHub repo connected.
- Supabase project **un-paused** (free tier pauses after ~1 week idle):
  Supabase dashboard → the project → Resume if paused.
- The Supabase **session pooler** connection string (port **5432**, NOT 6543 —
  6543 breaks asyncpg prepared statements), as a `postgresql+asyncpg://` URL
  (URL-encode `@` in the password as `%40`).

## 1. Create the service from the Blueprint
Render dashboard → **New → Blueprint** → pick this repo/branch. Render reads
`render.yaml` and proposes the `pov-api` web service. Apply it.
- The service URL is `https://pov-api.onrender.com` **if the name is free**. If
  Render appended a suffix, note the real URL — you'll need it in step 5.

## 2. Set the secret env vars (dashboard → the service → Environment)
Required:
- `DATABASE_URL` = the Supabase `postgresql+asyncpg://…@…:5432/…` URL
- `JWT_SECRET` = a fresh random value: `openssl rand -hex 32` (existing device
  JWTs become invalid → users re-sign in; fine, the device needs a new
  build/OTA anyway)
- `APPLE_BUNDLE_ID` = `com.method.pov` (the Apple Sign In aud-claim — a wrong
  value makes every sign-in 401 `invalid_apple_token`)

Optional (set to enable the feature):
- `ADMIN_TOKEN` = a random bearer; needed to seed recipes via `/v1/admin/recipes`
- `FAL_API_KEY` = your Fal.ai key; enables `/v1/generate` + admin preview
- `SENTRY_DSN_API`, `S3_*` / `IMAGE_TTL_DAYS` (absent → in-memory gallery)

## 3. Deploy
Trigger a deploy (Render auto-deploys on push to the tracked branch, or use
**Manual Deploy**). The `dockerCommand` runs `alembic upgrade head` (applies
the `content_gen_recipe_meta` migration from PR #85) then starts uvicorn on
`$PORT`.

## 4. Smoke test
```bash
APP=https://pov-api.onrender.com   # or your real URL
curl -s $APP/v1/health             # -> {"status":"ok"}
curl -s -o /dev/null -w '%{http_code}\n' $APP/v1/recipes   # -> 401 (auth gate intact)
```
(First request after idle takes ~30–60s — the free instance is waking.)

## 5. If your service URL is NOT `pov-api.onrender.com`
Update the single value in `apps/mobile/eas.json` (all four build profiles) to
your real `https://<name>.onrender.com`. The guard test
(`apps/mobile/tests/eas-api-base-url.test.ts`) is pattern-based, so it stays
green as long as all profiles share one `*.onrender.com` URL.

## 6. Seed a published recipe (so the catalog isn't empty)
The catalog (`GET /v1/recipes`) returns published recipes only. Either:
- **Admin API** (needs `ADMIN_TOKEN`): `POST $APP/v1/admin/recipes` with a body
  including `title`/`tags`/`thumbnail_url`, then publish it; or
- **Direct SQL** on Supabase: insert a row into `recipes` with a non-empty
  `title`, a `published` status, and a public `thumbnail_url`.

## 7. Ship the app to your device (OTA — no rebuild)
`EXPO_PUBLIC_API_BASE_URL` is inlined into the JS bundle **only because
`getApiBaseUrl()` now reads it by literal dot notation** (see the R1 fix in
`apps/mobile/src/config/api-base-url.ts`; bracket access is never inlined). The
remaining trap is *which* environment EAS Update reads from: `eas update
--environment production` resolves **EAS-stored Environment Variables** (the EAS
dashboard / `eas env:*`), **NOT** `eas.json`'s `build.production.env` (codex R2
critical). Since this plan keeps the URL in `eas.json` (not EAS-stored env), the
reliable, unambiguous command **inlines the value into the update process env**,
which `babel-preset-expo` then bakes into the published bundle:
```bash
cd apps/mobile
# Verify the URL actually lands in the bundle BEFORE shipping it:
EXPO_PUBLIC_API_BASE_URL=$APP pnpm run typecheck   # sanity: still compiles
# Publish the OTA bundle with the origin inlined into the update env:
EXPO_PUBLIC_API_BASE_URL=$APP eas update --channel production -m "point at Render + catalog"
```
(Alternative: register the value as an EAS Environment Variable first —
`eas env:create --name EXPO_PUBLIC_API_BASE_URL --value "$APP" --environment production`
— and only then `eas update --channel production --environment production`. Do
NOT rely on `--environment production` alone reading `eas.json` — it does not.)
Then **verify on-device, not just in CI**: open the app → Apple Sign In → the
generate/catalog tab → cards render. Confirm the requests hit Render (check
`$APP` access logs or a network/Sentry breadcrumb showing the `onrender.com`
origin) — a green guard test does NOT prove the device is talking to Render.
(If `runtimeVersion` drifted or a native module changed, do a full `eas build`
instead.)

## Launch-time revert (paid host, ≥1GB, no cold starts)
- **Fly:** add a card → `fly apps resume pov-api` / `fly deploy -a pov-api`
  (config already in `fly.toml`); point `eas.json` back to
  `https://pov-api.fly.dev`.
- **Railway:** new project from the same `Dockerfile`; set the same env vars;
  a start/release command running `cd apps/api && alembic upgrade head`; point
  `eas.json` at the Railway URL.
Because all host specifics live in `render.yaml`/`fly.toml` (not app code), the
switch is: stand up the host → set secrets → re-point `eas.json` → OTA/rebuild.
