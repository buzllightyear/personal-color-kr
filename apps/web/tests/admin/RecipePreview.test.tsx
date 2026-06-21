/**
 * Tests for RecipePreview component.
 *
 * Verifies:
 * - Renders the "Generate Preview" button initially.
 * - Shows loading state while preview is being generated.
 * - Displays the returned image on success.
 * - Shows an error message on failure.
 * - Shows "Regenerate" button after a successful generation.
 * - Calls the correct API endpoint (POST /admin/recipes/{id}/preview).
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import RecipePreview from '@/components/admin/RecipePreview';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RecipePreview', () => {
  it('renders the Generate Preview button initially', () => {
    render(<RecipePreview token="tk" recipeId="my-recipe" />);
    expect(
      screen.getByRole('button', { name: /generate preview/i }),
    ).toBeInTheDocument();
  });

  it('shows loading state while preview is generating', async () => {
    const user = userEvent.setup();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => new Promise(() => {}), // never resolves
      }),
    );

    render(<RecipePreview token="tk" recipeId="my-recipe" />);
    await user.click(screen.getByRole('button', { name: /generate preview/i }));

    expect(screen.getByRole('button', { name: /generating/i })).toBeDisabled();
    expect(screen.getByText(/calling fal\.ai/i)).toBeInTheDocument();
  });

  it('displays the returned image URL on success', async () => {
    const user = userEvent.setup();
    const imageUrl = 'https://fal.ai/outputs/preview.jpg';

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ image_url: imageUrl }),
      }),
    );

    render(<RecipePreview token="tk" recipeId="my-recipe" />);
    await user.click(screen.getByRole('button', { name: /generate preview/i }));

    await waitFor(() => {
      const img = screen.getByRole('img');
      expect(img).toHaveAttribute('src', imageUrl);
    });

    expect(screen.getByRole('img')).toHaveAttribute(
      'alt',
      'Preview for recipe my-recipe',
    );
  });

  it('shows an error message when the API fails', async () => {
    const user = userEvent.setup();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        json: () => Promise.resolve({ detail: { error: 'fal_key_not_configured' } }),
      }),
    );

    render(<RecipePreview token="tk" recipeId="my-recipe" />);
    await user.click(screen.getByRole('button', { name: /generate preview/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    expect(screen.getByRole('alert').textContent).toMatch(/preview failed/i);
  });

  it('shows Regenerate button after a successful generation', async () => {
    const user = userEvent.setup();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ image_url: 'https://fal.ai/outputs/img.jpg' }),
      }),
    );

    render(<RecipePreview token="tk" recipeId="my-recipe" />);
    await user.click(screen.getByRole('button', { name: /generate preview/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /regenerate/i })).toBeInTheDocument();
    });
  });

  it('calls POST /admin/recipes/{id}/preview with Bearer token', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ image_url: 'https://example.com/img.jpg' }),
    });

    vi.stubGlobal('fetch', fetchMock);

    render(<RecipePreview token="secret-token" recipeId="recipe-abc" />);
    await user.click(screen.getByRole('button', { name: /generate preview/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/v1\/admin\/recipes\/recipe-abc\/preview$/);
    expect((opts as RequestInit & { method?: string }).method).toBe('POST');
    const headers = opts.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer secret-token');
  });
});
