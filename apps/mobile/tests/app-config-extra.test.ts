/**
 * Smoke test — `apps/mobile/app.config.ts` `extra` block wiring.
 *
 * Verifies Sub-AC 8.2: "app.config.ts exports a ConfigFile function that
 * returns an ExpoConfig object with an extra block containing
 * posthogApiKey, falApiKey, and superwallApiKey fields sourced from
 * process.env, verified by a unit test asserting the returned extra
 * object shape and values."
 *
 * SECURITY DEVIATION NOTE — `falApiKey` is INTENTIONALLY ABSENT from
 * the returned `extra` block. The Seed's CONSTRAINTS section states
 * verbatim:
 *   "Fal.ai API key must never be bundled in mobile app binary
 *    (server-side only)"
 * The Expo `extra` block is bundled into the runtime manifest packaged
 * with the IPA/APK; forwarding `FAL_API_KEY` through it would violate
 * that constraint. The Ontology's `security_compliance` principle
 * ("API keys never exposed in client bundles") wins over the literal
 * wording of the sub-AC, so this test asserts the safer shape:
 *   - posthogApiKey + posthogHost + superwallApiKey ARE forwarded;
 *   - falApiKey is NOT a property of `extra`, AND no value in `extra`
 *     equals `process.env.FAL_API_KEY` (defence-in-depth against a
 *     future refactor that renames the field).
 *
 * What this test asserts:
 *   1. `defineExpoConfig` returns an object with an `extra` field that is
 *      a plain object.
 *   2. The `extra` object carries `posthogApiKey` and `superwallApiKey`
 *      string-typed fields whose values equal the current
 *      `process.env.POSTHOG_API_KEY` and `process.env.SUPERWALL_API_KEY`.
 *   3. `extra` does NOT contain a `falApiKey` property and no `extra`
 *      value matches `process.env.FAL_API_KEY` (the security invariant).
 *   4. When the env vars change, a subsequent call to `defineExpoConfig`
 *      reflects the new values — proving the values are sourced from
 *      `process.env` at config-resolution time and not captured once at
 *      module load.
 *   5. Existing keys on the inbound `config.extra` argument are merged
 *      (not clobbered), so app.json's own `extra` survives.
 *
 * Isolation strategy:
 *   - Original `process.env` values are captured in `beforeAll` and
 *     restored in `afterAll`.
 *   - Tests mutate `process.env` for deterministic assertions and the
 *     `beforeEach` resets to a known scratch state before each case.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import defineExpoConfig, { buildExtraVendorKeys } from '../app.config';

const VENDOR_ENV_KEYS = [
  'POSTHOG_API_KEY',
  'POSTHOG_HOST',
  'SUPERWALL_API_KEY',
  'FAL_API_KEY',
] as const;

describe('app.config.ts — extra block vendor key forwarding', () => {
  const originalEnv: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const key of VENDOR_ENV_KEYS) {
      originalEnv[key] = process.env[key];
    }
  });

  afterAll(() => {
    for (const key of VENDOR_ENV_KEYS) {
      const value = originalEnv[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  beforeEach(() => {
    // Deterministic scratch values per test — short, recognisable, and
    // distinct so a swapped assignment is caught.
    process.env.POSTHOG_API_KEY = 'phc_test_posthog';
    process.env.POSTHOG_HOST = 'https://us.i.posthog.com';
    process.env.SUPERWALL_API_KEY = 'pk_test_superwall';
    process.env.FAL_API_KEY = 'fal_test_keyid:fal_test_secret';
  });

  it('returns an ExpoConfig object with an `extra` block of plain-object shape', () => {
    const result = defineExpoConfig({ config: {} });

    expect(result).toBeTypeOf('object');
    expect(result.extra).toBeTypeOf('object');
    expect(result.extra).not.toBeNull();
    expect(Array.isArray(result.extra)).toBe(false);
  });

  it('forwards POSTHOG_API_KEY and POSTHOG_HOST into extra.posthog* fields', () => {
    const result = defineExpoConfig({ config: {} });
    const extra = result.extra as Record<string, unknown>;

    expect(extra.posthogApiKey).toBe('phc_test_posthog');
    expect(extra.posthogHost).toBe('https://us.i.posthog.com');
    expect(extra.posthogApiKey).toBeTypeOf('string');
    expect(extra.posthogHost).toBeTypeOf('string');
  });

  it('forwards SUPERWALL_API_KEY into extra.superwallApiKey', () => {
    const result = defineExpoConfig({ config: {} });
    const extra = result.extra as Record<string, unknown>;

    expect(extra.superwallApiKey).toBe('pk_test_superwall');
    expect(extra.superwallApiKey).toBeTypeOf('string');
  });

  it('does NOT forward FAL_API_KEY (security invariant: server-side only)', () => {
    const result = defineExpoConfig({ config: {} });
    const extra = result.extra as Record<string, unknown>;
    const falValue = process.env.FAL_API_KEY;

    // Property-level check: no `falApiKey` key.
    expect(Object.prototype.hasOwnProperty.call(extra, 'falApiKey')).toBe(false);
    expect(extra.falApiKey).toBeUndefined();

    // Defence-in-depth: assert no `extra` value matches the Fal.ai
    // secret under any name, in case a future refactor renames the key.
    for (const [name, value] of Object.entries(extra)) {
      expect(value, `extra.${name} must not equal process.env.FAL_API_KEY`).not.toBe(falValue);
    }
  });

  it('reads from process.env at call time, not module-load time', () => {
    const first = defineExpoConfig({ config: {} });
    expect((first.extra as Record<string, unknown>).posthogApiKey).toBe('phc_test_posthog');

    process.env.POSTHOG_API_KEY = 'phc_rotated_value';
    const second = defineExpoConfig({ config: {} });
    expect((second.extra as Record<string, unknown>).posthogApiKey).toBe('phc_rotated_value');
  });

  it('merges inbound config.extra rather than clobbering it', () => {
    const inbound = {
      extra: {
        eas: { projectId: 'fake-eas-id' },
        customAppFlag: true,
      },
    };
    const result = defineExpoConfig({ config: inbound });
    const extra = result.extra as Record<string, unknown>;

    // Pre-existing keys survive.
    expect(extra.eas).toEqual({ projectId: 'fake-eas-id' });
    expect(extra.customAppFlag).toBe(true);
    // Newly-added vendor keys are present alongside them.
    expect(extra.posthogApiKey).toBe('phc_test_posthog');
    expect(extra.superwallApiKey).toBe('pk_test_superwall');
  });

  it('buildExtraVendorKeys() returns a frozen object reflecting current env', () => {
    const built = buildExtraVendorKeys();
    expect(built.posthogApiKey).toBe('phc_test_posthog');
    expect(built.posthogHost).toBe('https://us.i.posthog.com');
    expect(built.superwallApiKey).toBe('pk_test_superwall');
    expect(Object.isFrozen(built)).toBe(true);
    // Type-level guarantee: no `falApiKey` member exists on the
    // returned shape (asserted at runtime as well).
    expect(Object.prototype.hasOwnProperty.call(built, 'falApiKey')).toBe(false);
  });

  it('emits undefined fields when env vars are missing (placeholder onboarding flow)', () => {
    delete process.env.POSTHOG_API_KEY;
    delete process.env.SUPERWALL_API_KEY;

    const result = defineExpoConfig({ config: {} });
    const extra = result.extra as Record<string, unknown>;

    expect(extra.posthogApiKey).toBeUndefined();
    expect(extra.superwallApiKey).toBeUndefined();
    // POSTHOG_HOST is still set in beforeEach — verify the other fields
    // don't accidentally hijack its slot.
    expect(extra.posthogHost).toBe('https://us.i.posthog.com');
  });
});
