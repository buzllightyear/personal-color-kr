# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`personal-color-kr` is a Korean-market selfie app. The **product** is a **trend-recipe AI selfie generator** (operator-curated recipes → fal.ai image generation → gallery). The personal-color **diagnosis** is a **one-time acquisition hook / marketing device** — it pulls users in and feeds the 12-step "Glam Up" payment funnel, but it does **not** personalize or otherwise feed image generation. (Concretely: the `{personal_color_modifier}` placeholder in a recipe's `prompt_template` is intentionally left un-expanded; diagnosis output never reaches the generation pipeline. Recipes are designed **trend-centric**, not personal-color-centric.) It's a monorepo with three apps and two shared packages. UI copy is Korean and **hardcoded (no i18n)** — Korean strings live in source.

| Workspace | Stack | Role |
|---|---|---|
| `apps/mobile` | Expo SDK 54, React Native 0.81, Expo Router, TypeScript | The app — the 12-step funnel + the content-generation tabs |
| `apps/api` | FastAPI, Python 3.12, async SQLAlchemy + Alembic | Backend HTTP API, `/v1` prefix |
| `apps/web` | Next.js, TypeScript (vitest + Playwright) | Operator **admin** UI (recipe lifecycle) + marketing landing page |
| `packages/core-ts` | TypeScript (vitest) | Shared **funnel content/order + analytics contracts**; consumed by mobile via subpath exports |
| `packages/core-python` | Python (pytest) | Diagnosis ML pipeline **+ the fal.ai content-generation pipeline** (`personal_color.generate`); installed editably into `apps/api` |

TS workspaces use **pnpm** (pnpm 10, pinned via the root `packageManager: "pnpm@10.x"` field; `lockfileVersion 9.0`). Python uses editable `pip install -e`. **Use pnpm 10 locally** (corepack honors `packageManager`) — a lockfile written by pnpm 9 stores `patchedDependencies` with a different hash algorithm and CI's `pnpm install --frozen-lockfile` then rejects it (`ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`). pnpm 10 also does **not** run dependency build scripts unless allowlisted: `pnpm.onlyBuiltDependencies` lists the four that need it (`@sentry/cli`, `esbuild`, `sharp`, `unrs-resolver`) — adding a dep with a postinstall/native build step means adding it there too, or vitest/eslint/web-build silently break.

## Commands

Run from the **workspace directory**, not the repo root, unless using `--filter`.

```bash
# Mobile (apps/mobile)
pnpm --filter mobile run typecheck      # tsc --noEmit
pnpm --filter mobile run test           # vitest (node env)
pnpm --filter mobile run lint           # eslint app src tests
pnpm --filter mobile run format:check   # prettier --check
cd apps/mobile && pnpm vitest run tests/request-diagnosis.test.ts   # single test file
cd apps/mobile && pnpm vitest run -t "graceful"                     # single test by name

# core-ts (packages/core-ts) and apps/web — same script names: typecheck / test / lint / format:check
#   (apps/web also has Playwright e2e for the admin UI)

# apps/api (Python; run from apps/api)
python -m pytest -q                     # all
python -m pytest -q tests/test_x.py::test_y     # single
python -m black --check src tests
python -m ruff check src tests
python -m mypy --strict src             # strict; src only
```

**CI runs all of these as a 4-fold gate per language** (TS: typecheck + vitest + prettier + eslint; Python: black + ruff + mypy --strict + pytest). Vitest passing is **not** sufficient — CI also runs `pnpm -r run format:check && pnpm -r run lint`, so run those before pushing.

### Running locally

```bash
# Backend
cp .env.example .env                                    # then fill DATABASE_URL, JWT_SECRET, APPLE_BUNDLE_ID
docker-compose up -d postgres                           # local Postgres 16 (matches POSTGRES_* in .env)
pip install -e packages/core-python -e apps/api         # editable installs (once)
cd apps/api && alembic -c alembic.ini upgrade head      # migrations (cwd must be apps/api)
cd apps/api && uvicorn api.main:app --reload --port 8000

# Mobile dev client (needs a built dev-client on the simulator)
cd apps/mobile && EXPO_PUBLIC_API_BASE_URL=http://localhost:8000 npx expo start --dev-client -c
```

The API reads the **root `.env`** at startup (`src/api/config/env.py`); `DATABASE_URL` (asyncpg URL — must use `postgresql+asyncpg://`) and `JWT_SECRET` are required. `uvicorn` boots without them but DB and auth endpoints then fail. The integration test tier uses `DATABASE_URL_TEST`. Content generation additionally reads `FAL_API_KEY` (required to actually call fal.ai), `ADMIN_TOKEN` (admin routes), and the optional `S3_*` / `IMAGE_TTL_DAYS` (absent → in-memory image store); all default-absent so the app still boots — see `.env.example`.

Always run `eas`/`expo` commands from `apps/mobile`, never the repo root — running from root creates a stray root `app.json` stub and trips npm-vs-pnpm detection. The root `packageManager: "pnpm@10.x"` field is intentional (it pins one pnpm major across CI, EAS Build, and local via corepack) — keep it; do not remove it. Note `eas update`/`eas update:configure` re-injects an `updates.url` / `runtimeVersion` / `usesAppleSignIn` block into `apps/mobile/app.json`; that injected block is redundant **because `app.config.ts` is canonical and explicitly sets `updates.url` + `runtimeVersion` itself** — revert the app.json churn (and the auto-incremented `ios.buildNumber`). **CRITICAL — do NOT remove `updates.url` from `app.config.ts`:** it is NOT derived from `extra.eas.projectId`. Without an explicit `updates.url`, builds ship `EXUpdatesEnabled=false` and silently never receive any `eas update` OTA — which forces needless full native rebuilds for JS-only changes (this exact misconception cost a day; fixed #101). Also: `eas update` defaults to `--platform=all`, and the **Android** bundle currently fails on `@superwall/react-native-superwall`'s `require('../package.json')` (package-exports resolution in the pnpm monorepo) — publish iOS OTAs with `eas update --platform ios` (Android isn't a launch target yet).

## Architecture

### Shared-contract pattern (the key cross-cutting idea)

`packages/core-ts` is the **single source of truth** for the funnel: screen content, the 12-step order (`FUNNEL_KEBAB_SLUGS_ORDERED`), copy (`FUNNEL_SCREENS`), and analytics event shapes. The mobile app imports these via subpath exports (`core-ts/funnel`, `core-ts/analytics`, etc.; see `packages/core-ts/package.json` `exports`). **core-ts content is treated as frozen — its contract tests pin the values.** When a screen needs dynamic content (e.g. a real diagnosed category replacing a static teaser), **override at the app layer** rather than mutating core-ts.

`packages/core-python` owns **two** pipelines, installed editably so `apps/api` imports them as `personal_color.*`:
- **Diagnosis** — Pillow decode → MediaPipe face detect → rule-based tone/contrast/season classification. **Deterministic, no LLM/fal.ai.**
- **Content generation** (`personal_color.generate`) — the fal.ai image pipeline: `fal_client` (vendor seam, httpx), `orchestrator` (generate → reject → retry within a 30 s budget), `rejection` (NSFW/artifact reject filter), `watermark` (server-side compositing). This one **does** call fal.ai.

### Mobile funnel (apps/mobile)

Expo Router file-based routing under `app/`. The funnel lives in `app/(funnel)/`, one file per step.

- **Route files are thin**: they own `expo-router` hooks and all side-effects (navigation, network, BackHandler). **Screen components are pure props-in / callbacks-out** and unit-test without any router or provider context. Keep this split — it's why the test suite can render screens directly.
- **State** flows through `FunnelStateProvider` (`src/providers/`), a React Context scoped to `app/(funnel)/_layout.tsx` (not the root layout). It holds several **independent immutable slices** (`onboarding`, `diagnosisInput`, `diagnosis`, `referral`, `payment`, `auth`), each with its own frozen `INITIAL_*` constant and a spread-merge updater. Contract types live in `src/contracts/funnel-state.ts`; the shape is pinned by `tests/funnel-state-contract.test.ts` — adding a slice/field means updating both.
- **API clients** follow a transport-seam pattern (`src/request-diagnosis.ts`, `src/fetch-referral-me.ts`, `src/submit-sign-in-with-apple.ts`): a pure wire→camel mapper + a dependency-injected `fetch`-backed transport factory, so the mapping is unit-tested without a live HTTP client. Server JSON is snake_case; client projections are camelCase. `EXPO_PUBLIC_API_BASE_URL` (via `src/config/api-base-url.ts`) is the API origin.
- **Auth**: step 7 (`diagnosis-input`) is the **Apple Sign In gate**. The native seam is `src/acquire-apple-credential.ts` (`expo-apple-authentication`) → `src/sign-in-with-apple-transport.ts` posts to `/v1/auth/sign-in-with-apple` → the minted JWT is persisted to the Keychain via `src/storage/auth-token-storage.ts` (`expo-secure-store`); `src/run-sign-in.ts` orchestrates the three and never throws. The route renders `DiagnosisSignInGateScreen` until `auth.status === 'signed_in'`, then `DiagnosisInputScreen`. Token resolution is `src/config/auth-token.ts` `getAuthToken()`: **Keychain token wins**, falling back to the throwaway `EXPO_PUBLIC_DEV_AUTH_TOKEN` dev seam (`src/config/dev-auth-token.ts`). The gate checks token **presence, not validity**, so auth self-heals at the call site: authed transports throw a typed `ApiError(status)` (`src/api-error.ts`), and a 401 from any authed call (catalog/gallery/generate) runs `clearTokenOnUnauthorized` (`src/clear-token-on-unauthorized.ts`) to discard the stored token so the gate re-shows and the user re-auths — covering token expiry + a rotated `JWT_SECRET` with no reinstall (#103). Sign-in failure copy distinguishes an unreachable backend (`httpStatus === null`) from a rejection (non-200) via `src/sign-in-error-message.ts`.
- **Diagnosis flow**: `diagnosis-input` (capture selfie via `src/pick-selfie.ts` / `expo-image-picker`) → `fake-scan-animation` route fires `POST /v1/diagnose` behind the 5s overlay (`src/run-diagnosis.ts`) → `result-reveal` reads the `diagnosis` slice. It **degrades gracefully**: with no auth token or a `stub://` selfie URI, the call no-ops and the static teaser renders.
- **Content-generation tabs**: `app/(generate)/(tabs)/` hosts the `catalog` (recipes) and `gallery` tabs; `app/(generate)/generate.tsx` is the generation route. Same thin-route / pure-screen + transport-seam pattern (`src/fetch-recipe-catalog.ts`, `src/request-generation.ts`, `src/fetch-gallery.ts`; screens in `src/screens/generate/`). Camera-roll save is the `src/save-to-camera-roll.ts` seam.

### API (apps/api)

FastAPI app constructed in `src/api/main.py`, all routes under the `/v1` prefix (`src/api/routers/`: `auth`, `diagnose`, `events`, `referrals`, `health`, `version`, `metrics`, plus the content-gen routers `recipes`, `admin_recipes`, `generate`, `gallery`). Auth is **Apple Sign In only** — `POST /v1/auth/sign-in-with-apple` mints an HS256 JWT; user-facing routes require it via the `require_current_user` dependency. The `/v1/admin/recipes` routes are guarded separately by a static `ADMIN_TOKEN` bearer (operator-only). Postgres access is async (asyncpg); use the **session pooler (port 5432)**, not the transaction pooler (6543), which breaks asyncpg prepared statements.

**SQLAlchemy import boundary (AC11):** every `sqlalchemy*` import must live inside `src/api/db/` — a grep gate enforces it. Routers/services consume `AsyncSession`, `select`, `Select`, `func`, `session_scope`, etc. **re-exported from `api.db.session`**, never `from sqlalchemy ...` directly. Adding a query helper outside `api/db/` means re-exporting the type from the boundary first.

### Content generation (apps/api + apps/mobile + apps/web)

The product surface beside diagnosis. Operator curates **recipes**, users turn a selfie + recipe into a watermarked AI image, and browse their **gallery**.

- **Recipes**: `recipes` table (lifecycle `hidden ↔ published → deleted`). `GET /v1/recipes` is the auth-gated public catalog (published-only); `/v1/admin/recipes` (CRUD + publish/hide + fal.ai preview) is the `ADMIN_TOKEN`-guarded operator API, fronted by the `apps/web` admin UI. Each recipe also carries **display metadata** for the catalog card: `title` (required), `description`, `tags` (string array; the seed for future themed collections), and `thumbnail_url` (a **public** HTTPS example image — no auth-gated streaming, unlike gallery results). The catalog is a **single flat list** today (sorted `publish_date DESC, display_order ASC`); collections are deferred until recipe volume warrants them.
- **Generate**: `POST /v1/generate` (auth, multipart `selfie` + `recipe_id`) runs the `personal_color.generate` orchestrator (generate → reject → retry ≤30 s) → server-side watermark → returns the PNG inline. The fal.ai vendor seam is behind `Depends(get_generate_runner)`; tests stub it.
- **Storage + gallery**: the watermarked result (never the original selfie — zero-PII) is persisted to object storage + a `generations` row (`expires_at = now + IMAGE_TTL_DAYS`, default 30). Object storage is an `ObjectStorage` seam (`api/storage/`): `S3ObjectStorage` (httpx + hand-rolled SigV4, **no boto3**) when `S3_*` env is set, else an in-memory fallback so the flow works locally. `GET /v1/gallery` lists non-expired rows; `GET /v1/gallery/{id}/image` streams the bytes through an authenticated, ownership-scoped endpoint (**no presigned URLs**). TTL: read-time filter hides expired rows; `api.services.generation_sweep.run_sweep()` (out-of-band cron) reclaims rows + objects.
- **Metric (AC3)**: each `POST /v1/generate` tags the Sentry transaction with `generation.outcome` + `retry_count` (`api/observability/generation_metrics.py`) for a rolling success rate.

## When you touch X, also update Y

This repo's cross-file obligations, gathered as one index — change the left and you **must** also touch the middle, or the right breaks (often silently, past a green local run). Each row is detailed inline where its subsystem is described above; this table just makes the pairs hard to miss.

| Change | Also update | If you don't |
|---|---|---|
| Add a dep with a postinstall / native build step | `pnpm.onlyBuiltDependencies` in the root `package.json` | pnpm 10 skips its build script → `vitest` / `eslint` / web build silently break |
| Add a runtime dep to `apps/api/pyproject.toml` `[project].dependencies` | the allowlist in `apps/api/tests/test_diff_no_new_runtime_deps.py` | `test_diff_no_new_runtime_deps` fails — the dep set must equal the AC19 allowlist exactly |
| Import a native module from rendered `apps/mobile` code | add a stub under `tests/__stubs__/` + a `resolve.alias` in `apps/mobile/vitest.config.ts` | mobile vitest crashes at module load (Flow / native syntax is unparseable in the `node` env) |
| Add a top-level Expo Router `(group)` under `apps/mobile/app/` | wire an inbound `router.push('/(group)/…')` with the explicit group token, **or** add an `ALLOWLIST` entry (with a reason) in `scripts/check-route-reachability.mjs` | CI **Route reachability** step fails — built-but-unwired orphan (docs/decisions/0002) |
| Add/change a field on a mobile contract type (`src/contracts/funnel-state.ts`, `src/contracts/post-payment-views.ts`) | the matching `tests/funnel-state-contract.test.ts` / `tests/post-payment-views-contract.test.ts` | the compile-level contract test stops type-checking → `pnpm --filter mobile typecheck` / vitest red |
| Need different funnel copy/order/screens (core-ts `FUNNEL_SCREENS`, `FUNNEL_KEBAB_SLUGS_ORDERED`) | **override at the app layer** — don't mutate core-ts; a deliberate core-ts value change must update `packages/core-ts/tests/funnel/screens.test.ts` | the frozen-content test fails |
| Add a core-ts module meant to be imported by mobile | register the subpath in `packages/core-ts/package.json` `exports` | `import … from 'core-ts/<sub>'` fails to resolve (typecheck + runtime) |
| Need `sqlalchemy*` (`select`, `func`, `Select`, …) outside `apps/api/src/api/db/` | re-export it from `api.db.session` first, then import from there — never `from sqlalchemy …` | `tests/test_sqlalchemy_import_boundary.py::test_sqlalchemy_imports_live_only_inside_db_boundary` fails (AC11 grep gate) |
| Add/alter an ORM model under `apps/api/src/api/db/models/` | add an Alembic revision under `api/db/migrations/versions/` (`target_metadata = Base.metadata`) | the schema drifts from the model — CI **Alembic upgrade head** + the integration tier run migrations, not `create_all`, so the new column never reaches Postgres |
| Read a new server-side env var in `apps/api` | add an accessor in `apps/api/src/api/config/env.py` + document it in `.env.example` | convention, no CI gate — an undocumented absent-default var silently no-ops in prod and reads bypass the single seam |
| Add a recipe field | model `api/db/models/recipe.py` (+ migration), Pydantic `api/schemas/recipes.py`, handlers `api/routers/admin_recipes.py`, admin UI `apps/web` (`src/types/recipe.ts` + `src/components/admin/RecipeForm.tsx`), mobile mapper `apps/mobile/src/fetch-recipe-catalog.ts` (+ catalog card) | no single gate catches a *missed* surface — the field just won't round-trip (operator can't set it, or the card never shows it) |

## Conventions & gotchas

- **Decisions & completeness.** Cross-cutting decisions live as ADRs in `docs/decisions/` (toolchain pinning → 0001; feature reachability + the ratchet/critic/DoD strategy → 0002). Before calling a user-facing feature "done", run `docs/review-checklist.md` (reachability, integration, tracked deferrals). New Expo Router groups are reachability-gated in CI (`scripts/check-route-reachability.mjs`) — a built-but-unwired group fails the build.
- **`exactOptionalPropertyTypes: true`** is on at the root tsconfig. Use `| null` (not `| undefined`) for "absent" fields, and conditionally **spread** optional props (`{...(x !== undefined ? { x } : {})}`) rather than passing `undefined`.
- **Mobile vitest runs in a `node` env** and cannot parse native modules. Native imports are aliased to inert stubs in `apps/mobile/vitest.config.ts` (`use-app-fonts`, `react-native-svg`, `expo-image-picker`, `expo-linking`, `expo-apple-authentication`, `expo-secure-store`, `expo-media-library`, `expo-file-system`). A new native dependency that gets imported in rendered code needs a stub + alias there.
- **Async capture/press handlers**: tap-and-assert tests must use `await act(async () => { onPress(); })` (react-test-renderer) since handlers now await.
- **`expo-file-system` on SDK 54**: the classic `downloadAsync` / `cacheDirectory` helpers moved to the `expo-file-system/legacy` entrypoint, whose **TS source** trips the repo's strict `exactOptionalPropertyTypes` when pulled into `tsc`. Use the new `File` / `Directory` / `Paths` API from the package root instead (it resolves to published `.d.ts`, which `skipLibCheck` skips) — see `src/save-to-camera-roll.ts`.
- **Prettier** is the formatter (`printWidth: 88`, single quotes, semicolons); `black` uses the same 88-column width on the Python side. Lint (`eslint` / `ruff`) and types (`tsc` / `mypy --strict`) target `src`/`app` only.
- **`pytest` is pinned `<9.1`** in CI — 9.1.0 changed caplog and breaks the Sentry fail-open tests. If local passes but CI fails, check the resolved dependency versions first.
- Native iOS builds go through **EAS** (`eas.json` profiles); local `expo run:ios` may fail on a too-new Xcode for the SDK 54 / RN 0.81 toolchain. App + EAS config notes are in `docs/deploy-api-fly.md` and `docs/testflight-dry-run.md`; the design system is `docs/DESIGN.md` (monochrome Pretendard editorial — chrome is ink-ramp only, season colors reserved for the diagnosed result swatch).
