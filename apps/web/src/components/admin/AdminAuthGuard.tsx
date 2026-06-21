'use client';

/**
 * AdminAuthGuard — client-side credential guard for the admin UI.
 *
 * Behaviour
 * ---------
 * 1. On mount, reads an admin token from localStorage (key: ``admin_token``).
 * 2. If a token is found, renders children with the token injected via the
 *    ``AdminTokenContext``.
 * 3. If no token is found (or it was cleared after a 403), renders a
 *    credential prompt: a password-type input and a submit button.
 * 4. The entered token is stored in localStorage for subsequent page loads.
 * 5. Callers that receive a 403 from the API should call the exported
 *    ``clearAdminToken()`` helper and navigate to /admin to force
 *    re-authentication.
 *
 * Security note
 * -------------
 * localStorage is not a secure store (XSS-accessible), but this UI is
 * operator-only on a restricted route — not a public user surface.  The
 * Phase 1 constraint explicitly calls for "minimal auth (env password)".
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  type FormEvent,
} from 'react';

const STORAGE_KEY = 'admin_token';

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface AdminTokenContextValue {
  token: string;
  clearToken: () => void;
}

const AdminTokenContext = createContext<AdminTokenContextValue | null>(null);

/** Hook to access the current admin token from any child of AdminAuthGuard. */
export function useAdminToken(): AdminTokenContextValue {
  const ctx = useContext(AdminTokenContext);
  if (ctx === null) {
    throw new Error('useAdminToken must be used inside AdminAuthGuard');
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readStoredToken(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeToken(token: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, token);
  } catch {
    // ignore (private mode etc.)
  }
}

function clearStoredToken(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Credential prompt component
// ---------------------------------------------------------------------------

interface CredentialPromptProps {
  onSubmit: (token: string) => void;
  error: string | null;
}

function CredentialPrompt({ onSubmit, error }: CredentialPromptProps) {
  const [value, setValue] = useState('');

  function handleSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      onSubmit(trimmed);
    }
  }

  return (
    <div
      role="main"
      aria-label="Admin authentication"
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
          width: '320px',
        }}
      >
        <h1 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Admin Login</h1>
        <p style={{ fontSize: '0.875rem', color: '#555' }}>
          Enter the ADMIN_TOKEN to access recipe management.
        </p>
        {error !== null && (
          <p role="alert" style={{ color: '#c00', fontSize: '0.875rem' }}>
            {error}
          </p>
        )}
        <label htmlFor="admin-token-input" style={{ fontSize: '0.875rem', fontWeight: 500 }}>
          Admin Token
        </label>
        <input
          id="admin-token-input"
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Enter admin token"
          autoComplete="current-password"
          style={{
            padding: '0.5rem 0.75rem',
            border: '1px solid #ccc',
            borderRadius: '4px',
            fontSize: '1rem',
          }}
        />
        <button
          type="submit"
          disabled={value.trim().length === 0}
          style={{
            padding: '0.5rem 1rem',
            background: '#000',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            fontSize: '1rem',
            cursor: 'pointer',
          }}
        >
          Sign In
        </button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

interface AdminAuthGuardProps {
  children: React.ReactNode;
}

/**
 * AdminAuthGuard wraps admin pages.
 *
 * It reads ``admin_token`` from localStorage on mount and shows a
 * credential prompt when no token is present.  Once authenticated, it
 * provides the token via ``AdminTokenContext`` to all children.
 */
export default function AdminAuthGuard({ children }: AdminAuthGuardProps) {
  const [token, setToken] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    setToken(readStoredToken());
    setMounted(true);
  }, []);

  // Avoid SSR/client mismatch — render nothing until hydration
  if (!mounted) {
    return null;
  }

  if (token === null || token.length === 0) {
    return (
      <CredentialPrompt
        onSubmit={(entered) => {
          storeToken(entered);
          setToken(entered);
          setAuthError(null);
        }}
        error={authError}
      />
    );
  }

  function clearToken(): void {
    clearStoredToken();
    setToken(null);
    setAuthError('Session expired — please sign in again.');
  }

  return (
    <AdminTokenContext.Provider value={{ token, clearToken }}>
      {children}
    </AdminTokenContext.Provider>
  );
}
