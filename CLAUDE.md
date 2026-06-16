# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`personal-color-kr` is a Korean-market selfie app: a personal-color **diagnosis** hook leading into a 12-step "Glam Up" payment funnel. It's a monorepo with two apps and two shared packages. UI copy is Korean and **hardcoded (no i18n)** — Korean strings live in source.

| Workspace | Stack | Role |
|---|---|---|
| `apps/mobile` | Expo SDK 51, React Native 0.74, Expo Router, TypeScript | The app — the 12-step funnel |
| `apps/api` | FastAPI, Python 3.12, async SQLAlchemy + Alembic | Backend HTTP API, `/v1` prefix |
| `packages/core-ts` | TypeScript (vitest) | Shared **funnel content/order + analytics contracts**; consumed by mobile via subpath exports |
| `packages/core-python` | Python (pytest) | Diagnosis ML pipeline + content logic; installed editably into `apps/api` |

TS workspaces use **pnpm** (pnpm 9, `lockfileVersion 9.0`). Python uses editable `pip install -e`.

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

# core-ts (packages/core-ts) — same script names: typecheck / test / lint / format:check

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

The API reads the **root `.env`** at startup (`src/api/config/env.py`); `DATABASE_URL` (asyncpg URL — must use `postgresql+asyncpg://`) and `JWT_SECRET` are required. `uvicorn` boots without them but DB and auth endpoints then fail. The integration test tier uses `DATABASE_URL_TEST`.

Always run `eas`/`expo` commands from `apps/mobile`, never the repo root — running from root creates a stray root `app.json` stub and trips npm-vs-pnpm detection. Do **not** add a `packageManager` field (it conflicts with the pnpm 9 CI setup).

## Architecture

### Shared-contract pattern (the key cross-cutting idea)

`packages/core-ts` is the **single source of truth** for the funnel: screen content, the 12-step order (`FUNNEL_KEBAB_SLUGS_ORDERED`), copy (`FUNNEL_SCREENS`), and analytics event shapes. The mobile app imports these via subpath exports (`core-ts/funnel`, `core-ts/analytics`, etc.; see `packages/core-ts/package.json` `exports`). **core-ts content is treated as frozen — its contract tests pin the values.** When a screen needs dynamic content (e.g. a real diagnosed category replacing a static teaser), **override at the app layer** rather than mutating core-ts.

`packages/core-python` owns the diagnosis pipeline (Pillow decode → MediaPipe face detect → rule-based tone/contrast/season classification — deterministic, no LLM/Fal.ai) and is installed editably so `apps/api` imports it as `personal_color.*`.

### Mobile funnel (apps/mobile)

Expo Router file-based routing under `app/`. The funnel lives in `app/(funnel)/`, one file per step.

- **Route files are thin**: they own `expo-router` hooks and all side-effects (navigation, network, BackHandler). **Screen components are pure props-in / callbacks-out** and unit-test without any router or provider context. Keep this split — it's why the test suite can render screens directly.
- **State** flows through `FunnelStateProvider` (`src/providers/`), a React Context scoped to `app/(funnel)/_layout.tsx` (not the root layout). It holds several **independent immutable slices** (`onboarding`, `diagnosisInput`, `diagnosis`, `referral`, `payment`), each with its own frozen `INITIAL_*` constant and a spread-merge updater. Contract types live in `src/contracts/funnel-state.ts`; the shape is pinned by `tests/funnel-state-contract.test.ts` — adding a slice/field means updating both.
- **API clients** follow a transport-seam pattern (`src/request-diagnosis.ts`, `src/fetch-referral-me.ts`, `src/submit-sign-in-with-apple.ts`): a pure wire→camel mapper + a dependency-injected `fetch`-backed transport factory, so the mapping is unit-tested without a live HTTP client. Server JSON is snake_case; client projections are camelCase. `EXPO_PUBLIC_API_BASE_URL` (via `src/config/api-base-url.ts`) is the API origin.
- **Diagnosis flow**: `diagnosis-input` (capture selfie via `src/pick-selfie.ts` / `expo-image-picker`) → `fake-scan-animation` route fires `POST /v1/diagnose` behind the 5s overlay (`src/run-diagnosis.ts`) → `result-reveal` reads the `diagnosis` slice. It **degrades gracefully**: with no auth token or a `stub://` selfie URI, the call no-ops and the static teaser renders. The dev JWT seam is `EXPO_PUBLIC_DEV_AUTH_TOKEN` (`src/config/dev-auth-token.ts`) — throwaway until Apple Sign In lands.

### API (apps/api)

FastAPI app constructed in `src/api/main.py`, all routes under the `/v1` prefix (`src/api/routers/`: `auth`, `diagnose`, `events`, `referrals`, `health`, `version`, `metrics`). Auth is **Apple Sign In only** — `POST /v1/auth/sign-in-with-apple` mints an HS256 JWT; `/v1/diagnose` (multipart `selfie` upload) requires it via the `require_current_user` dependency. Postgres access is async (asyncpg); use the **session pooler (port 5432)**, not the transaction pooler (6543), which breaks asyncpg prepared statements.

## Conventions & gotchas

- **`exactOptionalPropertyTypes: true`** is on at the root tsconfig. Use `| null` (not `| undefined`) for "absent" fields, and conditionally **spread** optional props (`{...(x !== undefined ? { x } : {})}`) rather than passing `undefined`.
- **Mobile vitest runs in a `node` env** and cannot parse native modules. Native imports are aliased to inert stubs in `apps/mobile/vitest.config.ts` (`use-app-fonts`, `react-native-svg`, `expo-image-picker`, `expo-linking`). A new native dependency that gets imported in rendered code needs a stub + alias there.
- **Async capture/press handlers**: tap-and-assert tests must use `await act(async () => { onPress(); })` (react-test-renderer) since handlers now await.
- **Prettier** is the formatter (`printWidth: 88`, single quotes, semicolons); `black` uses the same 88-column width on the Python side. Lint (`eslint` / `ruff`) and types (`tsc` / `mypy --strict`) target `src`/`app` only.
- **`pytest` is pinned `<9.1`** in CI — 9.1.0 changed caplog and breaks the Sentry fail-open tests. If local passes but CI fails, check the resolved dependency versions first.
- Native iOS builds go through **EAS** (`eas.json` profiles); local `expo run:ios` may fail on a too-new Xcode for the SDK 51 / RN 0.74 toolchain. App + EAS config notes are in `docs/deploy-api-fly.md` and `docs/testflight-dry-run.md`; the design system is `docs/DESIGN.md` (monochrome Pretendard editorial — chrome is ink-ramp only, season colors reserved for the diagnosed result swatch).
