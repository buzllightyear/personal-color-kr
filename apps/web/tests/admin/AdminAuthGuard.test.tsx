/**
 * Tests for AdminAuthGuard component.
 *
 * Verifies:
 * - Shows credential prompt when no token is in localStorage.
 * - Renders children when a valid token is stored.
 * - Stores the entered token in localStorage on submit.
 * - useAdminToken hook provides the stored token to children.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import AdminAuthGuard, { useAdminToken } from '@/components/admin/AdminAuthGuard';

// ---------------------------------------------------------------------------
// localStorage mock
// ---------------------------------------------------------------------------

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });

beforeEach(() => {
  localStorageMock.clear();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Test helper: component that reads token from context
// ---------------------------------------------------------------------------

function TokenDisplay() {
  const { token } = useAdminToken();
  return <span data-testid="token-display">{token}</span>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AdminAuthGuard', () => {
  it('shows the credential prompt when no token is stored', async () => {
    render(
      <AdminAuthGuard>
        <div>Secret content</div>
      </AdminAuthGuard>,
    );

    // Wait for mounted (useEffect fires after render)
    await waitFor(() => {
      expect(screen.getByLabelText(/admin token/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/admin login/i)).toBeInTheDocument();
    expect(screen.queryByText('Secret content')).not.toBeInTheDocument();
  });

  it('renders children when a token is already in localStorage', async () => {
    localStorageMock.setItem('admin_token', 'my-test-token');

    render(
      <AdminAuthGuard>
        <div>Protected content</div>
      </AdminAuthGuard>,
    );

    await waitFor(() => {
      expect(screen.getByText('Protected content')).toBeInTheDocument();
    });
  });

  it('stores the entered token and reveals children on submit', async () => {
    const user = userEvent.setup();

    render(
      <AdminAuthGuard>
        <TokenDisplay />
      </AdminAuthGuard>,
    );

    // Wait for the prompt to appear
    await waitFor(() => {
      expect(screen.getByLabelText(/admin token/i)).toBeInTheDocument();
    });

    const input = screen.getByLabelText(/admin token/i);
    await user.type(input, 'super-secret-token');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByTestId('token-display')).toHaveTextContent(
        'super-secret-token',
      );
    });

    expect(localStorageMock.getItem('admin_token')).toBe('super-secret-token');
  });

  it('disables the submit button when the input is empty', async () => {
    render(
      <AdminAuthGuard>
        <div />
      </AdminAuthGuard>,
    );

    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /sign in/i });
      expect(btn).toBeDisabled();
    });
  });

  it('provides the token to deeply nested children via useAdminToken', async () => {
    localStorageMock.setItem('admin_token', 'nested-token');

    render(
      <AdminAuthGuard>
        <TokenDisplay />
      </AdminAuthGuard>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('token-display')).toHaveTextContent('nested-token');
    });
  });
});
