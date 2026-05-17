/**
 * SuperwallApiKey validation — vitest tests.
 *
 * Covers AC 11 (Superwall key passes non-empty + prefix-format regex
 * validation) for Phase 1.2.  Tests are framework-agnostic: no Expo,
 * no react-native, no live network calls — pure regex + string
 * validation so they remain green in CI without any secrets.
 *
 * In addition to the unit-level happy/sad cases, we also assert that
 * the current root `.env` value (loaded via Node's built-in `fs`
 * parse) passes validation.  That last assertion is what closes the
 * `superwall_key_validated` exit condition: it proves the key
 * *currently in the repo* meets the contract, not just hypothetical
 * inputs.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  SUPERWALL_API_KEY_PATTERN,
  SuperwallApiKeyError,
  assertValidSuperwallApiKey,
  isValidSuperwallApiKey,
} from '../../src/superwall/index.js';

// ---------------------------------------------------------------------------
// Helpers — read root .env without depending on dotenv (the sibling task
// that wires dotenv into app.config.ts is in flight; this test must
// stand alone so it doesn't gate on that work).
// ---------------------------------------------------------------------------

function parseEnvFile(contents: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) {
      continue;
    }
    const eq = line.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    out[key] = value;
  }
  return out;
}

function rootEnvPath(): string {
  // packages/core-ts/tests/superwall/key.test.ts -> repo root is ../../../..
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', '..', '..', '.env');
}

function loadRootEnv(): Record<string, string> {
  const contents = readFileSync(rootEnvPath(), 'utf8');
  return parseEnvFile(contents);
}

// Live smoke skips when no `.env` is present (CI / fresh clone) — keeps the
// suite green without secrets, matching the Python `tests/config/test_env.py`
// pattern. The pure regex/validation suites above still run unconditionally.
const ROOT_ENV_PRESENT = existsSync(rootEnvPath());

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SUPERWALL_API_KEY_PATTERN', () => {
  it('is anchored at both ends', () => {
    expect(SUPERWALL_API_KEY_PATTERN.source.startsWith('^')).toBe(true);
    expect(SUPERWALL_API_KEY_PATTERN.source.endsWith('$')).toBe(true);
  });
});

describe('isValidSuperwallApiKey', () => {
  it('accepts a realistic pk_ key with alphanumerics', () => {
    expect(isValidSuperwallApiKey('pk_abc123XYZ')).toBe(true);
  });

  it('accepts the .env.example placeholder shape', () => {
    expect(
      isValidSuperwallApiKey(
        'pk_PLACEHOLDER_REPLACE_WITH_REAL_KEY_FROM_SUPERWALL_DASHBOARD',
      ),
    ).toBe(true);
  });

  it('accepts dashes inside the key body (real Superwall keys contain them)', () => {
    expect(isValidSuperwallApiKey('pk_live-abc-123')).toBe(true);
  });

  it('trims surrounding whitespace before matching', () => {
    expect(isValidSuperwallApiKey('  pk_abc123  ')).toBe(true);
  });

  it('rejects an empty string', () => {
    expect(isValidSuperwallApiKey('')).toBe(false);
  });

  it('rejects whitespace-only strings', () => {
    expect(isValidSuperwallApiKey('   \t\n  ')).toBe(false);
  });

  it('rejects keys with the wrong prefix', () => {
    expect(isValidSuperwallApiKey('sk_abc123')).toBe(false);
    expect(isValidSuperwallApiKey('phc_abc123')).toBe(false);
    expect(isValidSuperwallApiKey('abc123')).toBe(false);
  });

  it('rejects pk_ with no body characters', () => {
    expect(isValidSuperwallApiKey('pk_')).toBe(false);
  });

  it('rejects keys containing illegal characters', () => {
    expect(isValidSuperwallApiKey('pk_abc 123')).toBe(false); // space
    expect(isValidSuperwallApiKey('pk_abc!123')).toBe(false); // punctuation
    expect(isValidSuperwallApiKey('pk_abc.123')).toBe(false); // dot
  });

  it('rejects non-string values', () => {
    expect(isValidSuperwallApiKey(undefined)).toBe(false);
    expect(isValidSuperwallApiKey(null)).toBe(false);
    expect(isValidSuperwallApiKey(123)).toBe(false);
    expect(isValidSuperwallApiKey({})).toBe(false);
    expect(isValidSuperwallApiKey([])).toBe(false);
  });
});

describe('assertValidSuperwallApiKey', () => {
  it('returns the trimmed key on success', () => {
    expect(assertValidSuperwallApiKey('  pk_abc123  ')).toBe('pk_abc123');
  });

  it('throws SuperwallApiKeyError(not_string) for non-strings', () => {
    try {
      assertValidSuperwallApiKey(123);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SuperwallApiKeyError);
      expect((err as SuperwallApiKeyError).reason).toBe('not_string');
    }
  });

  it('throws SuperwallApiKeyError(empty) for empty / whitespace strings', () => {
    for (const value of ['', '   ', '\t\n']) {
      try {
        assertValidSuperwallApiKey(value);
        throw new Error(`should have thrown for ${JSON.stringify(value)}`);
      } catch (err) {
        expect(err).toBeInstanceOf(SuperwallApiKeyError);
        expect((err as SuperwallApiKeyError).reason).toBe('empty');
      }
    }
  });

  it('throws SuperwallApiKeyError(invalid_format) for wrong-shape keys', () => {
    for (const value of ['sk_abc123', 'pk_', 'pk_abc!123', 'abc']) {
      try {
        assertValidSuperwallApiKey(value);
        throw new Error(`should have thrown for ${JSON.stringify(value)}`);
      } catch (err) {
        expect(err).toBeInstanceOf(SuperwallApiKeyError);
        expect((err as SuperwallApiKeyError).reason).toBe('invalid_format');
      }
    }
  });

  it('error message mentions the offending value for diagnostic clarity', () => {
    try {
      assertValidSuperwallApiKey('sk_wrong');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SuperwallApiKeyError);
      expect((err as SuperwallApiKeyError).message).toContain('sk_wrong');
    }
  });
});

describe.skipIf(!ROOT_ENV_PRESENT)('root .env SUPERWALL_API_KEY (live AC 11 smoke)', () => {
  it('is present and passes validation', () => {
    const env = loadRootEnv();
    const key = env['SUPERWALL_API_KEY'];
    expect(key, 'SUPERWALL_API_KEY missing from root .env').toBeDefined();
    expect(isValidSuperwallApiKey(key)).toBe(true);
    // Throwing variant should also succeed and return a string.
    expect(typeof assertValidSuperwallApiKey(key)).toBe('string');
  });
});
