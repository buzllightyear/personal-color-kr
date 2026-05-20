/**
 * Unit test — `triggerPaywall` outcome-mapping contract (Sub-AC 3.2).
 *
 * Scope:
 *   This file exercises the *real* implementation of `triggerPaywall`
 *   exported from `apps/mobile/src/superwall/client.ts`. The sibling
 *   `superwall-client-wrapper.test.ts` mocks the wrapper module itself
 *   (pinning the test-time substitution contract used by route tests);
 *   the sibling `superwall-configure-idempotency.test.ts` exercises the
 *   configure gate. Here we go one level deeper for the paywall trigger:
 *   we verify the wrapper correctly translates each native SDK callback
 *   shape into the documented `PaywallOutcome` discriminated union.
 *
 * Contract under test (per Sub-AC 3.2):
 *
 *   triggerPaywall(
 *     placement: string,
 *     params?: Record<string, unknown>,
 *   ): Promise<{
 *     outcome: 'purchased' | 'restored' | 'declined';
 *     productId?: string;
 *   }>
 *
 *   Mapping from native SDK `PaywallPresentationHandler` callbacks:
 *     - onDismiss → PaywallResult.type === 'purchased' (with productId)
 *         → resolves `{ outcome: 'purchased', productId }`
 *     - onDismiss → PaywallResult.type === 'restored'  (no productId)
 *         → resolves `{ outcome: 'restored' }`
 *     - onDismiss → PaywallResult.type === 'restored'  (defensive
 *                                                       productId
 *                                                       passthrough)
 *         → resolves `{ outcome: 'restored', productId }`
 *     - onDismiss → PaywallResult.type === 'declined'
 *         → resolves `{ outcome: 'declined' }`
 *
 *   Skip and error branches are documented in the wrapper and covered
 *   by sibling tests; this file focuses on the three completion outcomes
 *   listed in Sub-AC 3.2.
 *
 * Mocking strategy:
 *   - `vi.hoisted(...)` lifts the spy declarations above the
 *     `vi.mock(...)` factory so the factory can close over them. The
 *     mock replaces `@superwall/react-native-superwall` with:
 *       (a) a `default` export exposing `.configure` + `.shared.register`
 *           where `register` synchronously invokes the handler callbacks
 *           passed in by the wrapper, simulating the native module's
 *           presentation-and-callback flow.
 *       (b) a real-shaped `PaywallPresentationHandler` class so the
 *           wrapper's `new PaywallPresentationHandler()` returns an
 *           object whose `onDismiss / onSkip / onError` methods store
 *           the callbacks where the mocked `register` can read them.
 *   - Tests configure the wrapper once per case (the module-private
 *     `configured` flag must be true before `triggerPaywall` is
 *     allowed) and use `__resetSuperwallConfiguredForTest()` between
 *     cases to keep them independent.
 *
 * What this test does NOT cover:
 *   - Error / skip mapping — covered by sibling completion-state tests.
 *   - Native paywall presentation behaviour — covered E2E by the EAS
 *     custom dev client on a real iOS simulator (Seed exit conditions
 *     `paywall_trigger` and `purchase_flow`).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted spies + handler store
//
// The mocked SDK's `Superwall.shared.register(...)` needs to fire callbacks
// the wrapper registered on its `PaywallPresentationHandler` instance. We
// keep a single mutable store of the *latest* handler so each test case can
// drive the callback path it cares about.
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
    // The mocked SDK stores the handler that the wrapper passed in
    // most recently so each test case can dispatch a specific callback.
    latestHandler: { value: null as unknown },
    configure: vi.fn<[{ apiKey: string }], Promise<void>>(),
    register: vi.fn<
      [{ placement: string; handler: unknown; params?: unknown }],
      Promise<void>
    >(),
  };
});

vi.mock('@superwall/react-native-superwall', () => {
  // The mocked `PaywallPresentationHandler` records the callbacks the
  // wrapper attaches so the mocked `register()` can invoke them on
  // demand. The shape (`onDismiss(handler) { this.onDismissHandler = handler }`)
  // mirrors the real SDK's class so the wrapper's call sites typecheck
  // and behave identically.
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
      // The mocked register stores the handler instance for the test
      // case to drive, then resolves. The wrapper awaits this promise
      // BEFORE returning the outcome promise, so the test case must
      // arrange the handler dispatch *before* (or synchronously with)
      // calling triggerPaywall to keep timing simple.
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

// Lazy loader so each test re-imports the wrapper after
// `vi.resetModules()` — guarantees the module-private `configured` flag
// starts at `false` per case (defence-in-depth alongside
// `__resetSuperwallConfiguredForTest`).
async function loadWrapper(): Promise<typeof import('../src/superwall/client')> {
  return await import('../src/superwall/client');
}

// A structurally valid `pk_*` key per the regex in
// `core-ts/superwall/key.ts`. The literal `pk_` prefix and the
// `[A-Za-z0-9_-]+` body are what `assertValidSuperwallApiKey` gates on;
// this is not a real Superwall key.
const VALID_KEY = 'pk_test_outcome_mapping_AAA';
const PLACEMENT = 'payment_model_unlock';
const PRODUCT_ID = 'com.personalcolorkr.monthly.premium';

/**
 * Reusable helper: load the wrapper, run configure(), and start a
 * triggerPaywall() call. Returns the in-flight outcome promise plus
 * the captured handler so the test case can dispatch a callback.
 *
 * The dispatch-before-await ordering matters:
 *   - triggerPaywall() awaits Superwall.shared.register() FIRST
 *   - register() resolves with the handler stored in latestHandler
 *   - then triggerPaywall() awaits the handler-callback promise
 *
 * Because the mocked register resolves synchronously (it does not
 * actually present a paywall), we can race: schedule the callback
 * dispatch via a microtask AFTER the test has the handler reference.
 */
async function startTrigger(
  wrapper: typeof import('../src/superwall/client'),
  params?: Record<string, unknown>,
): Promise<{
  readonly outcomePromise: Promise<
    | { readonly outcome: 'purchased'; readonly productId: string }
    | { readonly outcome: 'restored'; readonly productId?: string }
    | { readonly outcome: 'declined' }
  >;
  readonly handler: {
    onDismissHandler?: DismissCallback;
    onSkipHandler?: (reason: unknown) => void;
    onErrorHandler?: (errorString: string) => void;
  };
}> {
  const outcomePromise = wrapper.triggerPaywall(PLACEMENT, params);
  // Yield one microtask so the wrapper's `await Superwall.shared.register(...)`
  // resolves and the handler reference is stored in `latestHandler`.
  await Promise.resolve();
  const handler = superwallSpies.latestHandler.value as {
    onDismissHandler?: DismissCallback;
    onSkipHandler?: (reason: unknown) => void;
    onErrorHandler?: (errorString: string) => void;
  };
  return { outcomePromise, handler };
}

describe('triggerPaywall — outcome mapping contract', () => {
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

  it('resolves to `{ outcome: "purchased", productId }` when the SDK dispatches onDismiss(purchased)', async () => {
    const wrapper = await loadWrapper();
    // Pre-configured in beforeEach — `configured` flag is true and the
    // wrapper accepts the trigger call.
    const { outcomePromise, handler } = await startTrigger(wrapper);
    expect(handler.onDismissHandler).toBeTypeOf('function');

    // Drive the SDK callback the way the real native module would
    // invoke onDismiss after a sandbox purchase completed.
    handler.onDismissHandler?.({} /* info */, {
      type: 'purchased',
      productId: PRODUCT_ID,
    });

    const result = await outcomePromise;
    // Discriminator field is `outcome` (per Sub-AC 3.2), productId is
    // REQUIRED on the purchased variant and forwarded verbatim from the
    // SDK callback payload.
    expect(result).toEqual({ outcome: 'purchased', productId: PRODUCT_ID });
  });

  it('resolves to `{ outcome: "restored", productId }` when the SDK dispatches onDismiss(restored) with a productId field', async () => {
    const wrapper = await loadWrapper();
    const { outcomePromise, handler } = await startTrigger(wrapper);
    expect(handler.onDismissHandler).toBeTypeOf('function');

    // Defensive productId passthrough: the SDK's typed restored variant
    // does NOT carry a productId, but a future SDK or a custom
    // PurchaseController may attach one. The wrapper's structural
    // lookup (`result as { productId?: unknown }`) reads it and the
    // outcome carries the SKU into the route file's analytics tracker.
    handler.onDismissHandler?.({} /* info */, {
      type: 'restored',
      productId: PRODUCT_ID,
    });

    const result = await outcomePromise;
    expect(result).toEqual({ outcome: 'restored', productId: PRODUCT_ID });
  });

  it('resolves to `{ outcome: "restored" }` (no productId) when the SDK dispatches onDismiss(restored) without a productId field', async () => {
    const wrapper = await loadWrapper();
    const { outcomePromise, handler } = await startTrigger(wrapper);
    expect(handler.onDismissHandler).toBeTypeOf('function');

    // This is the SDK's documented restored shape — the typed
    // PaywallResult union for `restored` declares no productId. The
    // wrapper must NOT invent one. The route file's analytics tracker
    // surfaces this as restored-without-SKU which is acceptable since
    // Superwall's own dashboard captures the SKU separately.
    handler.onDismissHandler?.({} /* info */, { type: 'restored' });

    const result = await outcomePromise;
    expect(result).toEqual({ outcome: 'restored' });
    // Explicit negative assertion — guards against a future regression
    // where the wrapper accidentally backfills productId with an empty
    // string or 'undefined' literal.
    expect((result as { productId?: string }).productId).toBeUndefined();
  });

  it('resolves to `{ outcome: "declined" }` when the SDK dispatches onDismiss(declined)', async () => {
    const wrapper = await loadWrapper();
    const { outcomePromise, handler } = await startTrigger(wrapper);
    expect(handler.onDismissHandler).toBeTypeOf('function');

    handler.onDismissHandler?.({} /* info */, { type: 'declined' });

    const result = await outcomePromise;
    expect(result).toEqual({ outcome: 'declined' });
    // The declined variant carries no productId — verifying the
    // negative case keeps a future regression that smuggles a SKU
    // into the analytics payload from sliding through.
    expect((result as { productId?: string }).productId).toBeUndefined();
  });

  it('forwards the placement and (when supplied) params to Superwall.shared.register', async () => {
    const wrapper = await loadWrapper();

    // Drive the dismiss callback so the in-flight promise resolves
    // and the test does not leak a pending promise across cases.
    const triggerPromise = wrapper.triggerPaywall(PLACEMENT, {
      cohort: 'phase_2_5',
    });
    await Promise.resolve();
    const handler = superwallSpies.latestHandler.value as {
      onDismissHandler?: DismissCallback;
    };
    handler.onDismissHandler?.({} /* info */, { type: 'declined' });
    await triggerPromise;

    // The wrapper forwards placement + params (when present) +
    // handler. Other fields on the SDK's register signature
    // (`feature` callback) are not used in Phase 2.5.
    expect(superwallSpies.register).toHaveBeenCalledTimes(1);
    expect(superwallSpies.register).toHaveBeenCalledWith(
      expect.objectContaining({
        placement: PLACEMENT,
        params: { cohort: 'phase_2_5' },
      }),
    );
  });

  it('omits `params` entirely from the register call when the caller does not supply it', async () => {
    const wrapper = await loadWrapper();

    const triggerPromise = wrapper.triggerPaywall(PLACEMENT);
    await Promise.resolve();
    const handler = superwallSpies.latestHandler.value as {
      onDismissHandler?: DismissCallback;
    };
    handler.onDismissHandler?.({} /* info */, { type: 'declined' });
    await triggerPromise;

    // exactOptionalPropertyTypes constraint: when the caller omits
    // `params`, the wrapper must NOT pass `params: undefined` to the
    // SDK — the field must be absent from the object literal entirely.
    expect(superwallSpies.register).toHaveBeenCalledTimes(1);
    const callArg = superwallSpies.register.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(callArg).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(callArg, 'params')).toBe(false);
    expect(callArg['placement']).toBe(PLACEMENT);
  });
});
