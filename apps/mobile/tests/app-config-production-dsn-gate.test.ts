/**
 * Smoke test — `apps/mobile/app.config.ts` production Sentry-DSN build gate.
 *
 * Verifies the Phase 7.3 sub-AC: "app.config.ts throws at build time if the
 * production profile lacks SENTRY_DSN_MOBILE" — relaxed so the requirement only
 * applies once Sentry is PROVISIONED (the org slug is no longer the
 * `TODO_SENTRY_*` placeholder). Before provisioning the gate is inert so the
 * first TestFlight beta is not blocked; it re-arms automatically once a real
 * org slug lands. See `isSentryProvisioned()`.
 *
 * Why a build-time fail-fast:
 *   The `@sentry/react-native/expo` config plugin wires native crash
 *   symbolication (native SDK + source-map/dSYM upload) into the generated
 *   `ios/` project. A production TestFlight build that shipped WITHOUT a Sentry
 *   DSN would silently lose all crash observability — exactly the signal Phase
 *   7.3 beta preparation exists to capture. We therefore fail the EAS Build
 *   loudly at config-resolution time rather than shipping a blind binary.
 *
 * Contract surface under test:
 *   1. `assertProductionSentryDsn(profile, env, provisioned)` — the PURE gate.
 *      It throws iff `profile === 'production'` AND Sentry is provisioned AND
 *      `SENTRY_DSN_MOBILE` is missing/blank. Exercised directly (no EAS-Build
 *      context required) so the rule is pinned independently of how it is invoked.
 *   2. `isEasBuild(env)` — detects a real EAS Build via the `EAS_BUILD=true`
 *      marker EAS injects. Local `expo start` / `expo prebuild` and vitest do
 *      NOT set it.
 *   3. `defineExpoConfig` invokes the gate ONLY when `isEasBuild()` is true.
 *      This is what lets the sibling `app-config-eas-build-profile.test.ts`
 *      (which sets `EAS_BUILD_PROFILE=production` with no DSN, off-EAS) keep
 *      passing, while a genuine production EAS Build missing the DSN fails fast.
 *
 * Isolation strategy mirrors the sibling app.config tests: the three env vars
 * this file mutates (`EAS_BUILD`, `EAS_BUILD_PROFILE`, `SENTRY_DSN_MOBILE`) are
 * captured in `beforeAll`, reset to a clean slate in `beforeEach`, and restored
 * in `afterAll` so no state leaks into any other test file in the run.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import defineExpoConfig, {
  PRODUCTION_EAS_BUILD_PROFILE,
  SENTRY_DSN_MOBILE_ENV_KEY,
  assertProductionSentryDsn,
  isEasBuild,
  isSentryProvisioned,
} from '../app.config';

const MUTATED_ENV_KEYS = [
  'EAS_BUILD',
  'EAS_BUILD_PROFILE',
  'SENTRY_DSN_MOBILE',
] as const;

const VALID_DSN = 'https://examplePublicKey@o0.ingest.sentry.io/0';

describe('app.config.ts — production Sentry-DSN build gate', () => {
  const originalEnv: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const key of MUTATED_ENV_KEYS) {
      originalEnv[key] = process.env[key];
    }
  });

  afterAll(() => {
    for (const key of MUTATED_ENV_KEYS) {
      const value = originalEnv[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  beforeEach(() => {
    for (const key of MUTATED_ENV_KEYS) {
      delete process.env[key];
    }
  });

  it('pins the production profile name and DSN env-var key constants', () => {
    expect(PRODUCTION_EAS_BUILD_PROFILE).toBe('production');
    expect(SENTRY_DSN_MOBILE_ENV_KEY).toBe('SENTRY_DSN_MOBILE');
  });

  describe('assertProductionSentryDsn() — the pure gate', () => {
    // The third arg pins Sentry as PROVISIONED so the DSN requirement applies;
    // the unprovisioned escape hatch is covered in its own cases below.
    it('throws when production profile (Sentry provisioned) is missing SENTRY_DSN_MOBILE', () => {
      expect(() => assertProductionSentryDsn('production', {}, true)).toThrow(
        /SENTRY_DSN_MOBILE/,
      );
    });

    it('throws when production DSN is an empty or whitespace-only string', () => {
      expect(() =>
        assertProductionSentryDsn('production', { SENTRY_DSN_MOBILE: '' }, true),
      ).toThrow(/SENTRY_DSN_MOBILE/);
      expect(() =>
        assertProductionSentryDsn('production', { SENTRY_DSN_MOBILE: '   ' }, true),
      ).toThrow(/SENTRY_DSN_MOBILE/);
    });

    it('does NOT throw when production profile has a real DSN', () => {
      expect(() =>
        assertProductionSentryDsn('production', { SENTRY_DSN_MOBILE: VALID_DSN }, true),
      ).not.toThrow();
    });

    it('does NOT throw on production with no DSN while Sentry is NOT provisioned', () => {
      // The pre-provisioning escape hatch: until a real org slug lands, the DSN
      // requirement is inert so the first TestFlight beta is not blocked.
      expect(() => assertProductionSentryDsn('production', {}, false)).not.toThrow();
    });

    it('does NOT throw for any non-production profile, even with no DSN', () => {
      for (const profile of ['development', 'development-simulator', 'preview']) {
        expect(() => assertProductionSentryDsn(profile, {}, true)).not.toThrow();
      }
    });

    it('reads SENTRY_DSN_MOBILE from process.env when no env arg is passed', () => {
      process.env.SENTRY_DSN_MOBILE = VALID_DSN;
      expect(() =>
        assertProductionSentryDsn('production', undefined, true),
      ).not.toThrow();

      delete process.env.SENTRY_DSN_MOBILE;
      expect(() => assertProductionSentryDsn('production', undefined, true)).toThrow(
        /SENTRY_DSN_MOBILE/,
      );
    });
  });

  describe('isSentryProvisioned() — gate applicability', () => {
    it('is false while the org slug is the TODO placeholder', () => {
      expect(isSentryProvisioned('TODO_SENTRY_ORG_SLUG')).toBe(false);
    });

    it('is true once a real org slug is filled in', () => {
      expect(isSentryProvisioned('pov-team')).toBe(true);
    });

    it('defaults to the module SENTRY_ORG_SLUG (still a TODO placeholder → false)', () => {
      // The repo ships with SENTRY_ORG_SLUG = 'TODO_SENTRY_ORG_SLUG', so Sentry
      // is unprovisioned and the production DSN gate is currently inert.
      expect(isSentryProvisioned()).toBe(false);
    });
  });

  describe('isEasBuild() — EAS Build context detection', () => {
    it('is true only when EAS_BUILD === "true"', () => {
      expect(isEasBuild({ EAS_BUILD: 'true' })).toBe(true);
      expect(isEasBuild({ EAS_BUILD: 'false' })).toBe(false);
      expect(isEasBuild({ EAS_BUILD: '1' })).toBe(false);
      expect(isEasBuild({})).toBe(false);
    });

    it('reads from process.env when no env arg is passed', () => {
      delete process.env.EAS_BUILD;
      expect(isEasBuild()).toBe(false);
      process.env.EAS_BUILD = 'true';
      expect(isEasBuild()).toBe(true);
    });
  });

  describe('defineExpoConfig() — gate is invoked only during a real EAS Build', () => {
    it('does NOT throw on a production EAS Build with no DSN while Sentry is unprovisioned', () => {
      // The repo ships SENTRY_ORG_SLUG = 'TODO_SENTRY_ORG_SLUG' (unprovisioned),
      // so the production DSN requirement is inert — this is what unblocks the
      // first TestFlight build. The gate re-arms once a real org slug lands
      // (covered by the pure-gate `sentryProvisioned: true` cases above).
      process.env.EAS_BUILD = 'true';
      process.env.EAS_BUILD_PROFILE = 'production';
      // SENTRY_DSN_MOBILE intentionally absent.
      expect(() => defineExpoConfig({ config: {} })).not.toThrow();
    });

    it('succeeds on a production EAS Build when SENTRY_DSN_MOBILE is set', () => {
      process.env.EAS_BUILD = 'true';
      process.env.EAS_BUILD_PROFILE = 'production';
      process.env.SENTRY_DSN_MOBILE = VALID_DSN;
      expect(() => defineExpoConfig({ config: {} })).not.toThrow();
    });

    it('does NOT throw off-EAS even with production profile and no DSN', () => {
      // This is the exact shape the sibling eas-build-profile test exercises:
      // production profile, no DSN, but no EAS_BUILD marker (vitest / local).
      delete process.env.EAS_BUILD;
      process.env.EAS_BUILD_PROFILE = 'production';
      expect(() => defineExpoConfig({ config: {} })).not.toThrow();
    });

    it('does NOT throw on a non-production EAS Build with no DSN', () => {
      process.env.EAS_BUILD = 'true';
      process.env.EAS_BUILD_PROFILE = 'preview';
      expect(() => defineExpoConfig({ config: {} })).not.toThrow();
    });
  });
});
