'use client';

/**
 * /admin/recipes/[id] — Edit recipe page.
 *
 * Fetches the recipe by ``recipe_id``, renders RecipeForm in edit mode,
 * and embeds a RecipePreview section below the form.
 *
 * Route parameter: ``id`` is the human-readable ``recipe_id`` (URL-encoded).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import RecipeForm from '@/components/admin/RecipeForm';
import RecipePreview from '@/components/admin/RecipePreview';
import { useAdminToken } from '@/components/admin/AdminAuthGuard';
import { ApiError, getRecipe } from '@/lib/api';
import type { Recipe } from '@/types/recipe';

export default function EditRecipePage() {
  const router = useRouter();
  const params = useParams();
  const { token } = useAdminToken();

  const recipeId = decodeURIComponent(String(params['id'] ?? ''));

  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRecipe = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getRecipe(token, recipeId);
      setRecipe(data);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(`Could not load recipe: ${err.detail}`);
      } else {
        setError('Could not load recipe');
      }
    } finally {
      setLoading(false);
    }
  }, [token, recipeId]);

  useEffect(() => {
    void fetchRecipe();
  }, [fetchRecipe]);

  if (loading) {
    return <p aria-live="polite">Loading recipe…</p>;
  }

  if (error !== null || recipe === null) {
    return (
      <div>
        <p role="alert" style={{ color: '#c00' }}>
          {error ?? 'Recipe not found'}
        </p>
        <button
          onClick={() => router.push('/admin')}
          style={{ marginTop: '1rem', padding: '0.5rem 1rem' }}
        >
          ← Back to list
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '3rem' }}>
      <RecipeForm
        token={token}
        recipe={recipe}
        onSuccess={(updated) => setRecipe(updated)}
        onCancel={() => router.push('/admin')}
      />

      <hr style={{ border: 'none', borderTop: '1px solid #e5e7eb' }} />

      <RecipePreview token={token} recipeId={recipe.recipe_id} />
    </div>
  );
}
