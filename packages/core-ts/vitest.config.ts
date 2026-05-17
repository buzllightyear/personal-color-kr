/**
 * Vitest configuration for the `core-ts` workspace package.
 *
 * Paths are relative to this file's directory (`packages/core-ts/`):
 *   - tests live in `packages/core-ts/tests/**`
 *   - source under coverage lives in `packages/core-ts/src/**`
 *
 * This config is the migrated home for the previous repo-root `vitest.config.ts`.
 * Import paths within the package mirror the original `src/` and `tests/` layout
 * so the existing 770 vitest tests run without modification after migration.
 *
 * Invoked via `pnpm --filter core-ts test` (see `packages/core-ts/package.json`).
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/**/index.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
