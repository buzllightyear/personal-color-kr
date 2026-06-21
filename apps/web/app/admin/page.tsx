'use client';

/**
 * /admin — Recipe list page.
 *
 * Displays all recipes with their status and lifecycle action buttons.
 * Uses the stored admin token from AdminAuthGuard context.
 */

import React from 'react';
import { useRouter } from 'next/navigation';
import RecipeList from '@/components/admin/RecipeList';
import { useAdminToken } from '@/components/admin/AdminAuthGuard';

export default function AdminPage() {
  const router = useRouter();
  const { token } = useAdminToken();

  return (
    <RecipeList
      token={token}
      onEdit={(recipeId) => router.push(`/admin/recipes/${encodeURIComponent(recipeId)}`)}
      onNew={() => router.push('/admin/recipes/new')}
    />
  );
}
