/**
 * Tests for LifecycleToggle component.
 *
 * Verifies:
 * - Shows Publish + Delete for hidden recipes.
 * - Shows Hide + Delete for published recipes.
 * - Shows no action buttons for deleted recipes.
 * - Publish button calls publishRecipe endpoint.
 * - Hide button calls hideRecipe endpoint.
 * - Delete button shows confirm dialog and calls deleteRecipe on confirm.
 * - onStatusChange is called with the updated recipe after a successful transition.
 * - Shows an error message on transition failure.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import LifecycleToggle from '@/components/admin/LifecycleToggle';
import type { Recipe } from '@/types/recipe';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: 'uuid-1',
    recipe_id: 'test-recipe',
    model_id: 'fal-ai/flux/dev',
    prompt_template: 'A portrait',
    title: 'Existing Recipe',
    description: null,
    tags: [],
    thumbnail_url: null,
    style_reference_key: null,
    parameters: {},
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
  // Default confirm = true (user confirms dialogs)
  vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LifecycleToggle — hidden recipe', () => {
  it('shows Publish and Delete buttons', () => {
    const recipe = makeRecipe({ status: 'hidden' });
    render(<LifecycleToggle token="tk" recipe={recipe} onStatusChange={vi.fn()} />);

    expect(
      screen.getByRole('button', { name: /publish test-recipe/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /delete test-recipe/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /hide test-recipe/i }),
    ).not.toBeInTheDocument();
  });

  it('calls publish endpoint and onStatusChange on Publish click', async () => {
    const user = userEvent.setup();
    const recipe = makeRecipe({ status: 'hidden' });
    const onStatusChange = vi.fn();
    const published = makeRecipe({ status: 'published' });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(published),
      }),
    );

    render(
      <LifecycleToggle token="tk" recipe={recipe} onStatusChange={onStatusChange} />,
    );

    await user.click(screen.getByRole('button', { name: /publish test-recipe/i }));

    await waitFor(() => {
      expect(onStatusChange).toHaveBeenCalledWith(published);
    });

    const [url, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toMatch(/\/v1\/admin\/recipes\/test-recipe\/publish$/);
    expect((opts as { method?: string }).method).toBe('POST');
  });
});

describe('LifecycleToggle — published recipe', () => {
  it('shows Hide and Delete buttons', () => {
    const recipe = makeRecipe({ status: 'published' });
    render(<LifecycleToggle token="tk" recipe={recipe} onStatusChange={vi.fn()} />);

    expect(
      screen.getByRole('button', { name: /hide test-recipe/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /delete test-recipe/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /publish test-recipe/i }),
    ).not.toBeInTheDocument();
  });

  it('calls hide endpoint and onStatusChange on Hide click', async () => {
    const user = userEvent.setup();
    const recipe = makeRecipe({ status: 'published' });
    const onStatusChange = vi.fn();
    const hidden = makeRecipe({ status: 'hidden' });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(hidden),
      }),
    );

    render(
      <LifecycleToggle token="tk" recipe={recipe} onStatusChange={onStatusChange} />,
    );

    await user.click(screen.getByRole('button', { name: /hide test-recipe/i }));

    await waitFor(() => {
      expect(onStatusChange).toHaveBeenCalledWith(hidden);
    });

    const [url, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toMatch(/\/v1\/admin\/recipes\/test-recipe\/hide$/);
    expect((opts as { method?: string }).method).toBe('POST');
  });
});

describe('LifecycleToggle — deleted recipe', () => {
  it('shows no action buttons', () => {
    const recipe = makeRecipe({ status: 'deleted' });
    render(<LifecycleToggle token="tk" recipe={recipe} onStatusChange={vi.fn()} />);

    expect(
      screen.queryByRole('button', { name: /publish test-recipe/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /hide test-recipe/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /delete test-recipe/i }),
    ).not.toBeInTheDocument();
  });
});

describe('LifecycleToggle — delete flow', () => {
  it('calls delete endpoint when confirm returns true', async () => {
    const user = userEvent.setup();
    const recipe = makeRecipe({ status: 'hidden' });
    const onStatusChange = vi.fn();
    const deleted = makeRecipe({ status: 'deleted' });

    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(deleted),
      }),
    );

    render(
      <LifecycleToggle token="tk" recipe={recipe} onStatusChange={onStatusChange} />,
    );

    await user.click(screen.getByRole('button', { name: /delete test-recipe/i }));

    await waitFor(() => {
      expect(onStatusChange).toHaveBeenCalledWith(deleted);
    });

    const [url, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toMatch(/\/v1\/admin\/recipes\/test-recipe$/);
    expect((opts as { method?: string }).method).toBe('DELETE');
  });

  it('does NOT call delete when confirm returns false', async () => {
    const user = userEvent.setup();
    const recipe = makeRecipe({ status: 'hidden' });
    const onStatusChange = vi.fn();

    vi.stubGlobal('confirm', vi.fn().mockReturnValue(false));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(
      <LifecycleToggle token="tk" recipe={recipe} onStatusChange={onStatusChange} />,
    );

    await user.click(screen.getByRole('button', { name: /delete test-recipe/i }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it('shows an error message on transition failure', async () => {
    const user = userEvent.setup();
    const recipe = makeRecipe({ status: 'hidden' });

    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        statusText: 'Unprocessable Entity',
        json: () =>
          Promise.resolve({
            detail: 'Cannot transition recipe from hidden to deleted.',
          }),
      }),
    );

    render(<LifecycleToggle token="tk" recipe={recipe} onStatusChange={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /delete test-recipe/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });
});
