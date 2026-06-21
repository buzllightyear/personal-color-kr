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
| AC4 | Object storage (SigV4 S3/R2 adapter + in-memory) + `generations` table/migration + persist-on-generate + `GET /v1/gallery` (+ `/{id}/image` stream) + TTL sweep + mobile gallery tab/transport/camera-roll | ✅ |

Salvage notes: the original ooo run (`exec_144c13c738a4`) stopped on **rate-limit**, not code defects. Real fixes made: `FalNsfwClassifier._ENDPOINT` typo, unused `type: ignore`, committed `build/` artifacts removed+gitignored, `apps/web` eslint flat config (replaced interactive `next lint`).

## AC4 — DONE & committed (object storage + gallery + TTL)

Built with the **adapter/transport-seam pattern, secrets via env, stub-based tests**.
Resolved `image_ttl_days = 30` (env `IMAGE_TTL_DAYS`, sensible-default). Decisions that
differ from the original sketch above:

- **No `boto3`** — the S3/R2 adapter is `httpx` + hand-rolled **AWS SigV4** header signing
  (`api/storage/sigv4.py`), unit-pinned to AWS's canonical `get-vanilla` test vector. Keeps
  the dep tree light and `mypy --strict` clean (no boto3-stubs friction).
- **No presigned URLs** — the gallery streams images through an authenticated endpoint
  (`GET /v1/gallery/{id}/image`), so the original never egresses and no time-boxed public URL
  is minted. `ObjectStorage` is `put` / `get` / `delete` (no `presign_get`).
- **Watermarked result only is persisted** — the original selfie is never stored (honors the
  zero-PII invariant), so no `original_image_key`. `generations` columns: `id, user_id (FK
  users CASCADE), recipe_id (TEXT, not a FK → survives recipe removal), result_image_key,
  retry_count, created_at, expires_at`.
- **Persist-on-generate is best-effort** — a storage/DB failure logs + drops the gallery row
  but still returns the delivered image (200); `X-Generation-Id` header carries the row id.
- **TTL** — read-time filter (`expires_at > now`) hides expired rows in the gallery; an
  out-of-band sweep (`api/services/generation_sweep.py::run_sweep`) deletes expired rows +
  objects. No in-app scheduler shipped — run `run_sweep()` from a daily platform cron (recipe
  in the module docstring).
- **Mobile** — SDK 54 `expo-file-system` moved `downloadAsync`/`cacheDirectory` to `/legacy`
  (TS source that trips strict tsc), so the camera-roll save uses the **new `File` API**
  (`File.downloadFileAsync` → cache `Directory`). `expo-media-library` + `expo-file-system`
  added as deps; both stubbed+aliased in `vitest.config.ts`.

Key new files: `api/storage/{sigv4,object_storage,s3_object_storage}.py`,
`api/dependencies/storage.py`, `api/db/models/generation.py` (+ migration `content_gen_generations`),
`api/routers/gallery.py`, `api/schemas/gallery.py`, `api/services/generation_sweep.py`;
mobile `src/fetch-gallery.ts`, `src/save-to-camera-roll.ts`,
`src/screens/generate/GalleryScreen.tsx`, `app/(generate)/(tabs)/gallery.tsx`.

Still seed `unresolved_slots` (not AC4-blocking): `watermark_form`,
`reject_judgment_mechanism`, `rolling_window_length`.

### AC4 env vars (production wiring — currently falls back to in-memory store)
`S3_ENDPOINT_URL`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION`
(default `auto`), `IMAGE_TTL_DAYS` (default `30`). With the `S3_*` set absent the app boots and
the flow works against a process-local in-memory bucket (dev/CI); set them for durable R2/S3.

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
