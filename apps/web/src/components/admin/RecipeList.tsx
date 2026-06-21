'use client';

/**
 * RecipeList — displays the full recipe catalog for admin operators.
 *
 * Features
 * --------
 * - Fetches all recipes (no status filter — admins see everything).
 * - Displays status badge (published / hidden / deleted) per row.
 * - Inline lifecycle toggle actions via the LifecycleToggle component.
 * - "New Recipe" button routes to the create form.
 * - "Edit" button routes to the edit form.
 * - Loading, error, and empty states.
 *
 * Props
 * -----
 * token     — Bearer token for API calls.
 * onEdit    — Called with recipe_id when operator clicks Edit.
 * onNew     — Called when operator clicks New Recipe.
 */

import React, { useCallback, useEffect, useState } from 'react';
import type { Recipe } from '@/types/recipe';
import { ApiError, listRecipes } from '@/lib/api';
import LifecycleToggle from './LifecycleToggle';

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, string> = {
  published: '#16a34a',
  hidden: '#6b7280',
  deleted: '#dc2626',
};

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? '#000';
  return (
    <span
      aria-label={`status: ${status}`}
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: '9999px',
        background: color,
        color: '#fff',
        fontSize: '0.75rem',
        fontWeight: 600,
        textTransform: 'capitalize',
      }}
    >
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// RecipeList
// ---------------------------------------------------------------------------

interface RecipeListProps {
  token: string;
  onEdit: (recipeId: string) => void;
  onNew: () => void;
}

export default function RecipeList({ token, onEdit, onNew }: RecipeListProps) {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRecipes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listRecipes(token);
      setRecipes(data.recipes);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(`Failed to load recipes: ${err.detail}`);
      } else {
        setError('Failed to load recipes');
      }
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void fetchRecipes();
  }, [fetchRecipes]);

  function handleStatusChange(updated: Recipe): void {
    setRecipes((prev) =>
      prev.map((r) => (r.recipe_id === updated.recipe_id ? updated : r)),
    );
  }

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '1.5rem',
        }}
      >
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Recipes</h2>
        <button
          onClick={onNew}
          style={{
            padding: '0.5rem 1rem',
            background: '#000',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '0.875rem',
          }}
        >
          + New Recipe
        </button>
      </div>

      {loading && <p aria-live="polite">Loading recipes…</p>}

      {!loading && error !== null && (
        <p role="alert" style={{ color: '#c00' }}>
          {error}
        </p>
      )}

      {!loading && error === null && recipes.length === 0 && (
        <p>No recipes yet. Create the first one!</p>
      )}

      {!loading && error === null && recipes.length > 0 && (
        <table
          style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}
        >
          <thead>
            <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
              <th style={{ textAlign: 'left', padding: '0.5rem' }}>ID</th>
              <th style={{ textAlign: 'left', padding: '0.5rem' }}>Model</th>
              <th style={{ textAlign: 'left', padding: '0.5rem' }}>Status</th>
              <th style={{ textAlign: 'left', padding: '0.5rem' }}>Order</th>
              <th style={{ textAlign: 'left', padding: '0.5rem' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {recipes.map((recipe) => (
              <tr
                key={recipe.recipe_id}
                style={{ borderBottom: '1px solid #f3f4f6' }}
              >
                <td style={{ padding: '0.75rem 0.5rem', fontFamily: 'monospace' }}>
                  {recipe.recipe_id}
                </td>
                <td style={{ padding: '0.75rem 0.5rem' }}>{recipe.model_id}</td>
                <td style={{ padding: '0.75rem 0.5rem' }}>
                  <StatusBadge status={recipe.status} />
                </td>
                <td style={{ padding: '0.75rem 0.5rem' }}>{recipe.display_order}</td>
                <td style={{ padding: '0.75rem 0.5rem' }}>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <button
                      onClick={() => onEdit(recipe.recipe_id)}
                      style={{
                        padding: '0.25rem 0.75rem',
                        border: '1px solid #000',
                        borderRadius: '4px',
                        background: '#fff',
                        cursor: 'pointer',
                        fontSize: '0.8125rem',
                      }}
                    >
                      Edit
                    </button>
                    <LifecycleToggle
                      token={token}
                      recipe={recipe}
                      onStatusChange={handleStatusChange}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
