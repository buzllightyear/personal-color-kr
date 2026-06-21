'use client';

/**
 * /admin/recipes/new — Create recipe page.
 *
 * Renders RecipeForm in create mode.
 * On success, redirects back to the recipe list.
 */

import React from 'react';
import { useRouter } from 'next/navigation';
import RecipeForm from '@/components/admin/RecipeForm';
import { useAdminToken } from '@/components/admin/AdminAuthGuard';
import type { Recipe } from '@/types/recipe';

export default function NewRecipePage() {
  const router = useRouter();
  const { token } = useAdminToken();

  function handleSuccess(recipe: Recipe): void {
    // Navigate to the edit page for the newly created recipe
    router.push(`/admin/recipes/${encodeURIComponent(recipe.recipe_id)}`);
  }

  return (
    <RecipeForm
      token={token}
      onSuccess={handleSuccess}
      onCancel={() => router.push('/admin')}
    />
  );
}
