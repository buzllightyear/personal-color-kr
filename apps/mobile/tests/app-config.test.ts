/**
 * Smoke test — `apps/mobile/app.config.ts` root `.env` loading contract.
 *
 * Verifies Sub-AC 8.1: "app.config.ts loads root .env file via dotenv.config()
 * with correct path resolution, verified by a test that asserts process.env
 * contains the expected keys after config load."
 *
 * What this test asserts:
 *   1. `ROOT_ENV_PATH` resolves to the workspace-root `.env`, NOT a stray
 *      `apps/mobile/.env` — i.e. the relative-path math (`../../.env` from
 *      `apps/mobile/app.config.ts`) is correct.
 *   2. After calling `loadRootEnv()`, `process.env` carries the four vendor
 *      keys declared in `REQUIRED_ENV_KEYS`, each as a non-empty string.
 *   3. The test does NOT depend on the *value* of any key — it only enforces
 *      presence + non-emptiness. Placeholder values from `.env.example` are
 *      acceptable; real keys are validated by sibling sub-ACs (regex / live
 *      auth) so this test stays CI-friendly without secrets.
 *
 * Isolation strategy:
 *   - The module under test calls `loadRootEnv()` once at import time. To
 *     genuinely exercise the side effect we delete the relevant keys from
 *     `process.env` in `beforeEach`, then call `loadRootEnv()` again from
 *     the test body and observe that the keys reappear.
 *   - Original values are captured in `beforeAll` and restored in `afterAll`
 *     so the test does not pollute the process for any later test file in
 *     the same vitest run.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  REQUIRED_ENV_KEYS,
  ROOT_ENV_PATH,
  loadRootEnv,
} from '../app.config';

describe('app.config.ts — root .env loading', () => {
  const originalEnv: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const key of REQUIRED_ENV_KEYS) {
      originalEnv[key] = process.env[key];
    }
  });

  afterAll(() => {
    for (const key of REQUIRED_ENV_KEYS) {
      const value = originalEnv[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  beforeEach(() => {
    // Clear so each test genuinely exercises dotenv's side effect rather
    // than reading state left over from module-evaluation-time loading.
    for (const key of REQUIRED_ENV_KEYS) {
      delete process.env[key];
    }
  });

  it('resolves ROOT_ENV_PATH to the workspace-root .env, not apps/mobile/.env', () => {
    // The path must end with `/.env` (or `\.env` on Windows) and must NOT
    // be inside the `apps/mobile/` directory — that would mean the
    // `../../` traversal collapsed incorrectly.
    expect(ROOT_ENV_PATH.endsWith(`${'/'.repeat(1)}.env`)).toBe(true);
    expect(ROOT_ENV_PATH).not.toMatch(/[\\/]apps[\\/]mobile[\\/]\.env$/);
    // And it must be absolute so Expo CLI doesn't depend on cwd.
    expect(ROOT_ENV_PATH.startsWith('/')).toBe(true);
  });

  it('loadRootEnv() returns the resolved path it acted on', () => {
    const result = loadRootEnv();
    expect(result.path).toBe(ROOT_ENV_PATH);
  });

  it('populates process.env with every required vendor key', () => {
    // Pre-condition: beforeEach cleared the keys.
    for (const key of REQUIRED_ENV_KEYS) {
      expect(process.env[key]).toBeUndefined();
    }

    loadRootEnv();

    for (const key of REQUIRED_ENV_KEYS) {
      const value = process.env[key];
      expect(value, `process.env.${key} must be present after loadRootEnv()`).toBeTypeOf('string');
      expect(value, `process.env.${key} must be non-empty after loadRootEnv()`).not.toBe('');
    }
  });

  it('parses at least one of the required keys from the .env file itself', () => {
    // Defence against a silently-empty .env: ensure dotenv actually parsed
    // content from the file (not just that env was already set elsewhere).
    const result = loadRootEnv();
    expect(result.error, 'dotenv.config() must not error').toBeUndefined();
    const parsedKeys = Object.keys(result.parsed);
    const intersection = REQUIRED_ENV_KEYS.filter((k) => parsedKeys.includes(k));
    expect(
      intersection.length,
      `expected .env at ${ROOT_ENV_PATH} to define at least one of ${REQUIRED_ENV_KEYS.join(', ')}`,
    ).toBeGreaterThan(0);
  });
});
