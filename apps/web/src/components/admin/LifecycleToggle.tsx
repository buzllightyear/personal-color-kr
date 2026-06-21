'use client';

/**
 * LifecycleToggle — inline lifecycle action buttons for a recipe row.
 *
 * Allowed transitions (Seed state machine)
 * -----------------------------------------
 *   hidden    → Publish button → published
 *   published → Hide button    → hidden
 *   *         → Delete button  → deleted  (terminal; not shown if already deleted)
 *
 * Props
 * -----
 * token          — Bearer token for API calls.
 * recipe         — The recipe object (current status drives which buttons appear).
 * onStatusChange — Called with the updated recipe after a successful transition.
 */

import React, { useState } from 'react';
import type { Recipe } from '@/types/recipe';
import { ApiError, deleteRecipe, hideRecipe, publishRecipe } from '@/lib/api';

interface LifecycleToggleProps {
  token: string;
  recipe: Recipe;
  onStatusChange: (updated: Recipe) => void;
}

export default function LifecycleToggle({
  token,
  recipe,
  onStatusChange,
}: LifecycleToggleProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function transition(
    action: () => Promise<Recipe>,
    confirmMessage?: string,
  ): Promise<void> {
    if (confirmMessage !== undefined) {
      if (!window.confirm(confirmMessage)) return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await action();
      onStatusChange(updated);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.detail);
      } else {
        setError('Transition failed');
      }
    } finally {
      setBusy(false);
    }
  }

  const { status, recipe_id } = recipe;
  const isDeleted = status === 'deleted';

  return (
    <span style={{ display: 'inline-flex', gap: '0.375rem', alignItems: 'center' }}>
      {status === 'hidden' && (
        <button
          onClick={() => void transition(() => publishRecipe(token, recipe_id))}
          disabled={busy}
          aria-label={`Publish ${recipe_id}`}
          style={{
            padding: '0.25rem 0.75rem',
            background: '#16a34a',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: busy ? 'not-allowed' : 'pointer',
            fontSize: '0.8125rem',
          }}
        >
          Publish
        </button>
      )}

      {status === 'published' && (
        <button
          onClick={() => void transition(() => hideRecipe(token, recipe_id))}
          disabled={busy}
          aria-label={`Hide ${recipe_id}`}
          style={{
            padding: '0.25rem 0.75rem',
            background: '#6b7280',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: busy ? 'not-allowed' : 'pointer',
            fontSize: '0.8125rem',
          }}
        >
          Hide
        </button>
      )}

      {!isDeleted && (
        <button
          onClick={() =>
            void transition(
              () => deleteRecipe(token, recipe_id),
              `Soft-delete "${recipe_id}"? This cannot be undone.`,
            )
          }
          disabled={busy}
          aria-label={`Delete ${recipe_id}`}
          style={{
            padding: '0.25rem 0.75rem',
            background: '#dc2626',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: busy ? 'not-allowed' : 'pointer',
            fontSize: '0.8125rem',
          }}
        >
          Delete
        </button>
      )}

      {error !== null && (
        <span role="alert" style={{ color: '#c00', fontSize: '0.75rem' }}>
          {error}
        </span>
      )}
    </span>
  );
}
