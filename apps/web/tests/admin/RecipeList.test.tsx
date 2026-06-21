/**
 * Tests for RecipeList component.
 *
 * Verifies:
 * - Shows loading state initially.
 * - Renders recipe rows after a successful fetch.
 * - Shows an error message on fetch failure.
 * - Shows empty state when no recipes exist.
 * - Calls onEdit with recipe_id when Edit is clicked.
 * - Calls onNew when New Recipe is clicked.
 * - Status badges render for each status.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import RecipeList from '@/components/admin/RecipeList';
import type { Recipe } from '@/types/recipe';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: '123e4567-e89b-12d3-a456-426614174000',
    recipe_id: 'summer-glow',
    model_id: 'fal-ai/flux/dev',
    prompt_template: 'A portrait in summer light',
    style_reference_key: null,
    parameters: { steps: 30 },
    status: 'hidden',
    publish_date: null,
    display_order: 0,
    created_at: '2026-06-21T00:00:00Z',
    updated_at: '2026-06-21T00:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RecipeList', () => {
  it('shows loading state on mount', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => new Promise(() => {}), // never resolves
      }),
    );

    render(<RecipeList token="tk" onEdit={vi.fn()} onNew={vi.fn()} />);
    expect(screen.getByText(/loading recipes/i)).toBeInTheDocument();
  });

  it('renders recipe rows after successful fetch', async () => {
    const recipe = makeRecipe({ recipe_id: 'summer-glow', status: 'published' });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ recipes: [recipe], total: 1 }),
      }),
    );

    render(<RecipeList token="tk" onEdit={vi.fn()} onNew={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('summer-glow')).toBeInTheDocument();
    });

    expect(screen.getByText('fal-ai/flux/dev')).toBeInTheDocument();
    expect(screen.getByLabelText(/status: published/i)).toBeInTheDocument();
  });

  it('shows an error message when fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({ detail: 'server_error' }),
      }),
    );

    render(<RecipeList token="tk" onEdit={vi.fn()} onNew={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    expect(screen.getByRole('alert').textContent).toMatch(/failed to load/i);
  });

  it('shows empty state when recipes array is empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ recipes: [], total: 0 }),
      }),
    );

    render(<RecipeList token="tk" onEdit={vi.fn()} onNew={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/no recipes yet/i)).toBeInTheDocument();
    });
  });

  it('calls onEdit with recipe_id when Edit button is clicked', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const recipe = makeRecipe({ recipe_id: 'my-recipe', status: 'hidden' });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ recipes: [recipe], total: 1 }),
      }),
    );

    render(<RecipeList token="tk" onEdit={onEdit} onNew={vi.fn()} />);

    await waitFor(() => screen.getByText('my-recipe'));
    await user.click(screen.getByRole('button', { name: /^edit$/i }));

    expect(onEdit).toHaveBeenCalledWith('my-recipe');
  });

  it('calls onNew when New Recipe button is clicked', async () => {
    const user = userEvent.setup();
    const onNew = vi.fn();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ recipes: [], total: 0 }),
      }),
    );

    render(<RecipeList token="tk" onEdit={vi.fn()} onNew={onNew} />);

    await waitFor(() => screen.getByRole('button', { name: /\+ new recipe/i }));
    await user.click(screen.getByRole('button', { name: /\+ new recipe/i }));

    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it('shows status badges for all three status values', async () => {
    const recipes = [
      makeRecipe({ recipe_id: 'r1', status: 'published' }),
      makeRecipe({ recipe_id: 'r2', status: 'hidden' }),
      makeRecipe({ recipe_id: 'r3', status: 'deleted' }),
    ];

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ recipes, total: 3 }),
      }),
    );

    render(<RecipeList token="tk" onEdit={vi.fn()} onNew={vi.fn()} />);

    await waitFor(() => screen.getByText('r1'));

    expect(screen.getByLabelText(/status: published/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/status: hidden/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/status: deleted/i)).toBeInTheDocument();
  });
});
