/**
 * Unit test — `triggerPaywall` placement-forwarding contract (Sub-AC 6.2).
 *
 * Scope:
 *   This file pins the narrowest contract Sub-AC 6.2 mandates: the wrapper
 *   `triggerPaywall(placement: string)` exported from
 *   `apps/mobile/src/superwall/client.ts` MUST delegate to the native
 *   `@superwall/react-native-superwall` SDK and forward the placement
 *   argument *verbatim* — no transformation, no aliasing, no fallback.
 *
 *   The sibling `superwall-trigger-paywall-outcome.test.ts` covers the
 *   completion-state mapping (purchased / restored / declined) and the
 *   `params` passthrough; the sibling `superwall-configure-idempotency.test.ts`
 *   covers the configure gate; the sibling `superwall-client-wrapper.test.ts`
 *   covers the test-time substitution surface. This file deliberately
 *   focuses on one contract — the placement argument bridge — so a
 *   regression in placement forwarding (a stray default, a swapped
 *   variable, an SDK rename) surfaces in a test whose name names the
 *   exact contract being violated.
 *
 * Why a dedicated file:
 *   The Seed ontology lists `placement` as a REQUIRED concept and pins
 *   `'payment_model_unlock'` as the sole Phase 2.5 value. Drift between
 *   the call site, the wrapper, and the Superwall dashboard placement
 *   name surfaces as a silent paywall miss in production (the trigger
 *   fires but Superwall has no matching campaign). A focused test makes
 *   the contract violation legible in the test report: a regression
 *   here is unambiguously a placement-bridging defect, not a side-effect
 *   of an outcome-mapping refactor.
 *
 * Mocking strategy:
 *   - `vi.hoisted(...)` lifts a shared spy object above the
 *     `vi.mock(...)` factory so the factory closes over `register` and
 *     `configure` spies. The mocked SDK module exposes `default` (with
 *     `.configure` + `.shared.register`) and `PaywallPresentationHandler`
 *     — the two symbols the wrapper imports at module top level.
 *   - The mocked `register` synchronously stores the handler the wrapper
 *     passed in. Each test case then drives `onDismiss(declined)` to
 *     resolve the in-flight promise so no pending promise leaks across
 *     cases. We do not assert on outcome shape here — that lives in the
 *     outcome-mapping suite. The declined dispatch is purely cleanup.
 *   - `vi.resetModules()` in `beforeEach` re-imports the wrapper fresh
 *     so the module-private `configured` flag starts at `false` per
 *     case, then `configureSuperwall` runs once to open the trigger
 *     gate.
 *
 * Native-isolation invariant:
 *   The wrapper is the SOLE file in the apps/mobile workspace that
 *   imports `@superwall/react-native-superwall`. Mocking that package
 *   here means vitest never resolves the native Objective-C-backed JS
 *   shim — the test running at all is the proof the invariant holds
 *   for this file (compounding the equivalent proof in the sibling
 *   suites).
 *
 * What this test does NOT cover:
 *   - Outcome → PaywallOutcome union mapping — sibling outcome test.
 *   - `params` passthrough or `exactOptionalPropertyTypes` shape —
 *     sibling outcome test.
 *   - Native SDK register behaviour — exercised only via the EAS dev
 *     client on a real iOS simulator (Seed exit `paywall_trigger`).
 *   - Error mapping (configure / trigger failures) — sibling tests.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted spies
//
// `vi.mock` is hoisted above any top-level `const`. To let the mock factory
// close over the spies we use `vi.hoisted(...)`, which is hoisted above
// `vi.mock(...)` itself. The resulting object is the single source of truth
// for "what placement string did the SDK receive" across every test case
// below.
// ---------------------------------------------------------------------------
type DismissCallback = (
  info: unknown,
  result:
    | { type: 'purchased'; productId: string }
    | { type: 'restored'; productId?: string }
    | { type: 'declined' },
) => void;

const superwallSpies = vi.hoisted(() => {
  return {
    // Latest handler captured from a `register(...)` call so test cases
    // can drive the dismiss callback to drain the in-flight promise.
    latestHandler: { value: null as unknown },
    configure: vi.fn<[{ apiKey: string }], Promise<void>>(),
    // The SUT of this file: the wrapper must call this spy with a
    // `placement` field equal to the string passed to `triggerPaywall`.
    register: vi.fn<
      [{ placement: string; handler: unknown; params?: unknown }],
      Promise<void>
    >(),
  };
});

vi.mock('@superwall/react-native-superwall', () => {
  // The mocked `PaywallPresentationHandler` records callbacks the
  // wrapper attaches so the mocked `register()` can invoke `onDismiss`
  // and let the outer in-flight promise settle. Shape mirrors the real
  // SDK class so the wrapper's call sites typecheck identically.
  class PaywallPresentationHandler {
    public onDismissHandler?: DismissCallback;
    public onSkipHandler?: (reason: unknown) => void;
    public onErrorHandler?: (errorString: string) => void;
    public onDismiss(handler: DismissCallback): void {
      this.onDismissHandler = handler;
    }
    public onSkip(handler: (reason: unknown) => void): void {
      this.onSkipHandler = handler;
    }
    public onError(handler: (errorString: string) => void): void {
      this.onErrorHandler = handler;
    }
  }

  const SuperwallDefault = {
    configure: superwallSpies.configure,
    shared: {
      register: superwallSpies.register.mockImplementation(
        async (args: { placement: string; handler: unknown }) => {
          superwallSpies.latestHandler.value = args.handler;
        },
      ),
    },
  };

  return {
    default: SuperwallDefault,
    PaywallPresentationHandler,
  };
});

/**
 * Lazy loader — re-imports the wrapper after `vi.resetModules()` so each
 * test case starts with the module-private `configured` flag at `false`
 * (the wrapper-internal gate that `triggerPaywall` checks first).
 */
async function loadWrapper(): Promise<typeof import('../src/superwall/client')> {
  return await import('../src/superwall/client');
}

// A structurally-valid `pk_*` key per the regex in
// `core-ts/superwall/key.ts`. The literal `pk_` prefix and the
// `[A-Za-z0-9_-]+` body are the two things `assertValidSuperwallApiKey`
// gates on; this string is not a real Superwall key.
const VALID_KEY = 'pk_test_placement_forwarding_AAA';

// The Phase 2.5 placement registered in `apps/mobile/src/superwall/placements.ts`.
// Hard-coded here (rather than imported) so a renamed constant on the
// wrapper side does not silently mask a placement-forwarding regression
// in this file.
const PLACEMENT_PRIMARY = 'payment_model_unlock';

/**
 * Drain the in-flight `triggerPaywall` promise by dispatching a declined
 * callback. The test does not assert on the resolved outcome shape (that
 * lives in the outcome-mapping suite); the dispatch is purely to keep
 * test isolation clean and avoid pending promises across cases.
 */
async function drainTrigger(triggerPromise: Promise<unknown>): Promise<void> {
  // Yield one microtask so the wrapper's `await Superwall.shared.register(...)`
  // resolves and the handler reference is stored in `latestHandler`.
  await Promise.resolve();
  const handler = superwallSpies.latestHandler.value as {
    onDismissHandler?: DismissCallback;
  };
  handler.onDismissHandler?.({} /* info */, { type: 'declined' });
  await triggerPromise;
}

describe('triggerPaywall — placement-forwarding contract (Sub-AC 6.2)', () => {
  beforeEach(async () => {
    vi.resetModules();
    superwallSpies.configure.mockReset();
    superwallSpies.configure.mockResolvedValue(undefined);
    superwallSpies.register.mockReset();
    superwallSpies.register.mockImplementation(
      async (args: { placement: string; handler: unknown }) => {
        superwallSpies.latestHandler.value = args.handler;
      },
    );
    superwallSpies.latestHandler.value = null;
    const wrapper = await loadWrapper();
    wrapper.__resetSuperwallConfiguredForTest();
    await wrapper.configureSuperwall(VALID_KEY);
  });

  it('forwards the Phase 2.5 placement string verbatim to Superwall.shared.register', async () => {
    const wrapper = await loadWrapper();

    const triggerPromise = wrapper.triggerPaywall(PLACEMENT_PRIMARY);
    await drainTrigger(triggerPromise);

    // The single load-bearing assertion of this file: the placement
    // argument reaches the SDK unchanged. `expect.objectContaining` lets
    // other fields (handler, omitted params) vary without coupling this
    // contract to siblings — outcome shape and params passthrough are
    // pinned in the outcome-mapping suite.
    expect(superwallSpies.register).toHaveBeenCalledTimes(1);
    expect(superwallSpies.register).toHaveBeenCalledWith(
      expect.objectContaining({ placement: PLACEMENT_PRIMARY }),
    );
  });

  it('forwards an arbitrary placement string verbatim (no allow-list narrowing)', async () => {
    const wrapper = await loadWrapper();

    // The wrapper signature accepts `placement: string` (not the
    // `SuperwallPlacement` literal union) so future placements can be
    // added without a wrapper rev. This case pins that contract — the
    // wrapper does NOT validate against an allow-list, does NOT
    // fall back to the primary placement, and does NOT alias.
    const FUTURE_PLACEMENT = 'magazine_unlock_phase_4';
    const triggerPromise = wrapper.triggerPaywall(FUTURE_PLACEMENT);
    await drainTrigger(triggerPromise);

    expect(superwallSpies.register).toHaveBeenCalledTimes(1);
    expect(superwallSpies.register).toHaveBeenCalledWith(
      expect.objectContaining({ placement: FUTURE_PLACEMENT }),
    );
  });

  it('preserves the placement string when multiple triggers run sequentially', async () => {
    const wrapper = await loadWrapper();

    // Drive two sequential triggers with distinct placements. The
    // wrapper must forward each one independently — a stale closure or
    // a misplaced module-level cache would surface as the second call
    // carrying the first call's placement.
    const FIRST = 'payment_model_unlock';
    const SECOND = 'second_distinct_placement';

    const first = wrapper.triggerPaywall(FIRST);
    await drainTrigger(first);

    const second = wrapper.triggerPaywall(SECOND);
    await drainTrigger(second);

    expect(superwallSpies.register).toHaveBeenCalledTimes(2);

    // Index-by-index assertions pin both the order AND the per-call
    // placement, guarding against a regression where both calls
    // coincidentally pass the same string.
    const firstCallArg = superwallSpies.register.mock.calls[0]?.[0] as {
      placement: string;
    };
    const secondCallArg = superwallSpies.register.mock.calls[1]?.[0] as {
      placement: string;
    };
    expect(firstCallArg.placement).toBe(FIRST);
    expect(secondCallArg.placement).toBe(SECOND);
  });
});
