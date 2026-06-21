/**
 * Admin API client for the recipe management endpoints.
 *
 * All requests carry ``Authorization: Bearer <token>`` where the token
 * is the ``ADMIN_TOKEN`` env var configured on the API server and entered
 * by the operator in the credential guard prompt.
 *
 * Base URL is read from ``NEXT_PUBLIC_API_BASE_URL`` (defaults to
 * http://localhost:8000 for local dev).
 */
import type {
  Recipe,
  RecipeCreate,
  RecipeListResponse,
  RecipePreviewResponse,
  RecipeUpdate,
} from '@/types/recipe';

function getApiBase(): string {
  if (typeof process !== 'undefined' && process.env['NEXT_PUBLIC_API_BASE_URL']) {
    return process.env['NEXT_PUBLIC_API_BASE_URL'];
  }
  return 'http://localhost:8000';
}

/** Thrown when the API returns a non-2xx status. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: string,
  ) {
    super(`API ${status}: ${detail}`);
    this.name = 'ApiError';
  }
}

async function apiFetch<T>(
  path: string,
  token: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${getApiBase()}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers ?? {}),
    },
  });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = (await response.json()) as { detail?: string };
      if (typeof body.detail === 'string') {
        detail = body.detail;
      }
    } catch {
      // keep statusText
    }
    throw new ApiError(response.status, detail);
  }

  return response.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Recipe CRUD
// ---------------------------------------------------------------------------

export function listRecipes(token: string): Promise<RecipeListResponse> {
  return apiFetch<RecipeListResponse>('/v1/admin/recipes', token);
}

export function getRecipe(token: string, recipeId: string): Promise<Recipe> {
  return apiFetch<Recipe>(`/v1/admin/recipes/${encodeURIComponent(recipeId)}`, token);
}

export function createRecipe(token: string, body: RecipeCreate): Promise<Recipe> {
  return apiFetch<Recipe>('/v1/admin/recipes', token, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function updateRecipe(
  token: string,
  recipeId: string,
  body: RecipeUpdate,
): Promise<Recipe> {
  return apiFetch<Recipe>(`/v1/admin/recipes/${encodeURIComponent(recipeId)}`, token, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Lifecycle transitions
// ---------------------------------------------------------------------------

export function publishRecipe(token: string, recipeId: string): Promise<Recipe> {
  return apiFetch<Recipe>(
    `/v1/admin/recipes/${encodeURIComponent(recipeId)}/publish`,
    token,
    { method: 'POST' },
  );
}

export function hideRecipe(token: string, recipeId: string): Promise<Recipe> {
  return apiFetch<Recipe>(
    `/v1/admin/recipes/${encodeURIComponent(recipeId)}/hide`,
    token,
    { method: 'POST' },
  );
}

export function deleteRecipe(token: string, recipeId: string): Promise<Recipe> {
  return apiFetch<Recipe>(`/v1/admin/recipes/${encodeURIComponent(recipeId)}`, token, {
    method: 'DELETE',
  });
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

export function previewRecipe(
  token: string,
  recipeId: string,
): Promise<RecipePreviewResponse> {
  return apiFetch<RecipePreviewResponse>(
    `/v1/admin/recipes/${encodeURIComponent(recipeId)}/preview`,
    token,
    { method: 'POST' },
  );
}
