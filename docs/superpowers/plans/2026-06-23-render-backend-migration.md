# Render Backend Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the backend off the suspended Fly app onto a free, no-credit-card **Render Docker web service** (Supabase DB unchanged) so device testing of the catalog/funnel can resume — keeping the launch-time switch back to Fly/Railway a config re-point, not a rewrite.

**Architecture:** Add a `render.yaml` Blueprint that builds the existing host-agnostic root `Dockerfile`, runs `alembic upgrade head` then `uvicorn` via `dockerCommand` (safe on a single free instance), and binds the Render-injected `$PORT`. Re-point the mobile app's `EXPO_PUBLIC_API_BASE_URL` from `pov-api.fly.dev` to the Render URL. No application code, Dockerfile, or DB changes.

**Tech Stack:** Render Blueprint (`render.yaml`), Docker (`python:3.12-slim`), FastAPI/uvicorn, Alembic, Supabase Postgres; Expo EAS (`eas.json`); pytest (apps/api), vitest (apps/mobile).

## Global Constraints

- **Testing-only host.** Render free is transitional; at launch migrate to Fly (resume w/ card) or Railway (≥1GB so `/v1/diagnose` works, no cold starts). Do NOT delete `fly.toml` or the `Dockerfile`.
- **Near-zero application code changes.** Touch only: `render.yaml` (new), `apps/mobile/eas.json`, `apps/mobile/src/config/api-base-url.ts` (the one-line dot-notation fix below — REQUIRED for OTA to work), `.env.example`, `docs/deploy-api-render.md` (new), `docs/deploy-api-fly.md` (header note), and the new test files. Do NOT modify `apps/api/src`, `packages/core-python/src`, the `Dockerfile`, or `fly.toml`.
- **CRITICAL — OTA inlining requires dot notation (codex review R1).** `apps/mobile/src/config/api-base-url.ts` currently reads `process.env[API_BASE_URL_ENV_KEY]` (bracket access via a `const` key). Expo's `babel-preset-expo` only statically inlines **literal** `process.env.EXPO_PUBLIC_*` dot-member expressions into the JS bundle; a computed/bracket access is NOT inlined and resolves to `undefined` at runtime in a built/OTA'd app. As written, re-pointing `eas.json` + `eas update` would ship an **empty** API origin to the device — the migration's core premise silently fails. **Fix:** change `getApiBaseUrl()` to read `process.env.EXPO_PUBLIC_API_BASE_URL` directly (dot notation); keep the empty-string-on-unset contract. This is added as **Task 2 Step 0** (with its own failing-then-passing test) before the `eas.json` rewire.
- **Dockerfile is already portable** — `CMD` binds `${PORT:-8000}`; migrations are intentionally NOT in `CMD`. The migrate-on-start lives ONLY in `render.yaml`'s `dockerCommand` (single free instance ⇒ no migration race), preserving the Dockerfile for multi-instance hosts.
- **Accepted tradeoff — migration is a boot dependency (codex R1 high).** Render's preferred place for migrations is `preDeployCommand`, which runs the DB step in a separate phase so a migration/DB failure doesn't take down a previously-healthy instance. Here `alembic upgrade head` is chained into `dockerCommand` instead, so on every cold start/restart the process needs a live Supabase connection *before* uvicorn binds `$PORT` — if Supabase is paused or unreachable, `/v1/health` itself never comes up (no degraded-but-serving state). This is **knowingly accepted** for the free testing host because: (a) `preDeployCommand` is a separate Render feature with its own free-plan caveats, (b) the catalog flow is unusable without the DB anyway, and (c) the runbook's first prerequisite is un-pausing Supabase. The launch host (Fly/Railway) SHOULD move migration to a dedicated release/pre-deploy phase. The Blueprint comment records this.
- **Secrets are never committed** — `render.yaml` `envVars` use `sync: false` (values set in the Render dashboard). Required: `DATABASE_URL`, `JWT_SECRET`, `APPLE_BUNDLE_ID=com.method.pov`. Optional: `ADMIN_TOKEN`, `FAL_API_KEY`, `SENTRY_DSN_API`, `S3_*`/`IMAGE_TTL_DAYS`.
- **`FAL_API_KEY` is allowed as a deployment secret.** `apps/api/tests/test_fal_api_key_absence.py` only forbids the literal string in `apps/api/src/**/*.py` (the key is read inside core-python). Setting it on Render does not break that test.
- **eas.json URL** is `https://pov-api.onrender.com` (the chosen service name). If the real Render URL differs (name collision), the operator updates that one value; the guard test is pattern-based (`https://<sub>.onrender.com`, all profiles identical) so it stays green.
- **Python gate:** `python -m black --check src tests && python -m ruff check src tests && python -m mypy --strict src` (mypy src only) + `pytest` (pinned `<9.1`), run from `apps/api`.
- **TS gate:** `pnpm --filter mobile run typecheck && … test && … lint && … format:check`. `exactOptionalPropertyTypes: true`. Prettier printWidth 88, single quotes, semicolons. (`eas.json` is JSON — not prettier/tsc-checked; the new `.ts` test is.)
- **`main` is protected** — land via PR. Work happens on branch `chore/backend-render-migration` (already created; holds the spec commits).

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `render.yaml` | Render Blueprint: free Docker web service, migrate-then-serve, health check, secret env var declarations | **Create** |
| `apps/api/tests/unit/test_render_blueprint.py` | Pins the Blueprint's load-bearing fields (free plan, health path, dockerCommand semantics, required secrets `sync:false`) | **Create** |
| `.env.example` | Dev-facing API base URL comment | Modify (comment only) |
| `apps/mobile/src/config/api-base-url.ts` | Bracket→dot env access so Expo inlines the URL into the OTA bundle (R1 critical) | Modify (1 line) |
| `apps/mobile/eas.json` | EAS build profiles' `EXPO_PUBLIC_API_BASE_URL` | Modify (4 profiles) |
| `apps/mobile/tests/eas-api-base-url.test.ts` | Guard: no `fly.dev`, all profiles share one `*.onrender.com` URL | **Create** |
| `apps/mobile/tests/api-base-url-inlining.test.ts` | Guard: source uses literal `process.env.EXPO_PUBLIC_API_BASE_URL` dot access (inlinable), not bracket | **Create** |
| `docs/deploy-api-render.md` | Render deploy runbook + launch-time revert path | **Create** |
| `docs/deploy-api-fly.md` | Deprecation header pointing to the Render runbook | Modify (header only) |

---

## Task 1: Render Blueprint + validity test + .env.example

**Files:**
- Create: `render.yaml`
- Create: `apps/api/tests/unit/test_render_blueprint.py`
- Modify: `.env.example` (the API-base-URL comment, ~line 154)

**Interfaces:**
- Produces: `render.yaml` at repo root with one `services` entry — `type: web`, `runtime: docker`, `dockerfilePath: ./Dockerfile`, `plan: free`, `healthCheckPath: /v1/health`, a `dockerCommand` that runs `alembic upgrade head` then `uvicorn api.main:app` on `$PORT`, and `envVars` declaring `DATABASE_URL`/`JWT_SECRET`/`APPLE_BUNDLE_ID` with `sync: false`.

- [ ] **Step 1: Write the failing Blueprint test**

Create `apps/api/tests/unit/test_render_blueprint.py`:

```python
"""Pins the load-bearing fields of the repo-root ``render.yaml`` Blueprint.

A malformed Blueprint fails silently at deploy time on Render; these asserts
give the migration a green/red signal in the normal pytest run. The values
mirror the migration design spec
(``docs/superpowers/specs/2026-06-23-render-backend-migration-design.md``).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

# apps/api/tests/unit/test_render_blueprint.py -> repo root is 4 parents up.
_REPO_ROOT = Path(__file__).resolve().parents[4]
_RENDER_YAML = _REPO_ROOT / "render.yaml"


def _service() -> dict[str, Any]:
    data: dict[str, Any] = yaml.safe_load(_RENDER_YAML.read_text())
    services: list[dict[str, Any]] = data["services"]
    assert len(services) == 1, "expected exactly one Render service"
    return services[0]


def test_render_blueprint_is_a_free_docker_web_service() -> None:
    svc = _service()
    assert svc["type"] == "web"
    assert svc["runtime"] == "docker"
    assert svc["dockerfilePath"] == "./Dockerfile"
    assert svc["plan"] == "free"
    assert svc["healthCheckPath"] == "/v1/health"


def test_render_blueprint_migrates_then_serves_on_injected_port() -> None:
    cmd: str = _service()["dockerCommand"]
    assert "alembic upgrade head" in cmd
    assert "uvicorn api.main:app" in cmd
    # Render injects $PORT; the command must bind it, not a hardcoded port.
    assert "$PORT" in cmd


def test_render_blueprint_declares_required_secrets_uncommitted() -> None:
    env_vars = {e["key"]: e for e in _service()["envVars"]}
    for key in ("DATABASE_URL", "JWT_SECRET", "APPLE_BUNDLE_ID"):
        assert key in env_vars, f"{key} must be declared"
        assert env_vars[key]["sync"] is False, f"{key} must be sync:false (uncommitted)"
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && python -m pytest -q tests/unit/test_render_blueprint.py`
Expected: FAIL — `render.yaml` does not exist (`FileNotFoundError` in `read_text`).

- [ ] **Step 3: Create `render.yaml`**

Create `render.yaml` at the repo root:

```yaml
# Render Blueprint — TESTING-ONLY backend host (free, no credit card).
# The production launch host is Fly or Railway (>=1GB so /v1/diagnose's
# mediapipe works + no cold starts); see docs/deploy-api-render.md and
# docs/superpowers/specs/2026-06-23-render-backend-migration-design.md.
#
# Builds the host-agnostic root Dockerfile. Migrations run here (single free
# instance => no race) via dockerCommand, NOT in the Dockerfile CMD.
# TRADEOFF (accepted, testing-only): chaining `alembic upgrade head` into
# dockerCommand makes a live Supabase connection a BOOT dependency -- if the DB
# is paused/unreachable, /v1/health never comes up. The launch host should move
# migration to a dedicated pre-deploy/release phase (Render: preDeployCommand)
# so DB issues don't take down a healthy instance.
services:
  - type: web
    name: pov-api
    runtime: docker
    branch: main
    dockerfilePath: ./Dockerfile
    dockerContext: .
    plan: free
    region: singapore
    healthCheckPath: /v1/health
    dockerCommand: sh -c "cd /app/apps/api && alembic upgrade head && cd /app && uvicorn api.main:app --host 0.0.0.0 --port $PORT"
    envVars:
      # Required — set the values in the Render dashboard (never committed).
      - key: DATABASE_URL
        sync: false
      - key: JWT_SECRET
        sync: false
      - key: APPLE_BUNDLE_ID
        sync: false
      # Optional — uncomment/set in the dashboard to enable the feature:
      #   ADMIN_TOKEN   -> /v1/admin/recipes (seed published recipes)
      #   FAL_API_KEY   -> /v1/generate + admin Fal.ai preview
      #   SENTRY_DSN_API-> error reporting
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/api && python -m pytest -q tests/unit/test_render_blueprint.py`
Expected: PASS (3 tests).

- [ ] **Step 5: Update the `.env.example` API-base-URL comment**

In `.env.example`, find the comment block listing the API base URL (around line 154, currently mentions `Fly.io production: https://pov-api.fly.dev`). Update it to reflect the testing host while keeping Fly as the launch note. Change:

```
#   - Fly.io production:       https://pov-api.fly.dev
```

to:

```
#   - Render (testing host):   https://pov-api.onrender.com
#   - Fly.io (launch host):    https://pov-api.fly.dev   (suspended during testing)
```

(If the surrounding lines differ slightly, preserve their style — this is a comment-only edit; do not change any actual env keys.)

- [ ] **Step 6: Python quality gate**

Run: `cd apps/api && python -m black --check src tests && python -m ruff check src tests && python -m mypy --strict src`
Expected: clean. (mypy runs on `src` only, so the new test file is not type-checked; black/ruff cover `tests`.)

- [ ] **Step 7: Commit**

```bash
git add render.yaml apps/api/tests/unit/test_render_blueprint.py .env.example
git commit -m "feat(deploy): add Render Blueprint (free Docker, migrate-on-deploy) + validity test"
```

---

## Task 2: Re-point mobile API base URL to Render + guard test

> **URL is a PLACEHOLDER until confirmed (codex R1+R2 high).** The Render
> service is not created until the operator runs the runbook (Task 3 writes the
> runbook; service creation is a post-merge operator step), so Task 1/2 commit
> `https://pov-api.onrender.com` as a **deliberate, best-guess placeholder**, not
> a confirmed value. This is acceptable ONLY because the correction loop is
> explicit: Task 4 §4 requires the operator to confirm the real subdomain and
> land a one-line `eas.json`/`.env.example`/runbook follow-up if it differs, and
> §5 OTA verification cannot pass against a wrong URL. The guard test is
> pattern-based (`*.onrender.com`), so it will NOT catch a wrong-but-well-formed
> subdomain — confirmation is manual and is a blocking acceptance gate, not a CI
> gate. If you happen to know the real URL before this task (e.g. the operator
> pre-created the service), substitute it everywhere now and skip the follow-up.

**Files:**
- Modify: `apps/mobile/src/config/api-base-url.ts` (1 line — bracket→dot, R1 critical)
- Create: `apps/mobile/tests/api-base-url-inlining.test.ts`
- Create: `apps/mobile/tests/eas-api-base-url.test.ts`
- Modify: `apps/mobile/eas.json` (the 4 build profiles)

**Interfaces:**
- Consumes: the Render service URL confirmed in Task 3 step 1 (placeholder `https://pov-api.onrender.com` until then).
- Produces: `getApiBaseUrl()` reading an inlinable dot-notation env access; every `eas.json` build profile's `env.EXPO_PUBLIC_API_BASE_URL` set to the same `https://<sub>.onrender.com` value; guard tests enforcing both.

- [ ] **Step 0: Fix the env access so Expo actually inlines it (R1 critical)**

First write the failing source-guard test `apps/mobile/tests/api-base-url-inlining.test.ts`:

```typescript
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/config/api-base-url.ts', import.meta.url),
  'utf-8',
);

describe('getApiBaseUrl env access is inlinable by Expo', () => {
  it('uses literal dot-notation process.env access (babel-preset-expo inlines only this form)', () => {
    expect(source).toContain('process.env.EXPO_PUBLIC_API_BASE_URL');
  });

  it('does not use bracket/computed env access (NOT inlined into the bundle)', () => {
    expect(source).not.toMatch(/process\.env\[/);
  });
});
```

Run `cd apps/mobile && pnpm vitest run tests/api-base-url-inlining.test.ts` — expect FAIL (current source uses `process.env[API_BASE_URL_ENV_KEY]`).

Then edit `apps/mobile/src/config/api-base-url.ts` so `getApiBaseUrl()` reads the env var by **literal dot notation**, preserving the empty-string-on-unset / trailing-slash-trim contract:

```typescript
export function getApiBaseUrl(): string {
  const raw = process.env.EXPO_PUBLIC_API_BASE_URL;
  if (raw === undefined || raw.length === 0) {
    return '';
  }
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}
```

Keep `API_BASE_URL_ENV_KEY` exported (other modules/tests reference it) — it just no longer gates the runtime read. Re-run the inlining test (PASS) and the existing config/transport tests (still green: the empty-string fallback is unchanged in the vitest node env, where the var is unset).

- [ ] **Step 1: Write the failing guard test**

Create `apps/mobile/tests/eas-api-base-url.test.ts`:

```typescript
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface EasBuildProfile {
  readonly env?: { readonly EXPO_PUBLIC_API_BASE_URL?: string };
}
interface EasConfig {
  readonly build: Record<string, EasBuildProfile>;
}

const easConfig = JSON.parse(
  readFileSync(new URL('../eas.json', import.meta.url), 'utf-8'),
) as EasConfig;

const apiBaseUrls: readonly string[] = Object.values(easConfig.build)
  .map((profile) => profile.env?.EXPO_PUBLIC_API_BASE_URL)
  .filter((url): url is string => typeof url === 'string');

describe('eas.json EXPO_PUBLIC_API_BASE_URL', () => {
  it('no longer points at the suspended Fly backend', () => {
    expect(apiBaseUrls.length).toBeGreaterThan(0);
    for (const url of apiBaseUrls) {
      expect(url).not.toContain('fly.dev');
    }
  });

  it('points every build profile at the same Render https URL', () => {
    for (const url of apiBaseUrls) {
      expect(url).toMatch(/^https:\/\/[a-z0-9-]+\.onrender\.com$/);
    }
    expect(new Set(apiBaseUrls).size).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/mobile && pnpm vitest run tests/eas-api-base-url.test.ts`
Expected: FAIL — all four URLs are still `https://pov-api.fly.dev` (fails both assertions).

- [ ] **Step 3: Update `eas.json`**

In `apps/mobile/eas.json`, replace every occurrence (4 total — the `development-simulator`, `development`, `preview`, `production` profiles) of:

```json
        "EXPO_PUBLIC_API_BASE_URL": "https://pov-api.fly.dev",
```

with:

```json
        "EXPO_PUBLIC_API_BASE_URL": "https://pov-api.onrender.com",
```

(Use a replace-all; the four lines are identical. Change nothing else in the file.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/mobile && pnpm vitest run tests/eas-api-base-url.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Mobile TS quality gate**

Run: `pnpm --filter mobile run typecheck && pnpm --filter mobile run lint && pnpm --filter mobile run format:check`
Expected: clean. (The new `.ts` test is type-checked + prettier-checked; `eas.json` is JSON, outside the prettier glob.)

- [ ] **Step 6: Commit**

```bash
# MUST include the Step 0 source fix + its guard test, or the OTA-inlining fix
# is silently dropped from the branch (codex R2 critical).
git add apps/mobile/src/config/api-base-url.ts \
        apps/mobile/tests/api-base-url-inlining.test.ts \
        apps/mobile/eas.json \
        apps/mobile/tests/eas-api-base-url.test.ts
git commit -m "fix(mobile): inlinable dot-notation API base URL + point at Render + guard tests"
```

---

## Task 3: Render deploy runbook + Fly doc deprecation header

**Files:**
- Create: `docs/deploy-api-render.md`
- Modify: `docs/deploy-api-fly.md` (top-of-file header note only)

**Interfaces:**
- Consumes: `render.yaml` (Task 1), the new `eas.json` URL (Task 2).
- Produces: an operator runbook; no code/test.

- [ ] **Step 1: Write `docs/deploy-api-render.md`**

Create `docs/deploy-api-render.md`:

````markdown
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
````

- [ ] **Step 2: Add the deprecation header to `docs/deploy-api-fly.md`**

At the very top of `docs/deploy-api-fly.md` (above the existing first line), insert:

```markdown
> **⚠️ DEPRECATED for the testing phase (2026-06-23).** The Fly app `pov-api`
> is suspended (free trial ended). The backend currently runs on Render — see
> [`deploy-api-render.md`](./deploy-api-render.md). Revisit Fly at launch (it
> needs a credit card; ≥1GB for `/v1/diagnose`). This runbook is kept for that
> launch-time revert.

---
```

- [ ] **Step 3: Commit**

```bash
git add docs/deploy-api-render.md docs/deploy-api-fly.md
git commit -m "docs(deploy): Render runbook + deprecate Fly runbook for the testing phase"
```

---

## Task 4: Full gates + PR + post-merge move verification

**Files:** none (verification + PR).

> **Acceptance is the backend MOVE, not the merge (codex R1 high).** The goal is
> "device testing can resume," so merging the config is necessary but not
> sufficient. Steps 4–5 below are **blocking acceptance** for the migration to be
> considered done — they require operator accounts/creds and run post-merge
> against the live Render service + `eas.json`'s confirmed URL. A green CI is not
> "done"; a device fetching the catalog from `*.onrender.com` is.

- [ ] **Step 1: Run the full per-language gates**

Run (Python): `cd apps/api && python -m pytest -q && python -m black --check src tests && python -m ruff check src tests && python -m mypy --strict src`
Run (TS): `pnpm -r run typecheck && pnpm -r run test && pnpm -r run lint && pnpm -r run format:check`
Expected: all green. (Python integration tests that need Postgres may be skipped/fail locally without `DATABASE_URL_TEST` — that is environmental and not introduced by this change; note it but it does not block.)

- [ ] **Step 2: Push the branch**

```bash
git push -u origin chore/backend-render-migration
```

- [ ] **Step 3: Open the PR**

```bash
gh pr create --title "chore(deploy): migrate backend to Render (testing host) — Fly trial ended" \
  --body "Fly app \`pov-api\` is suspended (free trial ended). Adds a free, no-card **Render** Docker Blueprint (\`render.yaml\`) that builds the existing root Dockerfile, runs \`alembic upgrade head\` then uvicorn on \$PORT (single free instance ⇒ no migration race; migration is an accepted boot dependency for the testing host), with Supabase unchanged. Re-points mobile \`EXPO_PUBLIC_API_BASE_URL\` to the Render URL (guard test enforces no fly.dev + one shared *.onrender.com URL) and fixes \`getApiBaseUrl()\` to dot-notation env access so Expo actually inlines the URL into the OTA bundle. Adds a Render runbook + deprecates the Fly runbook for the testing phase. Testing-only — launch reverts to Fly/Railway (≥1GB for /v1/diagnose). Known limits: 512MB (diagnose may OOM), cold starts. Post-merge operator steps (create service, set secrets, resume Supabase, seed recipe, \`eas update\`) gate device verification — see runbook + design spec docs/superpowers/specs/2026-06-23-render-backend-migration-design.md."
```

> **Note — replace the guessed URL before merge.** If the real Render subdomain
> is not `pov-api.onrender.com`, update `eas.json` / `.env.example` / runbook / this
> PR body to the confirmed `*.onrender.com` first (Task 2 blocking precondition).

- [ ] **Step 4: Post-merge — deploy + smoke the Render service (blocking acceptance)**

After merge, the operator runs the runbook (`docs/deploy-api-render.md`) §1–§4:
create the Blueprint service, set the secrets, un-pause Supabase, deploy, then
smoke `GET $APP/v1/health` → `{"status":"ok"}` and `GET $APP/v1/recipes` → 401.
Confirm the migration (`alembic upgrade head`) ran in the deploy logs. If the real
URL ≠ `pov-api.onrender.com`, land a follow-up one-line `eas.json` correction.

- [ ] **Step 5: Post-merge — OTA verify on-device (blocking acceptance)**

Seed a published recipe (runbook §6), publish the OTA bundle with the origin
inlined into the update env (`EXPO_PUBLIC_API_BASE_URL=$APP eas update --channel
production …`, runbook §7 — `--environment` alone does NOT read `eas.json`),
then on the installed TestFlight build: Apple Sign In → catalog tab → cards
render, with logs/breadcrumb confirming the `onrender.com` origin. Only then is
the migration "done."

---

## Self-Review Notes

- **Spec coverage:** Render free Docker service (Task 1 `render.yaml`); `$PORT` bind + migrate-via-`dockerCommand` (Task 1 + its test); Supabase unchanged (no DB task — intentional); secrets `sync:false` incl. corrected `FAL_API_KEY`-optional framing (Task 1 yaml comments + secret asserts); mobile URL re-point + guard test (Task 2); runbook + Fly deprecation + launch revert path (Task 3); no app-code change (constraint, honored — only config/docs/tests touched).
- **Type/name consistency:** the chosen URL `https://pov-api.onrender.com` is used identically in `render.yaml` service name, `.env.example`, `eas.json`, and the runbook; the guard regex `https://<sub>.onrender.com` matches it; the Blueprint test asserts the exact `dockerCommand` tokens (`alembic upgrade head`, `uvicorn api.main:app`, `$PORT`) that the yaml contains.
- **Deferred (not in this plan):** creating the Render account/service, setting dashboard secrets, un-pausing Supabase, seeding a recipe, and running `eas update` are operator steps in the runbook (require the user's accounts/creds) — but per Task 4 §4–§5 they are now **blocking acceptance** for the migration to count as done, not silently dropped.
- **OTA correctness (R1 critical):** the URL only reaches the device because `getApiBaseUrl()` now uses literal dot-notation env access (Task 2 Step 0) and the OTA is published with the production environment resolved (`eas update … --environment production`). Both are guarded/tested.

---

## Revisions

- 2026-06-24 R2: codex review R2 — applied 2 critical + 1 high (R2 also confirmed 3 R1 items closed). (C) Task 2 commit `git add` omitted the Step 0 source fix + inlining test → would push a branch without the OTA fix; commit now stages all four files. (C) `eas update --environment production` reads EAS-stored env vars, NOT `eas.json build.*.env` → runbook §7 + Task 4 §5 now use the inline `EXPO_PUBLIC_API_BASE_URL=$APP eas update …` form (with the `eas env:create` alternative documented). (H) Made the committed `pov-api.onrender.com` an explicit placeholder tied to the Task 4 §4 confirm-or-correct loop.
- 2026-06-24 R1: codex review R1 — applied 2 critical + 3 high. (C) OTA inlining was broken (bracket env access not inlined by Expo) → added Task 2 Step 0 dot-notation fix + inlining guard test; (C) `eas update` now passes `--environment production` + bundle/device verification. (H) URL-before-service-exists made a blocking precondition; (H) Task 4 gained post-merge deploy-smoke + OTA on-device blocking acceptance; (H) migration-as-boot-dependency explicitly accepted + documented (`preDeployCommand` flagged for launch host). Codex confirmed `runtime:docker`/`dockerCommand` correct and the `parents[4]` / `../eas.json` paths correct (no change).
