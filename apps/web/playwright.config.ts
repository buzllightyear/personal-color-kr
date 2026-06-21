import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for admin UI E2E tests.
 *
 * Targets the running Next.js dev server (default port 3000).
 * Set NEXT_DEV_PORT env var to override if needed.
 *
 * Usage:
 *   pnpm test:e2e                  # run all E2E tests
 *   pnpm playwright test --headed  # run with browser visible
 */

const PORT = process.env['NEXT_DEV_PORT'] ?? '3000';
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  retries: 0,
  workers: 1,

  use: {
    baseURL: BASE_URL,
    // Record traces on first retry so failures are diagnosable
    trace: 'on-first-retry',
    // Viewport sized for admin UI
    viewport: { width: 1280, height: 800 },
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /**
   * Automatically start the Next.js dev server when running tests.
   * `reuseExistingServer: true` means if a dev server is already running
   * on the port (e.g. you ran `pnpm dev` manually), Playwright reuses it.
   */
  webServer: {
    command: `pnpm dev --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 60_000,
    env: {
      // Point the Next.js app at a fake API origin so route mocks intercept cleanly
      NEXT_PUBLIC_API_BASE_URL: 'http://localhost:8000',
      ADMIN_TOKEN: 'test-admin-secret',
    },
  },
});
