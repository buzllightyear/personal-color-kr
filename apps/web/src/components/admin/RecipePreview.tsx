'use client';

/**
 * RecipePreview — calls the fal.ai preview endpoint and displays the result.
 *
 * Behaviour
 * ---------
 * 1. Renders a "Generate Preview" button.
 * 2. On click, calls ``POST /v1/admin/recipes/{recipe_id}/preview`` via the
 *    admin API client.
 * 3. Shows a loading state while the fal.ai generation runs (may take several
 *    seconds).
 * 4. On success, displays the returned image URL in an ``<img>`` element.
 * 5. On failure, shows an error message with the API error detail.
 * 6. Supports regeneration via a "Regenerate" button once an image is shown.
 *
 * Props
 * -----
 * token      — Bearer token for API calls.
 * recipeId   — The human-readable recipe_id to preview.
 */

import React, { useState } from 'react';
import { ApiError, previewRecipe } from '@/lib/api';

interface RecipePreviewProps {
  token: string;
  recipeId: string;
}

export default function RecipePreview({ token, recipeId }: RecipePreviewProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate(): Promise<void> {
    setLoading(true);
    setError(null);

    try {
      const result = await previewRecipe(token, recipeId);
      setImageUrl(result.image_url);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(`Preview failed (${err.status}): ${err.detail}`);
      } else {
        setError('Preview failed — unexpected error');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.75rem' }}>
        Preview
      </h3>

      <button
        onClick={() => void generate()}
        disabled={loading}
        style={{
          padding: '0.5rem 1rem',
          background: loading ? '#6b7280' : '#000',
          color: '#fff',
          border: 'none',
          borderRadius: '4px',
          cursor: loading ? 'not-allowed' : 'pointer',
          fontSize: '0.875rem',
        }}
      >
        {loading
          ? 'Generating…'
          : imageUrl !== null
            ? 'Regenerate'
            : 'Generate Preview'}
      </button>

      {loading && (
        <p
          aria-live="polite"
          style={{ marginTop: '0.75rem', color: '#555', fontSize: '0.875rem' }}
        >
          Calling fal.ai — this may take a few seconds…
        </p>
      )}

      {!loading && error !== null && (
        <p
          role="alert"
          style={{ marginTop: '0.75rem', color: '#c00', fontSize: '0.875rem' }}
        >
          {error}
        </p>
      )}

      {!loading && imageUrl !== null && (
        <div style={{ marginTop: '1rem' }}>
          {/* Admin preview renders the raw fal.ai result URL directly; the
              Next <Image> optimizer is intentionally bypassed for this
              internal single-operator tool. */}
          <img
            src={imageUrl}
            alt={`Preview for recipe ${recipeId}`}
            style={{
              maxWidth: '100%',
              maxHeight: '480px',
              objectFit: 'contain',
              border: '1px solid #e5e7eb',
              borderRadius: '8px',
            }}
          />
          <p style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: '#6b7280' }}>
            <a href={imageUrl} target="_blank" rel="noopener noreferrer">
              Open full size ↗
            </a>
          </p>
        </div>
      )}
    </div>
  );
}
