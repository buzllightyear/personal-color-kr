# HANDOFF — content-gen-pipeline (AC4 remaining)

Branch: `worktree-content-gen-pipeline` (worktree `.claude/worktrees/content-gen-pipeline`).
Seed: `seed_409d0c0c0f3d` (interview_20260621_060602). Phase 1.

## Status — DONE & committed (all gates green)

| AC | What | State |
|----|------|-------|
| AC1 | Recipe catalog (API `GET /v1/recipes` + mobile catalog tab/screen) | ✅ |
| AC5 | Admin recipe lifecycle (API CRUD/migrations/admin_auth/fal preview + `apps/web/admin` Next.js UI + Playwright e2e) | ✅ |
| AC2 backend | `personal_color.generate` (fal_client, watermark, rejection, orchestrator) | ✅ 146 tests |
| AC2 e2e | `POST /v1/generate` endpoint + mobile transport (`src/request-generation.ts`) + `GenerationScreen` + `app/(generate)/generate.tsx` | ✅ |
| AC3 | Sentry request-level success metric (`api/observability/generation_metrics.py`, wired in generate router) | ✅ |

Salvage notes: the original ooo run (`exec_144c13c738a4`) stopped on **rate-limit**, not code defects. Real fixes made: `FalNsfwClassifier._ENDPOINT` typo, unused `type: ignore`, committed `build/` artifacts removed+gitignored, `apps/web` eslint flat config (replaced interactive `next lint`).

## AC4 — REMAINING (object storage + gallery + TTL)

Build with the **adapter/transport-seam pattern, secrets via env, stub-based tests** (user decision).

1. **Object storage adapter** (`apps/api/src/api/storage/` new):
   - `ObjectStorage` Protocol: `put(key, bytes, content_type) -> None`, `presign_get(key, ttl) -> str`, `delete(key) -> None`.
   - `R2ObjectStorage` (Cloudflare R2 / S3 via boto3 or httpx-signed) reading creds from env (`R2_ACCOUNT_ID`/`R2_ACCESS_KEY_ID`/`R2_SECRET`/`R2_BUCKET` or `S3_*`).
   - `InMemoryObjectStorage` stub for tests. DI via `get_object_storage()`.
2. **Generation/gallery DB model + migration**: a `generations` table mapping the ontology fields already in the seed (generation_id, user_id, recipe_id, original_image_key, result_image_key, reject_reason, retry_count, generation_status, expires_at, created_at). Alembic migration mirroring `recipe.py`'s migration style.
3. **Wire storage into `POST /v1/generate`**: after watermark, `put` original (server-only) + watermarked under per-user keys, persist a generation row with `expires_at = now + TTL`. Decide: return the watermarked bytes inline (current) AND/OR a presigned URL. Keep "original never egresses".
4. **Gallery API**: `GET /v1/gallery` (auth) → user's non-expired generations (presigned result URLs), newest first. Images stay intact regardless of recipe lifecycle state.
5. **TTL auto-deletion**: `image_ttl_days` (unresolved_slot — pick a value, e.g. 30) — a cleanup path (cron/management command or lazy filter on `expires_at`). At minimum, filter expired rows out of the gallery and document the sweep.
6. **Mobile gallery**: `src/fetch-gallery.ts` transport-seam + `GalleryScreen` (pure) + `app/(generate)/(tabs)/gallery.tsx` route + camera-roll save (expo-media-library seam; stub+alias in `vitest.config.ts`). Add the gallery tab to `app/(generate)/(tabs)/_layout.tsx`.

Open params (seed `unresolved_slots`): `image_ttl_days`, `watermark_form`, `reject_judgment_mechanism`, `rolling_window_length`.

## Running gates in THIS worktree (IMPORTANT)

The worktree has **no own venv**; `import personal_color`/`import api` resolve to the **main repo** via editable installs. Run Python gates with the main `.venv` python **+ worktree PYTHONPATH** so worktree code is what's tested:

```bash
VENV=/Users/opty/Code/personal-color-kr/.venv/bin/python3
CP=$PWD/packages/core-python/src ; API=$PWD/apps/api/src
# tests
( cd apps/api && PYTHONPATH="$API:$CP" "$VENV" -m pytest -q tests/unit )
( cd packages/core-python && PYTHONPATH="$CP" "$VENV" -m pytest -q tests/test_orchestrator.py … )
# mypy (CLAUDE.md: strict, src only)
( cd apps/api && PYTHONPATH="$API:$CP" MYPYPATH="$API:$CP" "$VENV" -m mypy --strict src )
# format/lint — run on MY files only (CI installs LATEST unpinned black/ruff;
# newer black reformats untouched main files — repo-wide pre-existing drift, not ours)
"$VENV" -m ruff check <files> ; "$VENV" -m black --check <files>
```

TS gates (node_modules installed in worktree):
```bash
pnpm --filter mobile run typecheck && pnpm --filter mobile run test && pnpm --filter mobile run lint && pnpm --filter mobile run format:check
pnpm --filter web    run typecheck && pnpm --filter web    run test && pnpm --filter web    run lint && pnpm --filter web    run format:check
```

Gotchas: macOS has no `timeout`; zsh doesn't word-split unquoted vars (pass file lists explicitly or `${=VAR}`). RN unit tests: filter `findAll` to host nodes (`typeof n.type === 'string'`) — the RN mock double-renders testID. CI black/ruff/mypy are **unpinned** (`.github/workflows/ci.yml`) → format target moves; only guarantee MY files.

## Key files (AC2/AC3)
- `apps/api/src/api/routers/generate.py`, `apps/api/src/api/dependencies/generate.py`
- `apps/api/src/api/observability/generation_metrics.py`
- `apps/mobile/src/request-generation.ts`, `apps/mobile/src/screens/generate/GenerationScreen.tsx`, `apps/mobile/app/(generate)/generate.tsx`
- Tests: `apps/api/tests/unit/test_generate_endpoint.py`, `test_generation_metrics.py`; `apps/mobile/tests/request-generation.test.ts`, `generation-screen.test.tsx`
