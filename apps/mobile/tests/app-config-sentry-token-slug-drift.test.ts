/**
 * Smoke test — `apps/mobile/app.config.ts` Sentry auth-token / TODO-slug drift
 * build gate.
 *
 * Verifies the Phase 7.3 sub-AC: "app.config.ts throws at build time if
 * SENTRY_AUTH_TOKEN is present but TODO_SENTRY placeholder slugs remain."
 *
 * Why a build-time fail-fast:
 *   The `@sentry/react-native/expo` config plugin uploads JS source maps and iOS
 *   dSYMs to a Sentry org/project ONLY when `SENTRY_AUTH_TOKEN` is present (its
 *   presence is the documented upload guard). If a human created that EAS Secret
 *   but forgot to replace `SENTRY_ORG_SLUG` (`TODO_SENTRY_ORG_SLUG`), the upload
 *   would target a non-existent org and the shipped build would silently lose
 *   native crash symbolication. We therefore fail config resolution loudly the
 *   moment the token is present while a placeholder slug remains.
 *
 * Contract surface under test:
 *   1. `hasSentryAuthToken(env)` — detects a present, non-blank token. This is
 *      the exact condition under which the plugin attempts an upload.
 *   2. `unresolvedSentryTodoSlugs()` — the upload slugs still carrying the
 *      `TODO_SENTRY` prefix (org is a placeholder; `pck-mobile` project is not).
 *   3. `assertSentryAuthTokenSlugDrift(env)` — the PURE gate. Throws iff the
 *      token is present AND ≥1 upload slug is still a placeholder.
 *   4. `defineExpoConfig` invokes the gate, independent of `EAS_BUILD`, so any
 *      build (or local prebuild) with the token + placeholder slug fails fast,
 *      while token-absent runs (vitest, dry-run) proceed untouched.
 *
 * Isolation: only `SENTRY_AUTH_TOKEN` is mutated here; it is captured in
 * `beforeAll`, cleared in `beforeEach`, and restored in `afterAll` so no state
 * leaks into sibling test files.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import defineExpoConfig, {
  SENTRY_AUTH_TOKEN_ENV_KEY,
  SENTRY_ORG_SLUG,
  SENTRY_PROJECT_SLUG,
  SENTRY_TODO_SLUG_PREFIX,
  assertSentryAuthTokenSlugDrift,
  hasSentryAuthToken,
  sentryUploadSlugs,
  unresolvedSentryTodoSlugs,
} from '../app.config';

const REAL_AUTH_TOKEN = 'sntrys_exampletoken_not_a_real_secret';

describe('app.config.ts — Sentry auth-token / TODO-slug drift build gate', () => {
  let originalToken: string | undefined;

  beforeAll(() => {
    originalToken = process.env[SENTRY_AUTH_TOKEN_ENV_KEY];
  });

  afterAll(() => {
    if (originalToken === undefined) {
      delete process.env[SENTRY_AUTH_TOKEN_ENV_KEY];
    } else {
      process.env[SENTRY_AUTH_TOKEN_ENV_KEY] = originalToken;
    }
  });

  beforeEach(() => {
    delete process.env[SENTRY_AUTH_TOKEN_ENV_KEY];
  });

  it('pins the auth-token env-var key and TODO slug prefix constants', () => {
    expect(SENTRY_AUTH_TOKEN_ENV_KEY).toBe('SENTRY_AUTH_TOKEN');
    expect(SENTRY_TODO_SLUG_PREFIX).toBe('TODO_SENTRY');
  });

  describe('hasSentryAuthToken()', () => {
    it('is true only for a present, non-blank token', () => {
      expect(hasSentryAuthToken({ SENTRY_AUTH_TOKEN: REAL_AUTH_TOKEN })).toBe(true);
      expect(hasSentryAuthToken({ SENTRY_AUTH_TOKEN: '' })).toBe(false);
      expect(hasSentryAuthToken({ SENTRY_AUTH_TOKEN: '   ' })).toBe(false);
      expect(hasSentryAuthToken({})).toBe(false);
    });

    it('reads from process.env when no env arg is passed', () => {
      delete process.env.SENTRY_AUTH_TOKEN;
      expect(hasSentryAuthToken()).toBe(false);
      process.env.SENTRY_AUTH_TOKEN = REAL_AUTH_TOKEN;
      expect(hasSentryAuthToken()).toBe(true);
    });
  });

  describe('unresolvedSentryTodoSlugs()', () => {
    it('flags the org placeholder but not the provisioned project slug', () => {
      const unresolved = unresolvedSentryTodoSlugs();
      expect(unresolved).toContain(SENTRY_ORG_SLUG);
      expect(unresolved).not.toContain(SENTRY_PROJECT_SLUG);
    });

    it('every flagged slug carries the TODO_SENTRY prefix', () => {
      for (const slug of unresolvedSentryTodoSlugs()) {
        expect(slug.startsWith(SENTRY_TODO_SLUG_PREFIX)).toBe(true);
      }
    });

    it('sentryUploadSlugs() exposes the org and project slugs in order', () => {
      expect(sentryUploadSlugs()).toEqual([SENTRY_ORG_SLUG, SENTRY_PROJECT_SLUG]);
    });
  });

  describe('assertSentryAuthTokenSlugDrift() — the pure gate', () => {
    it('throws when the token is present but a TODO_SENTRY slug remains', () => {
      expect(() =>
        assertSentryAuthTokenSlugDrift({ SENTRY_AUTH_TOKEN: REAL_AUTH_TOKEN }),
      ).toThrow(/TODO_SENTRY/);
    });

    it('names the unresolved slug in the thrown error', () => {
      expect(() =>
        assertSentryAuthTokenSlugDrift({ SENTRY_AUTH_TOKEN: REAL_AUTH_TOKEN }),
      ).toThrow(new RegExp(SENTRY_ORG_SLUG));
    });

    it('does NOT throw when the token is absent, even with placeholder slugs', () => {
      expect(() => assertSentryAuthTokenSlugDrift({})).not.toThrow();
      expect(() =>
        assertSentryAuthTokenSlugDrift({ SENTRY_AUTH_TOKEN: '' }),
      ).not.toThrow();
      expect(() =>
        assertSentryAuthTokenSlugDrift({ SENTRY_AUTH_TOKEN: '   ' }),
      ).not.toThrow();
    });

    it('reads SENTRY_AUTH_TOKEN from process.env when no env arg is passed', () => {
      delete process.env.SENTRY_AUTH_TOKEN;
      expect(() => assertSentryAuthTokenSlugDrift()).not.toThrow();

      process.env.SENTRY_AUTH_TOKEN = REAL_AUTH_TOKEN;
      expect(() => assertSentryAuthTokenSlugDrift()).toThrow(/TODO_SENTRY/);
    });
  });

  describe('defineExpoConfig() — gate fires regardless of EAS_BUILD context', () => {
    it('throws when the token is present while a placeholder slug remains', () => {
      process.env.SENTRY_AUTH_TOKEN = REAL_AUTH_TOKEN;
      expect(() => defineExpoConfig({ config: {} })).toThrow(/TODO_SENTRY/);
    });

    it('does NOT throw when the token is absent (the vitest / dry-run path)', () => {
      delete process.env.SENTRY_AUTH_TOKEN;
      expect(() => defineExpoConfig({ config: {} })).not.toThrow();
    });
  });
});
