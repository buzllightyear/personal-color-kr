/**
 * E2E smoke test: Admin UI — create recipe and preview happy path.
 *
 * Flow
 * ----
 * 1. Navigate to /admin  →  credential guard renders (no token in localStorage)
 * 2. Enter the admin token and submit  →  RecipeList renders
 * 3. Click "+ New Recipe"  →  navigate to /admin/recipes/new
 * 4. Fill the create form
 * 5. Click "Create Recipe"  →  POST /v1/admin/recipes (mocked) returns a recipe
 * 6. Success redirects to /admin/recipes/{recipe_id}
 * 7. Edit page fetches the recipe  →  GET /v1/admin/recipes/{id} (mocked)
 * 8. Click "Generate Preview"  →  POST /v1/admin/recipes/{id}/preview (mocked)
 * 9. Assert: preview <img> element is visible with the mocked image URL
 *
 * All API calls are intercepted by Playwright route mocks so no real backend
 * is required.
 */

import { test, expect, type Page, type Route } from '@playwright/test';

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

const ADMIN_TOKEN = 'test-admin-secret';
const RECIPE_ID = 'e2e-test-recipe';
const PREVIEW_IMAGE_URL = 'https://example.com/generated-preview.jpg';

/** The recipe object returned by POST /v1/admin/recipes and GET …/{id} */
const MOCK_RECIPE = {
  id: 'uuid-1234',
  recipe_id: RECIPE_ID,
  model_id: 'fal-ai/flux/dev',
  prompt_template: 'Portrait of a {personal_color} person in soft editorial lighting',
  style_reference_key: null,
  parameters: { num_inference_steps: 30, guidance_scale: 7.5 },
  status: 'hidden',
  publish_date: null,
  display_order: 0,
  created_at: '2026-06-21T00:00:00Z',
  updated_at: '2026-06-21T00:00:00Z',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Register all API route mocks needed for the full create-preview journey. */
async function setupApiMocks(page: Page): Promise<void> {
  const API_BASE = 'http://localhost:8000';

  // GET /v1/admin/recipes — recipe list (empty; the new recipe isn't listed yet)
  await page.route(`${API_BASE}/v1/admin/recipes`, (route: Route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ recipes: [], total: 0 }),
      });
    }
    // POST — create recipe
    return route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_RECIPE),
    });
  });

  // GET /v1/admin/recipes/{id} — fetch recipe for edit page
  await page.route(
    `${API_BASE}/v1/admin/recipes/${encodeURIComponent(RECIPE_ID)}`,
    (route: Route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_RECIPE),
        });
      }
      // Fall through for other methods (PUT, DELETE, etc.)
      return route.continue();
    },
  );

  // POST /v1/admin/recipes/{id}/preview
  await page.route(
    `${API_BASE}/v1/admin/recipes/${encodeURIComponent(RECIPE_ID)}/preview`,
    (route: Route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ image_url: PREVIEW_IMAGE_URL }),
      });
    },
  );
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test('admin create-and-preview happy path', async ({ page }) => {
  await setupApiMocks(page);

  // ── Step 1: Navigate to /admin ─────────────────────────────────────────
  await page.goto('/admin');

  // AdminAuthGuard renders the credential prompt (no localStorage token yet)
  const tokenInput = page.locator('#admin-token-input');
  await expect(tokenInput).toBeVisible();

  // ── Step 2: Authenticate ───────────────────────────────────────────────
  await tokenInput.fill(ADMIN_TOKEN);
  await page.locator('button[type="submit"]').click();

  // RecipeList renders after authentication — wait for heading
  const recipesHeading = page.getByRole('heading', { name: 'Recipes' });
  await expect(recipesHeading).toBeVisible();

  // ── Step 3: Navigate to create form ───────────────────────────────────
  await page.getByRole('button', { name: '+ New Recipe' }).click();

  // Confirm we are on the create form
  const createFormHeading = page.getByRole('heading', { name: 'New Recipe' });
  await expect(createFormHeading).toBeVisible();

  // ── Step 4: Fill the create form ──────────────────────────────────────
  await page.locator('#field-recipe-id').fill(RECIPE_ID);
  await page.locator('#field-model-id').fill(MOCK_RECIPE.model_id);
  await page.locator('#field-prompt').fill(MOCK_RECIPE.prompt_template);
  // Leave style_reference_key blank (optional)
  // parameters defaults to `{}` which is valid JSON
  // leave status as default "hidden"
  // leave publish_date and display_order as defaults

  // ── Step 5: Submit the form ───────────────────────────────────────────
  await page.getByRole('button', { name: 'Create Recipe' }).click();

  // ── Step 6: Redirected to edit page ──────────────────────────────────
  // After success, NewRecipePage calls router.push(`/admin/recipes/${recipe_id}`)
  await page.waitForURL(`**/admin/recipes/${RECIPE_ID}`);

  // ── Step 7: Edit page loads (GET recipe mocked) ───────────────────────
  // RecipeForm in edit mode shows "Edit: {recipe_id}" heading
  const editHeading = page.getByRole('heading', { name: `Edit: ${RECIPE_ID}` });
  await expect(editHeading).toBeVisible();

  // RecipePreview section is also rendered below the form
  const previewSection = page.getByRole('heading', { name: 'Preview' });
  await expect(previewSection).toBeVisible();

  // ── Step 8: Trigger preview generation ───────────────────────────────
  const generateButton = page.getByRole('button', { name: 'Generate Preview' });
  await expect(generateButton).toBeEnabled();
  await generateButton.click();

  // ── Step 9: Assert preview image is rendered ──────────────────────────
  // RecipePreview renders <img alt="Preview for recipe {id}"> once the
  // API call resolves. The image src must match the mocked URL.
  const previewImg = page.locator(`img[alt="Preview for recipe ${RECIPE_ID}"]`);
  await expect(previewImg).toBeVisible({ timeout: 15_000 });
  await expect(previewImg).toHaveAttribute('src', PREVIEW_IMAGE_URL);
});
