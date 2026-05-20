/**
 * Unit test — `configureSuperwall` idempotency contract (Sub-AC 3.1).
 *
 * Scope:
 *   This file exercises the *real* implementation of `configureSuperwall`
 *   exported from `apps/mobile/src/superwall/client.ts`. The sibling test
 *   `superwall-client-wrapper.test.ts` mocks the wrapper module itself
 *   (pinning the test-time substitution contract used by route tests);
 *   here we go one level deeper and verify that the wrapper's internal
 *   gating actually prevents redundant calls into the native SDK.
 *
 * What this test asserts:
 *   1. The first call to `configureSuperwall(validKey)` invokes the
 *      underlying `Superwall.configure({ apiKey })` exactly once and
 *      forwards the trimmed, validated key.
 *   2. Subsequent calls with the SAME valid key are no-ops at the SDK
 *      boundary — `Superwall.configure` is never re-invoked.
 *   3. Subsequent calls with a DIFFERENT valid key are also no-ops —
 *      the idempotency gate fires on the module-level `configured`
 *      flag regardless of the new key value. (Rotating the API key
 *      requires a JS-runtime reload, which is consistent with the
 *      Seed constraint "Superwall publishable key exposed via
 *      EXPO_PUBLIC_ prefix only" — a key change ships in a new build.)
 *   4. `__resetSuperwallConfiguredForTest()` clears the gate so a
 *      follow-up `configureSuperwall` call re-invokes the SDK — proves
 *      the gate is the actual gating mechanism (defence against a
 *      future refactor that accidentally caches at a different layer).
 *
 * Mocking strategy:
 *   - `vi.mock('@superwall/react-native-superwall', ...)` replaces the
 *     native SDK module before the wrapper imports it. The replacement
 *     exposes a `default` export with `.configure` (a `vi.fn` spy) plus
 *     a `.shared.register` stub and a no-op `PaywallPresentationHandler`
 *     class so the wrapper's top-level imports resolve cleanly. We do
 *     NOT exercise `triggerPaywall` here — that lives in a sibling
 *     completion-state test — but the handler stub keeps module load
 *     side-effect-free.
 *   - `vi.hoisted(...)` lifts the spy declarations above the
 *     `vi.mock(...)` factory so the factory can close over them
 *     without hitting vitest's hoisting-order restriction (a plain
 *     `const spy = vi.fn()` at module top would be evaluated AFTER
 *     vi.mock's hoist).
 *   - The wrapper module is imported via dynamic `import(...)` so the
 *     mock is fully in place before the wrapper's top-level
 *     `import Superwall from '@superwall/react-native-superwall'` runs.
 *
 * What this test does NOT cover:
 *   - The native SDK's actual configure behavior — that runs only inside
 *     the EAS custom dev client on a real iOS simulator (Seed exit
 *     condition `build_success`).
 *   - Invalid-API-key error mapping — covered by sibling tests around
 *     the `assertValidSuperwallApiKey` contract in `core-ts`.
 *   - The paywall trigger flow (`triggerPaywall`, outcome mapping,
 *     error transparency) — covered by `*-paywall-outcome.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted spies
//
// `vi.mock(...)` is hoisted to the top of the file before any top-level
// `const`. To let the factory close over our spies we declare them via
// `vi.hoisted(...)` which is itself hoisted above `vi.mock`. The resulting
// object is the single source of truth for "what did the SDK see" across
// every test case below.
// ---------------------------------------------------------------------------
const superwallSpies = vi.hoisted(() => {
  return {
    // vitest@1.x `vi.fn<TArgs, TReturn>()` takes a TUPLE of args, not a
    // function signature. Argument shape: `[{ apiKey }]`; return:
    // `Promise<void>` so the wrapper's `await Superwall.configure(...)`
    // typechecks against the spy.
    configure: vi.fn<[{ apiKey: string }], Promise<void>>(),
    register: vi.fn<[{ placement: string; handler: unknown }], Promise<void>>(),
  };
});

vi.mock('@superwall/react-native-superwall', () => {
  // The wrapper imports `Superwall` as the default export and uses
  // `Superwall.configure(...)` + `Superwall.shared.register(...)`. We
  // expose both surfaces — `register` is stubbed but never called in
  // this file's tests.
  const SuperwallDefault = {
    configure: superwallSpies.configure,
    shared: {
      register: superwallSpies.register,
    },
  };

  // The wrapper also imports `PaywallPresentationHandler` as a named
  // export at the top level. A no-op class is enough for module load —
  // we never instantiate it in this file.
  class PaywallPresentationHandler {
    public onDismiss = (): void => {};
    public onSkip = (): void => {};
    public onError = (): void => {};
  }

  return {
    default: SuperwallDefault,
    PaywallPresentationHandler,
  };
});

// Lazy loader so each test re-imports the wrapper after `vi.resetModules()`
// — guarantees the module-private `configured` flag starts at `false`
// per case (defence-in-depth alongside `__resetSuperwallConfiguredForTest`).
async function loadWrapper(): Promise<typeof import('../src/superwall/client')> {
  return await import('../src/superwall/client');
}

// A pair of structurally-valid `pk_*` keys (per the regex in
// `core-ts/superwall/key.ts`). The literal `pk_` prefix and the
// `[A-Za-z0-9_-]+` body are the two things `assertValidSuperwallApiKey`
// gates on; the strings here are not real Superwall keys.
const VALID_KEY_A = 'pk_test_idempotency_AAA';
const VALID_KEY_B = 'pk_test_idempotency_BBB';

describe('configureSuperwall — idempotency contract', () => {
  beforeEach(async () => {
    vi.resetModules();
    superwallSpies.configure.mockReset();
    superwallSpies.configure.mockResolvedValue(undefined);
    superwallSpies.register.mockReset();
    superwallSpies.register.mockResolvedValue(undefined);
    // Defence-in-depth: even though `vi.resetModules()` re-imports the
    // wrapper fresh, also call the test-only reset hook so the
    // module-private `configured` flag is unambiguously false.
    const wrapper = await loadWrapper();
    wrapper.__resetSuperwallConfiguredForTest();
  });

  it('calls Superwall.configure exactly once on the first invocation', async () => {
    const wrapper = await loadWrapper();

    await wrapper.configureSuperwall(VALID_KEY_A);

    expect(superwallSpies.configure).toHaveBeenCalledTimes(1);
    expect(superwallSpies.configure).toHaveBeenCalledWith({ apiKey: VALID_KEY_A });
  });

  it('skips Superwall.configure on subsequent invocations with the same key', async () => {
    const wrapper = await loadWrapper();

    await wrapper.configureSuperwall(VALID_KEY_A);
    await wrapper.configureSuperwall(VALID_KEY_A);
    await wrapper.configureSuperwall(VALID_KEY_A);

    // ONE underlying SDK call across THREE wrapper invocations is the
    // idempotency invariant.
    expect(superwallSpies.configure).toHaveBeenCalledTimes(1);
    expect(superwallSpies.configure).toHaveBeenCalledWith({ apiKey: VALID_KEY_A });
  });

  it('skips Superwall.configure on subsequent invocations even with a different valid key', async () => {
    const wrapper = await loadWrapper();

    await wrapper.configureSuperwall(VALID_KEY_A);
    await wrapper.configureSuperwall(VALID_KEY_B);

    // The gate fires on the module-private `configured` flag, NOT on
    // a key-value comparison. Rotating the publishable key requires a
    // JS-runtime reload — which is the intended contract because the
    // key is shipped via `Constants.expoConfig.extra` (build-time).
    expect(superwallSpies.configure).toHaveBeenCalledTimes(1);
    expect(superwallSpies.configure).toHaveBeenCalledWith({ apiKey: VALID_KEY_A });
    // Explicit negative assertion: the second key never reached the SDK.
    expect(superwallSpies.configure).not.toHaveBeenCalledWith({ apiKey: VALID_KEY_B });
  });

  it('returns the resolved void value on subsequent no-op invocations (no exception thrown)', async () => {
    const wrapper = await loadWrapper();

    await wrapper.configureSuperwall(VALID_KEY_A);

    // Each subsequent call must resolve cleanly so callers (root layout
    // useEffect, defensive re-mounts during HMR, etc.) can `await` it
    // without try/catch boilerplate. `toResolve` would be ideal but
    // vitest doesn't ship that matcher; `.resolves.toBeUndefined()`
    // pins both "resolves" and "no value" in one assertion.
    await expect(wrapper.configureSuperwall(VALID_KEY_A)).resolves.toBeUndefined();
    expect(superwallSpies.configure).toHaveBeenCalledTimes(1);
  });

  it('__resetSuperwallConfiguredForTest() re-opens the gate so the next call hits the SDK again', async () => {
    const wrapper = await loadWrapper();

    await wrapper.configureSuperwall(VALID_KEY_A);
    expect(superwallSpies.configure).toHaveBeenCalledTimes(1);

    // Simulate a fresh JS-runtime by clearing the module-private flag.
    // This is the only sanctioned route to re-configure inside a single
    // process; production code never reaches this hook (intentional
    // `__TEST__` underscore prefix).
    wrapper.__resetSuperwallConfiguredForTest();

    await wrapper.configureSuperwall(VALID_KEY_B);
    expect(superwallSpies.configure).toHaveBeenCalledTimes(2);
    expect(superwallSpies.configure).toHaveBeenLastCalledWith({ apiKey: VALID_KEY_B });
  });
});
