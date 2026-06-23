# Backend Host Migration: Fly → Render (testing-only) — Design

**Date:** 2026-06-23
**Status:** Approved (brainstorming) → ready for implementation plan
**Branch:** `chore/backend-render-migration`

## Context & Problem

The production API (`pov-api` on Fly.io, `https://pov-api.fly.dev`) is **suspended**: the Fly free trial ended and the org (`ooptee tee` / slug `personal`) has no credit card on file (`fly status` → `trial has ended, please add a credit card`). The app was LIVE and on-device-verified on 2026-06-19, but has returned HTTP 000 since the trial lapsed. This blocks all device verification (catalog cards from PR #85, the whole funnel).

The user wants a **genuinely free, no-credit-card host for the testing phase**, and will switch to a paid host (**Fly or Railway**) at launch — when `/v1/diagnose` (memory-hungry `mediapipe`) must work reliably and cold-starts are unacceptable.

## Goal

Get the backend serving again on a free, no-card host (**Render free Docker web service**) with the existing Supabase database, so device testing of the catalog and funnel can resume. Keep the migration cheap to reverse: the launch-time move to Fly/Railway should be re-pointing config, not a rewrite.

## Non-Goals

- **Not** migrating the database. Supabase (free, no card, already provisioned) stays; it is independent of the API host. Only needs un-pausing if the free tier auto-paused.
- **Not** making `/v1/diagnose` work on the free tier. `mediapipe==0.10.18` needs ~1GB at call time; the free tier is 512MB. Diagnosis is explicitly deferred to the launch host. (See "Known Limitations".)
- **Not** removing Fly config. `fly.toml` and the `Dockerfile` stay (the Dockerfile is host-agnostic; `fly.toml` is a record + the likely launch target if Fly is paid). `docs/deploy-api-fly.md` is marked deprecated-for-now, not deleted.
- **Not** changing any application code in `apps/api` / `packages/core-python`. This is host config + the mobile API-base-URL rewire only.

## Key Finding: the Dockerfile is already portable

The root `Dockerfile` requires **no changes** to run on Render:
- `CMD ["sh", "-c", "uvicorn api.main:app --host 0.0.0.0 --port ${PORT:-8000}"]` already binds to the host-injected `$PORT` (Render injects `PORT`, default 10000).
- `python:3.12-slim` + `libgl1`/`libglib2.0-0` (mediapipe's OpenCV runtime deps) are present.
- Migrations are deliberately **not** in `CMD` (the Dockerfile comment instructs non-Fly hosts to run `cd apps/api && alembic upgrade head` before serving).
- `mediapipe` is **lazy-imported** (`personal_color/face_detector.py::_import_mediapipe`, only on the `/v1/diagnose` face-detect path) — so the app **boots and serves catalog/auth/gallery on 512MB**; only diagnosis needs the 1GB.

## Architecture (target, testing phase)

```
iPhone (TestFlight / EAS build, runtime 54)
        │  EXPO_PUBLIC_API_BASE_URL = https://<service>.onrender.com
        ▼
Render free Docker web service  ── built from root Dockerfile
  · single instance, spins down after ~15 min idle (cold start ~30–60s on wake)
  · listens on $PORT, liveness /v1/health (pure, no DB/env)
  · dockerCommand: alembic upgrade head → uvicorn   (single instance ⇒ no migration race)
        │  DATABASE_URL = postgresql+asyncpg://…@<supabase session pooler>:5432/…
        ▼
Supabase Postgres (free, unchanged) — session pooler :5432 (NOT 6543; 6543 breaks asyncpg prepared statements)
```

**Why `dockerCommand` runs the migration (vs Fly's `release_command`):** Render free tier's separate pre-deploy step is not dependable, and the free service is a single instance, so running `alembic upgrade head` (idempotent — no-ops when already at head) immediately before `uvicorn` is safe and needs zero dashboard steps. This lives **only in `render.yaml`**, leaving the Dockerfile's no-migration-in-CMD property intact for multi-instance hosts (Fly/Railway at launch).

## Components / Changes

### Code / config in repo

| File | Change | Notes |
|---|---|---|
| `render.yaml` (**new**) | Render Blueprint | `services: [{ type: web, runtime: docker, dockerfilePath: ./Dockerfile, dockerContext: ., plan: free, region: singapore, healthCheckPath: /v1/health, dockerCommand: "sh -c 'cd /app/apps/api && alembic upgrade head && cd /app && uvicorn api.main:app --host 0.0.0.0 --port $PORT'", envVars: [{key, sync:false} …] }]` |
| `apps/mobile/eas.json` | 4 profiles: `EXPO_PUBLIC_API_BASE_URL` `https://pov-api.fly.dev` → the real Render URL | Filled **after** the service exists (name may be taken globally → Render appends a suffix). Until then, a documented placeholder. |
| `.env.example` | Update the API-base-URL comment (line ~154) to list the Render URL alongside / instead of the Fly one | |
| `docs/deploy-api-render.md` (**new**) | Render deploy runbook (Blueprint create → set secrets → un-pause Supabase → smoke test) + the launch-time revert-to-Fly/Railway path | |
| `docs/deploy-api-fly.md` | Header note: "DEPRECATED for the testing phase — backend runs on Render (see deploy-api-render.md); revisit Fly at launch." | Not deleted. |

### Secrets (Render dashboard env, `sync:false` — never committed)

- `DATABASE_URL` — Supabase session pooler, `postgresql+asyncpg://`, `@`→`%40` URL-encoded if present in password.
- `JWT_SECRET` — **a fresh random value** (`openssl rand -hex 32`). Fly secret values aren't retrievable via CLI, and the device needs a new build/OTA anyway, so reuse isn't worth chasing; a fresh secret invalidates any existing device JWT → the user re-signs in on next launch (acceptable).
- `APPLE_BUNDLE_ID` — **`com.method.pov`** (the aud-claim; wrong value → every Apple Sign In 401s `invalid_apple_token`).
- `SENTRY_DSN_API` — optional; omit for testing.
- **NOT** `FAL_API_KEY` — `apps/api/tests/test_fal_api_key_absence.py` enforces its absence (Fal.ai is out of FastAPI scope).

## Data flow / behavior unchanged

All `/v1/*` routes, auth (Apple Sign In → HS256 JWT), and the catalog (`GET /v1/recipes`, auth-gated + published-only) behave identically — only the origin the mobile app points at changes. No request/response contract change.

## Mobile delivery

`EXPO_PUBLIC_API_BASE_URL` is a build-time `EXPO_PUBLIC_*` var inlined into the JS bundle. After updating `eas.json`:
- **OTA path (preferred for testing):** `eas update --channel production` rebuilds the JS bundle (new URL + the catalog feature from PRs #82/#85) and ships it to the existing installed build **without a native rebuild**, provided `runtimeVersion` still matches (installed build is SDK 54 / runtime 54; current repo is SDK 54). The installed TestFlight build `1.0.0 (2)` predates content-gen, so OTA is what brings the catalog tab + cards to the device.
- **Full rebuild** only if `runtimeVersion` drifted or a native module changed (none here).

This is an operational step (needs the user's Expo creds), documented in the runbook — not a code deliverable of this spec.

## Known Limitations (accepted for the testing phase)

1. **`/v1/diagnose` may OOM on 512MB** — mediapipe needs ~1GB at face-detect time. Catalog/auth/gallery are unaffected (lazy import). Diagnosis verification waits for the launch host.
2. **Cold starts** — free service spins down after ~15 min idle; first request after idle takes ~30–60s. Acceptable for manual testing.

## Exit Criteria / Launch-time migration (explicit)

Render is **transitional**. At launch, migrate to a paid host with ≥1GB so diagnosis works and there are no cold starts:
- **Fly (resume):** add a card → `fly apps resume pov-api` / `fly deploy` (config already in `fly.toml`); point `eas.json` back to `https://pov-api.fly.dev`.
- **Railway:** Dockerfile-native; new project + the same 4 secrets + a release/start command running `alembic upgrade head`; point `eas.json` to the Railway URL.

Because the Dockerfile is host-agnostic and all host specifics live in `render.yaml` / `fly.toml` (not app code), the launch switch is: stand up the paid host + set secrets + re-point `eas.json` + OTA/rebuild. No application changes.

## Testing / Verification

Infra config is mostly non-unit-testable; verification is a mix of a small guard test + a manual smoke runbook.

- **Guard test (mobile):** assert `apps/mobile/eas.json` contains no `pov-api.fly.dev` and that every profile's `EXPO_PUBLIC_API_BASE_URL` is the agreed Render `https://…onrender.com` URL (prevents a stale-URL regression). Lives in the mobile test suite.
- **`render.yaml` validity:** YAML parses; required keys present (`type: web`, `runtime: docker`, `healthCheckPath: /v1/health`, `dockerCommand`). A lightweight schema/shape check.
- **Manual smoke (runbook, post-deploy):** `curl https://<svc>.onrender.com/v1/health` → `{"status":"ok"}`; `GET /v1/recipes` without auth → 401 (gate intact); after seeding a published recipe + signing in on device, the catalog tab renders cards.

## Open Items folded into the plan

- The real Render URL is unknown until the service is created → the implementation plan creates the service first (or picks a name and verifies the resulting URL), then writes that exact URL into `eas.json` and the guard test.
- Seeding ≥1 published recipe with `title`/`tags`/`thumbnail_url` (so the catalog isn't empty) is an operational step in the runbook, not a code change.
