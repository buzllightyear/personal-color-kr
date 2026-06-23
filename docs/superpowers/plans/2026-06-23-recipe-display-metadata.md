# Recipe Display Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four catalog display-metadata fields — `title`, `description`, `tags`, `thumbnail_url` — to recipes, propagated end-to-end (DB → migration → API schemas → mobile client → web admin UI), so the recipe catalog can render attractive Meitu-style cards.

**Architecture:** Additive change across the existing 6-layer recipe contract chain. New columns are added to the `recipes` table via one Alembic migration on top of the current head (`content_gen_generations`). API schemas gain the fields (admin: full CRUD; public catalog: display-only). The mobile catalog client and web admin form mirror the same fields. No new tables, no collections (single-list catalog stays); `tags` is the forward path to collections later. core-ts is NOT involved — the recipe projection lives in `apps/mobile`, not core-ts.

**Tech Stack:** FastAPI + async SQLAlchemy + Alembic (apps/api, Python 3.12), Pydantic v2, Expo/React Native + TypeScript (apps/mobile), Next.js + React + TypeScript (apps/web). pnpm 9 workspaces; editable pip installs.

**Revisions:**
- 2026-06-23 R1: codex review R1 HIGH 6건 반영 — alembic walk 7-tuple 재구조화 + 순서 assert, RecipeUpdate null-clearing(model_fields_set), thumbnail_url https 검증, title recipe_id 백필+default drop, 모바일 카드 렌더 step, web makeRecipe fixture/payload 검증.
- 2026-06-23 R2: codex review R2 HIGH 1건 반영 — alembic walk 방향 정정(walk_revisions head→base, recipe_meta가 first/new head). 추가로 모바일 테스트 경로 casing 정정(recipe-catalog-screen.test.tsx), thumbnail validator urlparse scheme+host 강화 + "https://" host-less 422 케이스.

## Global Constraints

- **Product identity (do not "fix"):** personal color is a one-time hook only; recipes are trend-centric. The un-expanded `{personal_color_modifier}` in `prompt_template` is intentional — do NOT add modifier expansion in this work.
- **Thumbnail serving:** `thumbnail_url` is a **public HTTPS URL** (option ii). NO new authenticated streaming endpoint, NO presigned URLs. Field is nullable; absent → client shows a placeholder.
- **Catalog structure:** single flat list (no collections table in this plan).
- **`exactOptionalPropertyTypes: true`** (root tsconfig): use `| null` (not `| undefined`) for absent fields; conditionally spread optional props rather than passing `undefined`.
- **Formatting/lint/types:** Prettier (printWidth 88, single quotes, semicolons) + eslint + `tsc --noEmit` for TS; black (88 col) + ruff + `mypy --strict` (src only) for Python. CI runs all four per language — vitest/pytest passing is not sufficient.
- **`pytest` pinned `<9.1`.**
- **SQLAlchemy import boundary (AC11):** every `sqlalchemy*` import stays inside `apps/api/src/api/db/`. The model file and the migration are inside that boundary; schemas (Pydantic) and routers must not add direct `from sqlalchemy ...` imports.
- **Run TS commands via `pnpm --filter <ws>`; run Python commands from `apps/api`.**
- This work bundles the already-made CLAUDE.md identity-clarification edit (uncommitted in the working tree) onto the same branch.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `apps/api/src/api/db/models/recipe.py` | Recipe ORM model | Add 4 `mapped_column`s |
| `apps/api/src/api/db/migrations/versions/2026_06_23_0000-content_gen_recipe_meta_add_display_metadata.py` | Schema migration | **Create** |
| `apps/api/tests/unit/test_alembic_history_chain.py` | Pins head + chain length | Add revision id; 6→7 |
| `apps/api/tests/unit/test_alembic_baseline_revision.py` | Pins versions/ file count | Add filename; 6→7 |
| `apps/api/tests/integration/test_events_migration.py` | Integration reset + head | Bump `_HEAD_REVISION` |
| `apps/api/src/api/schemas/recipes.py` | Pydantic request/response | Add fields to Create/Update/Response/CatalogResponse |
| `apps/api/src/api/routers/admin_recipes.py` | Admin CRUD handlers | Thread fields in create + update |
| `apps/api/tests/unit/test_admin_recipes.py` | Admin handler tests | Update `_make_recipe` + create payloads; add field tests |
| `apps/api/tests/unit/test_recipes_catalog.py` | Public catalog tests | Update `_make_recipe`; extend schema-fields test |
| `apps/mobile/src/fetch-recipe-catalog.ts` | Wire + camel projection | Add fields to wire item, CatalogRecipe, mapper |
| `apps/mobile/tests/fetch-recipe-catalog.test.ts` | Projection tests | Update fixtures + assertions |
| `apps/mobile/src/screens/generate/RecipeCatalogScreen.tsx` | Catalog card UI | Render title/description/tags/thumbnail + placeholder |
| `apps/mobile/tests/recipe-catalog-screen.test.tsx` | Catalog screen tests | Assert card metadata + placeholder render |
| `apps/web/src/types/recipe.ts` | Admin TS types | Add fields to Recipe/Create/Update |
| `apps/web/src/components/admin/RecipeForm.tsx` | Admin form | Add state, fields, payload threading |
| `apps/web/tests/admin/RecipeForm.test.tsx` | Form tests | Add label assertions |
| `CLAUDE.md` | Project docs | Already edited (identity); add recipe-fields note in final task |

---

## Task 1: DB model + migration + alembic tests

**Files:**
- Modify: `apps/api/src/api/db/models/recipe.py:155-200`
- Create: `apps/api/src/api/db/migrations/versions/2026_06_23_0000-content_gen_recipe_meta_add_display_metadata.py`
- Test: `apps/api/tests/unit/test_alembic_history_chain.py`, `apps/api/tests/unit/test_alembic_baseline_revision.py`, `apps/api/tests/integration/test_events_migration.py`

**Interfaces:**
- Produces: `Recipe.title: str`, `Recipe.description: str | None`, `Recipe.tags: list[str]`, `Recipe.thumbnail_url: str | None`. New alembic head revision id `"content_gen_recipe_meta"` (down_revision `"content_gen_generations"`).

- [ ] **Step 1: Create the branch and update the failing alembic chain tests first**

```bash
cd /Users/opty/Code/personal-color-kr
git checkout -b feat/recipe-display-metadata
```

In `apps/api/tests/unit/test_alembic_history_chain.py`, add the new revision constant after the `_GENERATIONS_REVISION_ID` line (around line 77):

```python
_RECIPE_META_REVISION_ID: str = "content_gen_recipe_meta"
```

Change the head assertion (around line 113) from:

```python
    assert heads == (_GENERATIONS_REVISION_ID,), (
```

to:

```python
    assert heads == (_RECIPE_META_REVISION_ID,), (
```

Change the chain-length assertion (around line 171) from `len(walk) == 6` to `len(walk) == 7`, and update the accompanying message text from "six revisions" to "seven revisions".

**IMPORTANT — the walk is also destructured and position-pinned (R1/R2 HIGH).** `walk_revisions()` returns revisions in **head → base** order (the test comments around line 163 state this). The test (around lines 190-199) unpacks `walk` into named variables and asserts the **first** element is the current head (`_GENERATIONS_REVISION_ID` today). The new `recipe_meta` migration becomes the **new head**, so it must be the **first** element after the change. After adding the new migration you MUST:

- Add one more variable to the destructuring assignment so it unpacks **7** scripts, not 6, with the new revision **first** (head). For example, if the current tuple is `(generations_script, recipes_script, referrals_script, users_script, events_script, base_script) = walk`, change it to:

```python
    (
        recipe_meta_script,
        generations_script,
        recipes_script,
        referrals_script,
        users_script,
        events_script,
        base_script,
    ) = walk
```

- Add explicit ordering asserts for the new head revision:

```python
    assert recipe_meta_script.revision == _RECIPE_META_REVISION_ID
    assert recipe_meta_script.down_revision == _GENERATIONS_REVISION_ID
```

- The head assert that previously pinned `_GENERATIONS_REVISION_ID` as the first element must now pin `_RECIPE_META_REVISION_ID` as the first element; `_GENERATIONS_REVISION_ID` becomes the **second** item (and is already covered by the `recipe_meta_script.down_revision` assert above). Do NOT leave a stale "first element == `_GENERATIONS_REVISION_ID`" assert — it will fail.

> Read the actual `def test_*` body around lines 160-205 before editing; confirm the head→base ordering and match the exact variable names / assert style there (the snippet above is the intent, not a byte-exact patch). If the existing tuple order is base→head instead, mirror that direction and place `recipe_meta_script` **last** — the invariant is "new migration sits at the head end of the chain".

In `apps/api/tests/unit/test_alembic_baseline_revision.py`, add a filename constant alongside the others:

```python
_RECIPE_META_FILENAME: str = (
    "2026_06_23_0000-content_gen_recipe_meta_add_display_metadata.py"
)
```

and add `_RECIPE_META_FILENAME` to the `expected_names` list (around line 110), and change the count message from "six migrations" to "seven migrations".

**Also add a revision/down_revision AST assert for the new migration (R1 HIGH).** If `test_alembic_baseline_revision.py` (or its sibling chain test) parses each migration file's `revision`/`down_revision` module constants, add an assertion that the new file declares `revision == "content_gen_recipe_meta"` and `down_revision == "content_gen_generations"` so the new migration is verified to chain onto `content_gen_generations` (not just present as a file). If neither AST test inspects `down_revision`, the chain-test ordering asserts added above are the source of truth — note that and skip duplicating here.

In `apps/api/tests/integration/test_events_migration.py`, change `_HEAD_REVISION` (around line 66) from:

```python
_HEAD_REVISION: str = "content_gen_generations"
```

to:

```python
_HEAD_REVISION: str = "content_gen_recipe_meta"
```

(The `_reset_db_to_blank` DROP list needs no change — no new table is added.)

- [ ] **Step 2: Run the alembic unit tests to verify they fail**

Run: `cd apps/api && python -m pytest -q tests/unit/test_alembic_history_chain.py tests/unit/test_alembic_baseline_revision.py`
Expected: FAIL — head is still `content_gen_generations`, walk length is 6, versions/ has 6 files (new migration not created yet).

- [ ] **Step 3: Add the 4 columns to the Recipe ORM model**

In `apps/api/src/api/db/models/recipe.py`, after the `style_reference_key` block (ends line 155) and before the `parameters` block (line 157), insert:

```python
    # ----- title: catalog display title (operator-authored) -----
    # Shown as the card title in the public catalog. NOT NULL. The migration
    # adds it with a transient server_default of '' (to populate existing
    # rows), backfills those rows from recipe_id, then DROPS the default so
    # the column is operator-required. The ORM model therefore declares NO
    # server_default — new rows must always supply title (API enforces
    # min_length=1).
    title: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    # ----- description: optional catalog subtitle -----
    description: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    # ----- tags: classification chips (string array) -----
    # JSONB array of strings (same storage pattern as ``parameters``).
    # Doubles as the seed for future themed collections. ``default=list``
    # gives transient ORM instances an empty list; ``server_default='[]'``
    # covers raw-SQL inserts and the add-column backfill.
    tags: Mapped[list[str]] = mapped_column(
        JSONB,
        nullable=False,
        default=list,
        server_default="[]",
    )

    # ----- thumbnail_url: public HTTPS URL of an example result -----
    # Operator-curated marketing image (non-PII), served as a public URL
    # (no auth endpoint). NULL until the operator attaches one.
    thumbnail_url: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )
```

(`Text` and `JSONB` are already imported at the top of the file.)

- [ ] **Step 4: Create the migration**

Create `apps/api/src/api/db/migrations/versions/2026_06_23_0000-content_gen_recipe_meta_add_display_metadata.py`:

```python
"""Add display-metadata columns to the recipes table.

Adds ``title``, ``description``, ``tags``, ``thumbnail_url`` so the public
catalog can render recipe cards (Meitu-style: title + example thumbnail +
optional description + classification tags).

Revision ID: content_gen_recipe_meta
Revises: content_gen_generations
Create Date: 2026-06-23 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "content_gen_recipe_meta"
down_revision = "content_gen_generations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add the four display-metadata columns to ``recipes``."""
    # Add ``title`` NOT NULL. ``server_default=''`` lets the column be added
    # to existing rows, but an empty title would surface as a blank catalog
    # card (R1 HIGH). Backfill existing rows with ``recipe_id`` as a
    # human-meaningful placeholder, THEN drop the server_default so future
    # inserts must supply a title (the API enforces ``min_length=1``).
    op.add_column(
        "recipes",
        sa.Column(
            "title",
            sa.Text(),
            nullable=False,
            server_default=sa.text("''"),
        ),
    )
    # Backfill any pre-existing rows so no published recipe renders with a
    # blank title. ``recipe_id`` is the operator-facing slug — a reasonable
    # stopgap the operator can later overwrite via the admin form.
    op.execute("UPDATE recipes SET title = recipe_id WHERE title = ''")
    # Remove the column default so the column is genuinely operator-required
    # going forward (matches the API ``min_length=1`` contract).
    op.alter_column("recipes", "title", server_default=None)
    op.add_column(
        "recipes",
        sa.Column("description", sa.Text(), nullable=True),
    )
    op.add_column(
        "recipes",
        sa.Column(
            "tags",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    op.add_column(
        "recipes",
        sa.Column("thumbnail_url", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    """Drop the four display-metadata columns."""
    op.drop_column("recipes", "thumbnail_url")
    op.drop_column("recipes", "tags")
    op.drop_column("recipes", "description")
    op.drop_column("recipes", "title")
```

- [ ] **Step 5: Run the alembic unit tests to verify they pass**

Run: `cd apps/api && python -m pytest -q tests/unit/test_alembic_history_chain.py tests/unit/test_alembic_baseline_revision.py`
Expected: PASS — head is `content_gen_recipe_meta`, walk length 7, versions/ has 7 files.

- [ ] **Step 6: Verify the migration applies against a real DB (if `DATABASE_URL_TEST` available)**

Run: `cd apps/api && python -m pytest -q tests/integration/test_events_migration.py` (requires Postgres + `DATABASE_URL_TEST`; skip if no DB and note it).
Expected: PASS — `alembic upgrade head` stamps `content_gen_recipe_meta`.

- [ ] **Step 7: Python quality gate for touched files**

Run: `cd apps/api && python -m black --check src tests && python -m ruff check src tests && python -m mypy --strict src`
Expected: all clean.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/api/db/models/recipe.py \
  apps/api/src/api/db/migrations/versions/2026_06_23_0000-content_gen_recipe_meta_add_display_metadata.py \
  apps/api/tests/unit/test_alembic_history_chain.py \
  apps/api/tests/unit/test_alembic_baseline_revision.py \
  apps/api/tests/integration/test_events_migration.py
git commit -m "feat(recipes): add title/description/tags/thumbnail_url columns + migration"
```

---

## Task 2: Admin API schemas + router (create/update/response)

**Files:**
- Modify: `apps/api/src/api/schemas/recipes.py:44-106`
- Modify: `apps/api/src/api/routers/admin_recipes.py:155-176, 240-263`
- Test: `apps/api/tests/unit/test_admin_recipes.py`

**Interfaces:**
- Consumes: `Recipe.title/description/tags/thumbnail_url` (Task 1).
- Produces: `RecipeCreate.title: str` (required), `RecipeCreate.description: str | None`, `RecipeCreate.tags: list[str]`, `RecipeCreate.thumbnail_url: str | None`; same optional fields on `RecipeUpdate`; same fields on `RecipeResponse`.

- [ ] **Step 1: Update the `_make_recipe` helper and add the failing test**

In `apps/api/tests/unit/test_admin_recipes.py`, extend `_make_recipe` (lines 79-94) by inserting after `recipe.display_order = kwargs.get("display_order", 0)`:

```python
    recipe.title = kwargs.get("title", "Test Recipe")
    recipe.description = kwargs.get("description", None)
    recipe.tags = kwargs.get("tags", [])
    recipe.thumbnail_url = kwargs.get("thumbnail_url", None)
```

Add this new test at the end of the file:

```python
@pytest.mark.unit
@pytest.mark.asyncio
async def test_create_recipe_persists_display_metadata() -> None:
    """POST /admin/recipes accepts and echoes title/description/tags/thumbnail_url."""
    app, session = _build_admin_app([])
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url=_BASE_URL
    ) as client:
        resp = await client.post(
            _ADMIN_URL,
            headers=_ADMIN_HEADERS,
            json={
                "recipe_id": "meta_recipe",
                "model_id": "fal-ai/flux/dev",
                "prompt_template": "a portrait, {personal_color_modifier}",
                "title": "투명 글로우 메이크업",
                "description": "조명 없이도 맑아지는 피부",
                "tags": ["뷰티보정", "HOT"],
                "thumbnail_url": "https://cdn.example.com/thumb.png",
            },
        )
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["title"] == "투명 글로우 메이크업"
    assert data["description"] == "조명 없이도 맑아지는 피부"
    assert data["tags"] == ["뷰티보정", "HOT"]
    assert data["thumbnail_url"] == "https://cdn.example.com/thumb.png"
```

> Note: use the same app-builder/header helpers this file already uses (`_build_admin_app`, `_ADMIN_URL`, `_ADMIN_HEADERS`). If their names differ, match the existing create test `test_create_recipe_returns_201_with_correct_fields` (line 467) for the exact construction.

- [ ] **Step 2: Run the new test to verify it fails**

Run: `cd apps/api && python -m pytest -q tests/unit/test_admin_recipes.py::test_create_recipe_persists_display_metadata -v`
Expected: FAIL — `RecipeCreate` rejects unknown fields / `title` not on response.

- [ ] **Step 3: Add the fields to the Pydantic schemas**

In `apps/api/src/api/schemas/recipes.py`, in `RecipeCreate` (after `prompt_template`, line 53) add:

```python
    title: str = Field(..., min_length=1, description="Catalog display title")
    description: str | None = Field(None, description="Optional catalog subtitle")
    tags: list[str] = Field(
        default_factory=list, description="Classification tags / chips"
    )
    thumbnail_url: str | None = Field(
        None, description="Public HTTPS URL of the example thumbnail"
    )
```

In `RecipeUpdate` (after `prompt_template`, line 86) add:

```python
    title: str | None = Field(None, min_length=1)
    description: str | None = None
    tags: list[str] | None = None
    thumbnail_url: str | None = None
```

**`thumbnail_url` MUST be validated as a public HTTPS URL (R1 HIGH).** The global constraint pins `thumbnail_url` to a *public HTTPS* URL (no auth endpoint, no presigned URL, no storage key) — but a bare `str | None` accepts `http://`, relative paths, raw storage keys, and empty strings. Add a shared Pydantic v2 field validator so both `RecipeCreate` and `RecipeUpdate` reject non-HTTPS values. Keep it inside the schema layer (Pydantic only — **no `from sqlalchemy ...` import**, per AC11). Define a module-level reusable validator and attach it on both models:

```python
from urllib.parse import urlparse

from pydantic import field_validator

def _validate_https_url(value: str | None) -> str | None:
    """Reject anything that isn't a public ``https://`` URL.

    None passes (field is nullable). Empty/blank strings are rejected — the
    web form converts blanks to ``null`` before sending, so a blank reaching
    the API is a bug, not "cleared". Parses scheme + host so a bare
    ``"https://"`` (no host) and relative paths / storage keys are rejected,
    not just non-https schemes (R2).
    """
    if value is None:
        return None
    parsed = urlparse(value)
    if parsed.scheme != "https" or not parsed.netloc:
        raise ValueError("thumbnail_url must be a public https:// URL with a host")
    return value
```

```python
    # on RecipeCreate AND RecipeUpdate:
    _validate_thumbnail_url = field_validator("thumbnail_url")(_validate_https_url)
```

Add API tests (in the admin test file) asserting a 422 for `thumbnail_url` values `"http://cdn.example.com/x.png"`, `"/relative/path.png"`, `"styles/key.png"`, `"https://"` (scheme only, no host), and `""`, and a 201/200 for a valid `"https://cdn.example.com/thumb.png"`.

In `RecipeResponse` (after `prompt_template`, line 99) add:

```python
    title: str
    description: str | None
    tags: list[str]
    thumbnail_url: str | None
```

- [ ] **Step 4: Thread the fields through the router create + update handlers**

In `apps/api/src/api/routers/admin_recipes.py`, in `create_recipe` add to the `Recipe(...)` constructor (after `display_order=body.display_order,`):

```python
        title=body.title,
        description=body.description,
        tags=body.tags,
        thumbnail_url=body.thumbnail_url,
```

In `update_recipe`, after the `display_order` block (`if body.display_order is not None: recipe.display_order = body.display_order`) add the new-field threading.

**Use presence, not `is not None`, for the nullable fields (R1 HIGH).** `description` and `thumbnail_url` are genuinely nullable, so an admin must be able to *clear* them back to `null` via PUT. An `is not None` guard makes that impossible (it can't distinguish "omitted" from "explicit null"). Pydantic v2 exposes `body.model_fields_set` — the set of fields the client actually sent — so gate the nullable fields on membership in that set:

```python
    fields_set = body.model_fields_set
    # title is non-null: only apply when a (validated, min_length=1) value is sent
    if body.title is not None:
        recipe.title = body.title
    # tags: list replace; only when the client sent it
    if "tags" in fields_set and body.tags is not None:
        recipe.tags = body.tags
    # description / thumbnail_url: nullable — an explicitly-sent null CLEARS them
    if "description" in fields_set:
        recipe.description = body.description
    if "thumbnail_url" in fields_set:
        recipe.thumbnail_url = body.thumbnail_url
```

Add an admin test that PUT with `"description": null` / `"thumbnail_url": null` on a recipe that previously had values clears them to `None` (and that omitting the keys leaves them unchanged).

- [ ] **Step 5: Add `title` to every existing create POST body in the admin tests**

`RecipeCreate.title` is now required. In `apps/api/tests/unit/test_admin_recipes.py`, every `POST {_ADMIN_URL}` JSON body that creates a recipe (the create test ~line 268, the duplicate-id test ~line 751, the schema test ~line 785) must include a `"title"` key. Add `"title": "Test Recipe"` to each such `json={...}` payload.

- [ ] **Step 6: Run the admin tests to verify they pass**

Run: `cd apps/api && python -m pytest -q tests/unit/test_admin_recipes.py -v`
Expected: PASS (all existing + the new metadata test).

- [ ] **Step 7: Python quality gate**

Run: `cd apps/api && python -m black --check src tests && python -m ruff check src tests && python -m mypy --strict src`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/api/schemas/recipes.py apps/api/src/api/routers/admin_recipes.py apps/api/tests/unit/test_admin_recipes.py
git commit -m "feat(recipes): admin API create/update/response carry display metadata"
```

---

## Task 3: Public catalog schema exposes display metadata

**Files:**
- Modify: `apps/api/src/api/schemas/recipes.py:118-132`
- Test: `apps/api/tests/unit/test_recipes_catalog.py:70-90, 440-473`

**Interfaces:**
- Consumes: `Recipe.title/description/tags/thumbnail_url` (Task 1).
- Produces: `CatalogRecipeResponse` with `title: str`, `description: str | None`, `tags: list[str]`, `thumbnail_url: str | None` (in addition to existing fields). The public router needs no change — it uses `CatalogRecipeResponse.model_validate(r)` with `from_attributes=True`, so new attributes auto-flow.

- [ ] **Step 1: Update `_make_recipe` and extend the schema-fields test (failing)**

In `apps/api/tests/unit/test_recipes_catalog.py`, extend `_make_recipe` (lines 70-90) by inserting after `recipe.display_order = display_order`:

```python
    recipe.title = "Test Recipe"
    recipe.description = None
    recipe.tags = []
    recipe.thumbnail_url = None
```

In `test_catalog_response_schema_fields` (lines 440-473), add to the "Public fields MUST be present" block:

```python
    assert "title" in item
    assert "description" in item
    assert "tags" in item
    assert "thumbnail_url" in item
```

- [ ] **Step 2: Run the catalog test to verify it fails**

Run: `cd apps/api && python -m pytest -q tests/unit/test_recipes_catalog.py::test_catalog_response_schema_fields -v`
Expected: FAIL — `title`/`description`/`tags`/`thumbnail_url` not in the response item.

- [ ] **Step 3: Add the fields to `CatalogRecipeResponse`**

In `apps/api/src/api/schemas/recipes.py`, in `CatalogRecipeResponse` (after `recipe_id: str`, line 126) add:

```python
    title: str
    description: str | None
    tags: list[str]
    thumbnail_url: str | None
```

(Leave `model_id`, `prompt_template`, `parameters` absent — they stay internal-only.)

- [ ] **Step 4: Run the catalog tests to verify they pass**

Run: `cd apps/api && python -m pytest -q tests/unit/test_recipes_catalog.py -v`
Expected: PASS.

- [ ] **Step 5: Python quality gate**

Run: `cd apps/api && python -m black --check src tests && python -m ruff check src tests && python -m mypy --strict src`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/api/schemas/recipes.py apps/api/tests/unit/test_recipes_catalog.py
git commit -m "feat(recipes): expose display metadata in the public catalog response"
```

---

## Task 4: Mobile catalog client projection

**Files:**
- Modify: `apps/mobile/src/fetch-recipe-catalog.ts:51-117`
- Test: `apps/mobile/tests/fetch-recipe-catalog.test.ts:31-106`

**Interfaces:**
- Consumes: the wire shape from Task 3 (`title`, `description`, `tags`, `thumbnail_url`).
- Produces: `CatalogRecipe` with `title: string`, `description: string | null`, `tags: readonly string[]`, `thumbnailUrl: string | null`.

- [ ] **Step 1: Update fixtures and the projection assertions (failing)**

In `apps/mobile/tests/fetch-recipe-catalog.test.ts`, extend `WIRE_ITEM_1` (lines 31-37) to include the new wire fields:

```typescript
const WIRE_ITEM_1: CatalogRecipeWireItem = {
  recipe_id: 'summer-vibes-2024',
  style_reference_key: 'styles/summer-vibes.jpg',
  publish_date: '2024-06-01T00:00:00Z',
  display_order: 1,
  created_at: '2024-05-20T10:00:00Z',
  title: 'Summer Vibes',
  description: 'Bright summer look',
  tags: ['summer', 'HOT'],
  thumbnail_url: 'https://cdn.example.com/summer.png',
};
```

Extend `WIRE_ITEM_2` (lines 39-45) similarly, exercising nulls:

```typescript
const WIRE_ITEM_2: CatalogRecipeWireItem = {
  recipe_id: 'winter-chic-2024',
  style_reference_key: null,
  publish_date: '2024-12-01T00:00:00Z',
  display_order: 2,
  created_at: '2024-11-15T08:30:00Z',
  title: 'Winter Chic',
  description: null,
  tags: [],
  thumbnail_url: null,
};
```

Update the `maps every snake_case field to camelCase` assertion (lines 65-72) to:

```typescript
    expect(result).toEqual({
      recipeId: 'summer-vibes-2024',
      styleReferenceKey: 'styles/summer-vibes.jpg',
      publishDate: '2024-06-01T00:00:00Z',
      displayOrder: 1,
      createdAt: '2024-05-20T10:00:00Z',
      title: 'Summer Vibes',
      description: 'Bright summer look',
      tags: ['summer', 'HOT'],
      thumbnailUrl: 'https://cdn.example.com/summer.png',
    });
```

Add a focused null test after it:

```typescript
  it('preserves null description and thumbnailUrl, and empty tags', () => {
    const result = mapCatalogRecipeWireItem(WIRE_ITEM_2);
    expect(result.description).toBeNull();
    expect(result.thumbnailUrl).toBeNull();
    expect(result.tags).toEqual([]);
  });
```

In the `result has no snake_case keys` test (lines 100-105), add:

```typescript
    expect(Object.keys(result)).not.toContain('thumbnail_url');
```

- [ ] **Step 2: Run the mobile test to verify it fails**

Run: `cd apps/mobile && pnpm vitest run tests/fetch-recipe-catalog.test.ts`
Expected: FAIL — wire item type errors / projection missing new keys.

- [ ] **Step 3: Add the fields to the wire item, projection type, and mapper**

In `apps/mobile/src/fetch-recipe-catalog.ts`, extend `CatalogRecipeWireItem` (lines 51-57):

```typescript
export interface CatalogRecipeWireItem {
  readonly recipe_id: string;
  readonly style_reference_key: string | null;
  readonly publish_date: string | null;
  readonly display_order: number;
  readonly created_at: string;
  readonly title: string;
  readonly description: string | null;
  readonly tags: readonly string[];
  readonly thumbnail_url: string | null;
}
```

Extend `CatalogRecipe` (lines 82-88):

```typescript
export interface CatalogRecipe {
  readonly recipeId: string;
  readonly styleReferenceKey: string | null;
  readonly publishDate: string | null;
  readonly displayOrder: number;
  readonly createdAt: string;
  readonly title: string;
  readonly description: string | null;
  readonly tags: readonly string[];
  readonly thumbnailUrl: string | null;
}
```

Extend `mapCatalogRecipeWireItem` (lines 109-117) return object:

```typescript
  return {
    recipeId: wire.recipe_id,
    styleReferenceKey: wire.style_reference_key,
    publishDate: wire.publish_date,
    displayOrder: wire.display_order,
    createdAt: wire.created_at,
    title: wire.title,
    description: wire.description,
    tags: wire.tags,
    thumbnailUrl: wire.thumbnail_url,
  };
```

- [ ] **Step 4: Run the mobile test to verify it passes**

Run: `cd apps/mobile && pnpm vitest run tests/fetch-recipe-catalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Render the metadata on the catalog card (R1 HIGH — close the goal gap)**

The plan's goal is "render attractive Meitu-style cards" and the global constraint says an absent thumbnail shows a **placeholder** — but `RecipeCatalogScreen.tsx` currently renders only `recipe.recipeId` (the card label is `{recipe.recipeId}` around line 152). A projection-only change does not satisfy the goal. Update `apps/mobile/src/screens/generate/RecipeCatalogScreen.tsx` so each card renders:

- `title` as the primary card label (replacing the raw `recipeId`), and `accessibilityLabel={recipe.title}` (fall back to `recipeId` only if `title` is empty — should not happen post-backfill).
- `description` as a secondary line when non-null.
- `tags` as small chips when the array is non-empty.
- `thumbnailUrl` as the card image when non-null; when null, render a **placeholder** block (a neutral ink-ramp box per `docs/DESIGN.md` — chrome is monochrome). Use a plain RN `Image` from `react-native` (no new native dependency, so no new vitest stub/alias needed); if a different image component is introduced, add the stub + alias in `apps/mobile/vitest.config.ts` per the CLAUDE.md gotcha.

Update the existing `apps/mobile/tests/recipe-catalog-screen.test.tsx` (do NOT create a new PascalCase file — the existing screen test is `recipe-catalog-screen.test.tsx`) to assert: the title text renders, the description renders when present, a tag chip renders, the thumbnail image renders when `thumbnailUrl` is set, and the placeholder renders when it is null. Render the screen directly with props (the thin-route / pure-screen split means no router/provider context is needed).

> If the intent is explicitly projection-only for this PR and card rendering is a deliberate follow-up, then instead AMEND the plan goal/global-constraint wording to drop "render attractive Meitu-style cards" / "placeholder", and move card rendering to the Deferred list. Do not leave the goal claiming rendering while shipping only the projection.

- [ ] **Step 6: Mobile TS quality gate**

Run: `pnpm --filter mobile run typecheck && pnpm --filter mobile run lint && pnpm --filter mobile run format:check`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/fetch-recipe-catalog.ts apps/mobile/tests/fetch-recipe-catalog.test.ts \
  apps/mobile/src/screens/generate/RecipeCatalogScreen.tsx apps/mobile/tests/recipe-catalog-screen.test.tsx
git commit -m "feat(mobile): catalog client + cards render recipe display metadata"
```

---

## Task 5: Web admin form + types

**Files:**
- Modify: `apps/web/src/types/recipe.ts:10-49`
- Modify: `apps/web/src/components/admin/RecipeForm.tsx:95-106, 127-179, 196-299`
- Test: `apps/web/tests/admin/RecipeForm.test.tsx:55-67`

**Interfaces:**
- Consumes: the admin API contract from Task 2 (`title` required, others optional).
- Produces: form collects `title`, `description`, `tags` (comma-separated input → string[]), `thumbnail_url` into the create/update payloads.

- [ ] **Step 1: Add the failing label assertions AND update the `makeRecipe` fixture**

**Update the `makeRecipe()` fixture first (R1 HIGH).** `apps/web/tests/admin/RecipeForm.test.tsx` has a `makeRecipe()` helper (lines 26-41) that returns a full `Recipe` object literal. Once Step 3 adds **required** `title` and `tags` (and `description`/`thumbnail_url`) to the `Recipe` type, that literal no longer satisfies `Recipe` and `tsc --noEmit` (part of the CI 4-fold gate) breaks. Add the four fields to the fixture literal:

```typescript
    title: 'Existing Recipe',
    description: null,
    tags: [],
    thumbnail_url: null,
```

In the `renders all required fields` test (lines 55-67) add:

```typescript
    expect(screen.getByLabelText(/^title/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/description/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/tags/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/thumbnail/i)).toBeInTheDocument();
```

Also add **payload-correctness** assertions (not just label presence), since the label-only test does not prove the form sends the fields (R1 MEDIUM): in a create-submit test assert the POST body carries `title`, `tags` as a parsed array (comma input → `['a','b']`), `description`/`thumbnail_url` as `null` when blank; and an edit-submit test asserting an existing recipe's `tags` pre-fill round-trips. If a submit/mock-fetch test harness already exists in this file, extend it; otherwise add one mirroring the existing submit tests.

- [ ] **Step 2: Run the web test to verify it fails**

Run: `pnpm --filter web run test -- RecipeForm`
Expected: FAIL — title/description/tags/thumbnail labels not found.

- [ ] **Step 3: Add the fields to the TS types**

In `apps/web/src/types/recipe.ts`, add to `Recipe` (after `prompt_template`, line 14):

```typescript
  title: string;
  description: string | null;
  tags: string[];
  thumbnail_url: string | null;
```

Add the same four to `RecipeCreate` (after `prompt_template`, line 33). Add to `RecipeUpdate` (after `prompt_template?`, line 44):

```typescript
  title?: string;
  description?: string | null;
  tags?: string[];
  thumbnail_url?: string | null;
```

- [ ] **Step 4: Add state, render, and payload threading in `RecipeForm.tsx`**

Add state after `displayOrder` (line 106):

```typescript
  const [title, setTitle] = useState(recipe?.title ?? '');
  const [description, setDescription] = useState(recipe?.description ?? '');
  const [tagsRaw, setTagsRaw] = useState(recipe?.tags?.join(', ') ?? '');
  const [thumbnailUrl, setThumbnailUrl] = useState(recipe?.thumbnail_url ?? '');
```

In `handleSubmit`, just before building the payloads (after `setSubmitError(null);`, around line 144), derive the parsed values:

```typescript
    const parsedTags = tagsRaw
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    const parsedDescription = description.length > 0 ? description : null;
    const parsedThumbnailUrl = thumbnailUrl.length > 0 ? thumbnailUrl : null;
```

Add these to the `RecipeUpdate` body object (after `display_order: parsedOrder,`):

```typescript
          title,
          description: parsedDescription,
          tags: parsedTags,
          thumbnail_url: parsedThumbnailUrl,
```

Add the same four lines to the `RecipeCreate` body object (after `display_order: parsedOrder,`).

In the render, after the `recipe_id` `<Field>` block (the first `<Field>`, ends ~line 222) insert the title field, and after the `style_reference_key` field (~line 252) insert description/tags/thumbnail fields:

```tsx
      {/* title */}
      <Field label="Title *" htmlFor="field-title">
        <input
          id="field-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          placeholder="e.g. 투명 글로우 메이크업"
          style={inputStyle}
        />
      </Field>

      {/* description */}
      <Field label="Description" htmlFor="field-description">
        <input
          id="field-description"
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="조명 없이도 맑아지는 피부"
          style={inputStyle}
        />
      </Field>

      {/* tags (comma-separated) */}
      <Field label="Tags (comma-separated)" htmlFor="field-tags">
        <input
          id="field-tags"
          type="text"
          value={tagsRaw}
          onChange={(e) => setTagsRaw(e.target.value)}
          placeholder="뷰티보정, HOT"
          style={inputStyle}
        />
      </Field>

      {/* thumbnail_url (public HTTPS URL) */}
      <Field label="Thumbnail URL" htmlFor="field-thumbnail">
        <input
          id="field-thumbnail"
          type="text"
          value={thumbnailUrl}
          onChange={(e) => setThumbnailUrl(e.target.value)}
          placeholder="https://cdn.example.com/thumb.png"
          style={inputStyle}
        />
      </Field>
```

- [ ] **Step 5: Run the web test to verify it passes**

Run: `pnpm --filter web run test -- RecipeForm`
Expected: PASS.

- [ ] **Step 6: Web TS quality gate**

Run: `pnpm --filter web run typecheck && pnpm --filter web run lint && pnpm --filter web run format:check`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/types/recipe.ts apps/web/src/components/admin/RecipeForm.tsx apps/web/tests/admin/RecipeForm.test.tsx
git commit -m "feat(web): admin recipe form edits display metadata"
```

---

## Task 6: Docs + PR

**Files:**
- Modify: `CLAUDE.md` (content-generation section)

- [ ] **Step 1: Document the new recipe fields in CLAUDE.md**

In `CLAUDE.md`, in the "Content generation" → "Recipes" bullet, append a sentence after the existing recipe description:

```markdown
Each recipe also carries **display metadata** for the catalog card: `title` (required), `description`, `tags` (string array; the seed for future themed collections), and `thumbnail_url` (a **public** HTTPS example image — no auth-gated streaming, unlike gallery results). The catalog is a **single flat list** today (sorted `publish_date DESC, display_order ASC`); collections are deferred until recipe volume warrants them.
```

- [ ] **Step 2: Run the full per-language gates once more before PR**

Run (Python): `cd apps/api && python -m pytest -q && python -m black --check src tests && python -m ruff check src tests && python -m mypy --strict src`
Run (TS): `pnpm -r run typecheck && pnpm -r run test && pnpm -r run lint && pnpm -r run format:check`
Expected: all green.

- [ ] **Step 3: Commit docs + the already-staged CLAUDE.md identity edit and push**

```bash
git add CLAUDE.md
git commit -m "docs: clarify trend-recipe identity + document recipe display metadata"
git push -u origin feat/recipe-display-metadata
```

- [ ] **Step 4: Open the PR**

```bash
gh pr create --title "feat(recipes): catalog display metadata (title/description/tags/thumbnail_url)" \
  --body "Adds the four display-metadata fields end-to-end (DB→migration→API→mobile→web). Single-list catalog; collections deferred. Personal-color identity clarified in CLAUDE.md (hook only; no modifier expansion). thumbnail_url is a public URL. See docs/superpowers/plans/2026-06-23-recipe-display-metadata.md."
```

---

## Self-Review Notes

- **Spec coverage:** all 4 fields added at every layer (DB, migration, admin schema/router, public schema, mobile, web). Alembic test trio updated (head id, chain length 6→7, file count 6→7, integration `_HEAD_REVISION`). Both `_make_recipe` helpers updated so transient-ORM `model_validate` doesn't fail on required `title`. Existing admin create payloads patched for the now-required `title`.
- **Type consistency:** wire `thumbnail_url` ↔ camel `thumbnailUrl`; `tags` is `list[str]`/`readonly string[]`/`string[]` per layer; `title` required everywhere except `RecipeUpdate` (PATCH-optional). Public catalog keeps `model_id`/`prompt_template`/`parameters` hidden.
- **Nullable-field clearing:** `update_recipe` gates `description`/`thumbnail_url` on `body.model_fields_set` (presence) rather than `is not None`, so an explicit `null` clears them and an omitted key leaves them unchanged — admin "full CRUD" is honored (R1 HIGH fix).
- **`thumbnail_url` validation:** a shared Pydantic field validator on `RecipeCreate`/`RecipeUpdate` rejects non-`https://` values (no `http://`, relative paths, storage keys, or empty strings), enforcing the public-HTTPS constraint at the API boundary; the web form converts blank input to `null` before send (R1 HIGH fix).
- **Existing-row backfill:** the migration backfills `title` from `recipe_id` for pre-existing rows then drops the server_default, so no published recipe renders with a blank card and future inserts are operator-required (R1 HIGH fix).
- **Deferred (not in this plan):** admin "use this preview as thumbnail" upload flow (operational follow-up — operator pastes a public URL for now); themed collections; multi-cut is already supported by prompt + params (no work).
