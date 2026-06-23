/**
 * Client-side type definitions for the recipe admin domain.
 *
 * These mirror the Pydantic response schemas from apps/api/src/api/schemas/recipes.py
 * and are used by all admin UI components.
 */

export type RecipeStatus = 'published' | 'hidden' | 'deleted';

export interface Recipe {
  id: string;
  recipe_id: string;
  model_id: string;
  prompt_template: string;
  title: string;
  description: string | null;
  tags: string[];
  thumbnail_url: string | null;
  style_reference_key: string | null;
  parameters: Record<string, unknown>;
  status: RecipeStatus;
  publish_date: string | null;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface RecipeListResponse {
  recipes: Recipe[];
  total: number;
}

/** Fields required when creating a new recipe. */
export interface RecipeCreate {
  recipe_id: string;
  model_id: string;
  prompt_template: string;
  title: string;
  description: string | null;
  tags: string[];
  thumbnail_url: string | null;
  style_reference_key: string | null;
  parameters: Record<string, unknown>;
  status: RecipeStatus;
  publish_date: string | null;
  display_order: number;
}

/** All fields are optional on update (PATCH semantics via PUT). */
export interface RecipeUpdate {
  model_id?: string;
  prompt_template?: string;
  title?: string;
  description?: string | null;
  tags?: string[];
  thumbnail_url?: string | null;
  style_reference_key?: string | null;
  parameters?: Record<string, unknown>;
  publish_date?: string | null;
  display_order?: number;
}

export interface RecipePreviewResponse {
  image_url: string;
}
