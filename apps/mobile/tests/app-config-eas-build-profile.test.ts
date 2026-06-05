/**
 * Smoke test — `apps/mobile/app.config.ts` `extra.easBuildProfile` wiring.
 *
 * Verifies the Phase 7.3 sub-AC: "app.config.ts exposes
 * extra.easBuildProfile from process.env.EAS_BUILD_PROFILE with development
 * fallback."
 *
 * What this test asserts:
 *   1. `resolveEasBuildProfile()` returns the value of
 *      `process.env.EAS_BUILD_PROFILE` verbatim when it is a non-empty
 *      string (the EAS-Build-injected path).
 *   2. It falls back to `DEFAULT_EAS_BUILD_PROFILE` (`'development'`) when the
 *      env var is unset, empty, or whitespace-only (the off-EAS / local-dev /
 *      vitest path).
 *   3. `defineExpoConfig` forwards the resolved value onto
 *      `extra.easBuildProfile`, sourced from `process.env` at
 *      config-resolution time (not captured once at module load).
 *   4. The forwarded value coexists with — and does not clobber — the
 *      pre-existing vendor keys nor an inbound `config.extra`.
 *
 * Isolation strategy mirrors `app-config-extra.test.ts`: the original
 * `process.env.EAS_BUILD_PROFILE` is captured in `beforeAll` and restored in
 * `afterAll`, and each test mutates the var to a deterministic scratch value.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import defineExpoConfig, {
  DEFAULT_EAS_BUILD_PROFILE,
  resolveEasBuildProfile,
} from '../app.config';

describe('app.config.ts — extra.easBuildProfile resolution', () => {
  let originalProfile: string | undefined;

  beforeAll(() => {
    originalProfile = process.env.EAS_BUILD_PROFILE;
  });

  afterAll(() => {
    if (originalProfile === undefined) {
      delete process.env.EAS_BUILD_PROFILE;
    } else {
      process.env.EAS_BUILD_PROFILE = originalProfile;
    }
  });

  beforeEach(() => {
    delete process.env.EAS_BUILD_PROFILE;
  });

  it('DEFAULT_EAS_BUILD_PROFILE is the documented `development` fallback', () => {
    expect(DEFAULT_EAS_BUILD_PROFILE).toBe('development');
  });

  it('resolveEasBuildProfile() returns the EAS-injected profile verbatim', () => {
    process.env.EAS_BUILD_PROFILE = 'production';
    expect(resolveEasBuildProfile()).toBe('production');

    process.env.EAS_BUILD_PROFILE = 'preview';
    expect(resolveEasBuildProfile()).toBe('preview');

    process.env.EAS_BUILD_PROFILE = 'development-simulator';
    expect(resolveEasBuildProfile()).toBe('development-simulator');
  });

  it('resolveEasBuildProfile() falls back to development when env var is unset', () => {
    delete process.env.EAS_BUILD_PROFILE;
    expect(resolveEasBuildProfile()).toBe('development');
  });

  it('resolveEasBuildProfile() treats empty / whitespace-only as unset', () => {
    process.env.EAS_BUILD_PROFILE = '';
    expect(resolveEasBuildProfile()).toBe('development');

    process.env.EAS_BUILD_PROFILE = '   ';
    expect(resolveEasBuildProfile()).toBe('development');
  });

  it('forwards the resolved profile onto extra.easBuildProfile', () => {
    process.env.EAS_BUILD_PROFILE = 'production';
    const result = defineExpoConfig({ config: {} });
    const extra = result.extra as Record<string, unknown>;

    expect(extra.easBuildProfile).toBe('production');
    expect(extra.easBuildProfile).toBeTypeOf('string');
  });

  it('forwards the development fallback when env var is absent', () => {
    delete process.env.EAS_BUILD_PROFILE;
    const result = defineExpoConfig({ config: {} });
    const extra = result.extra as Record<string, unknown>;

    expect(extra.easBuildProfile).toBe('development');
  });

  it('reads from process.env at call time, not module-load time', () => {
    process.env.EAS_BUILD_PROFILE = 'preview';
    const first = defineExpoConfig({ config: {} });
    expect((first.extra as Record<string, unknown>).easBuildProfile).toBe('preview');

    process.env.EAS_BUILD_PROFILE = 'production';
    const second = defineExpoConfig({ config: {} });
    expect((second.extra as Record<string, unknown>).easBuildProfile).toBe(
      'production',
    );
  });

  it('coexists with vendor keys and inbound config.extra without clobbering', () => {
    process.env.EAS_BUILD_PROFILE = 'production';
    const inbound = {
      extra: {
        eas: { projectId: 'fake-eas-id' },
        customAppFlag: true,
      },
    };
    const result = defineExpoConfig({ config: inbound });
    const extra = result.extra as Record<string, unknown>;

    // Pre-existing inbound keys survive.
    expect(extra.eas).toEqual({ projectId: 'fake-eas-id' });
    expect(extra.customAppFlag).toBe(true);
    // Newly-added profile is present alongside them.
    expect(extra.easBuildProfile).toBe('production');
  });
});
