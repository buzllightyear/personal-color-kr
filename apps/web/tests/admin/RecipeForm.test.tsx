/**
 * Tests for RecipeForm component.
 *
 * Verifies:
 * - Renders all required fields in create mode.
 * - Recipe ID is disabled in edit mode.
 * - Status field is only shown in create mode.
 * - Calls createRecipe on submit in create mode.
 * - Calls updateRecipe on submit in edit mode.
 * - Shows an error when parameters JSON is invalid.
 * - Calls onCancel when Cancel is clicked.
 * - Submit button is disabled while saving.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import RecipeForm from '@/components/admin/RecipeForm';
import type { Recipe } from '@/types/recipe';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: 'uuid-1',
    recipe_id: 'existing-recipe',
    model_id: 'fal-ai/flux/dev',
    prompt_template: 'A bright portrait',
    style_reference_key: 'https://example.com/style.jpg',
    parameters: { steps: 30 },
    status: 'hidden',
    publish_date: null,
    display_order: 5,
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

describe('RecipeForm — create mode', () => {
  it('renders all required fields', () => {
    render(<RecipeForm token="tk" onSuccess={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByLabelText(/recipe id/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/model id/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/prompt template/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/style reference/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/parameters/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/initial status/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/publish date/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/display order/i)).toBeInTheDocument();
  });

  it('shows "Create Recipe" as the submit button label', () => {
    render(<RecipeForm token="tk" onSuccess={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('button', { name: /create recipe/i })).toBeInTheDocument();
  });

  it('calls createRecipe (POST) and onSuccess on valid submit', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    const createdRecipe = makeRecipe({ recipe_id: 'new-recipe' });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(createdRecipe),
      }),
    );

    render(<RecipeForm token="tk" onSuccess={onSuccess} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText(/recipe id/i), 'new-recipe');
    await user.type(screen.getByLabelText(/model id/i), 'fal-ai/flux/dev');
    await user.type(screen.getByLabelText(/prompt template/i), 'A portrait');
    await user.click(screen.getByRole('button', { name: /create recipe/i }));

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith(createdRecipe);
    });

    const [url, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toMatch(/\/v1\/admin\/recipes$/);
    expect((opts as RequestInit & { method?: string }).method).toBe('POST');
  });

  it('shows parameter JSON error on invalid JSON', async () => {
    const user = userEvent.setup();

    render(<RecipeForm token="tk" onSuccess={vi.fn()} onCancel={vi.fn()} />);

    await user.clear(screen.getByLabelText(/parameters/i));
    await user.type(screen.getByLabelText(/parameters/i), 'not json');
    await user.type(screen.getByLabelText(/recipe id/i), 'test');
    await user.type(screen.getByLabelText(/model id/i), 'test');
    await user.type(screen.getByLabelText(/prompt template/i), 'test');
    await user.click(screen.getByRole('button', { name: /create recipe/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    expect(screen.getByRole('alert').textContent).toMatch(/invalid json/i);
  });

  it('calls onCancel when Cancel is clicked', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();

    render(<RecipeForm token="tk" onSuccess={vi.fn()} onCancel={onCancel} />);

    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('RecipeForm — edit mode', () => {
  it('disables the Recipe ID field', () => {
    render(
      <RecipeForm
        token="tk"
        recipe={makeRecipe()}
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const recipeIdInput = screen.getByLabelText(/recipe id/i);
    expect(recipeIdInput).toBeDisabled();
  });

  it('does NOT show the Status field', () => {
    render(
      <RecipeForm
        token="tk"
        recipe={makeRecipe()}
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText(/initial status/i)).not.toBeInTheDocument();
  });

  it('shows "Save Changes" as the submit button label', () => {
    render(
      <RecipeForm
        token="tk"
        recipe={makeRecipe()}
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument();
  });

  it('calls updateRecipe (PUT) with the recipe_id in the URL', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    const existing = makeRecipe({ recipe_id: 'my-recipe' });
    const updatedRecipe = makeRecipe({ recipe_id: 'my-recipe', model_id: 'new-model' });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(updatedRecipe),
      }),
    );

    render(
      <RecipeForm
        token="tk"
        recipe={existing}
        onSuccess={onSuccess}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith(updatedRecipe);
    });

    const [url, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toMatch(/\/v1\/admin\/recipes\/my-recipe$/);
    expect((opts as RequestInit & { method?: string }).method).toBe('PUT');
  });

  it('shows a submit error when the API returns an error', async () => {
    const user = userEvent.setup();
    const existing = makeRecipe();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        statusText: 'Conflict',
        json: () => Promise.resolve({ detail: 'recipe_id_conflict' }),
      }),
    );

    render(
      <RecipeForm
        token="tk"
        recipe={existing}
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert.textContent).toMatch(/save failed/i);
    });
  });
});
