/**
 * Superwall SDK wrapper — single native-module seam for Phase 2.5.
 *
 * Purpose:
 *   This module is the ONLY file in the apps/mobile workspace that imports
 *   from `@superwall/react-native-superwall`. Every other consumer (route
 *   files, hooks, providers) talks to Superwall exclusively through the
 *   functions exported here.
 *
 * Why a single seam:
 *   1. Native isolation for vitest — the test runtime cannot parse the
 *      native SDK's Objective-C-backed JS shim (`SuperwallExpoModule`).
 *      Tests `vi.mock(...)` the wrapper module path (this file) so the
 *      native package is never resolved, never required, never loaded.
 *   2. Forward compatibility — when the SDK ships breaking changes
 *      (renaming `register` to `triggerPaywall`, refactoring the result
 *      union, etc.) we adapt the wrapper rather than every caller.
 *   3. Auditability — `grep` for the native package import returns
 *      exactly one file, satisfying the Seed constraint "All native
 *      @superwall/react-native-superwall imports confined to single
 *      wrapper file apps/mobile/src/superwall/client.ts".
 *
 * What this wrapper does NOT do:
 *   - It does NOT manage payment-slice state (`payment.isProcessing`,
 *     `payment.isPremium`). Those live in `FunnelStateProvider` and are
 *     written by the route file `payment-model.tsx` based on the
 *     outcome returned from {@link triggerPaywall}.
 *   - It does NOT emit analytics events. Paywall-internal events
 *     (`paywall_open`, `paywall_close`, `transaction_complete`) are sent
 *     by the Superwall SDK to its own dashboard; funnel-level events
 *     (`payment_completed`, `payment_skipped`, `paywall_error`) are
 *     fired by the route file via the `trackPayment*` placeholders.
 *   - It does NOT branch on Superwall A/B variants. Variant assignment
 *     happens server-side in the Superwall dashboard — the app sees only
 *     the resolved outcome.
 *   - It does NOT validate the API key format — that contract lives in
 *     `core-ts/superwall/key.ts` (`assertValidSuperwallApiKey`) and is
 *     invoked by {@link configureSuperwall} before the SDK call.
 *
 * Test contract:
 *   The expected `vi.mock` shape (used by Phase 2.5 route tests) is:
 *
 *     vi.mock('../../src/superwall/client', () => ({
 *       configureSuperwall: vi.fn().mockResolvedValue(undefined),
 *       triggerPaywall: vi.fn().mockResolvedValue({
 *         outcome: 'purchased',
 *         productId: 'com.personalcolorkr.monthly.premium',
 *       }),
 *       SuperwallNotConfiguredError: class extends Error {},
 *       SuperwallTriggerError: class extends Error {},
 *       PLACEMENT_PAYMENT_MODEL_UNLOCK: 'payment_model_unlock',
 *     }));
 *
 *   Mocking the wrapper module — not the underlying native package —
 *   means vitest never touches `@superwall/react-native-superwall` and
 *   the Flow/Objective-C-backed shim never reaches Node's parser.
 */
import {
  assertValidSuperwallApiKey,
  type SuperwallApiKey,
} from 'core-ts/superwall';

// The native SDK is imported as a namespace so we never reach into
// internals that may move between SDK versions. A single import site is
// the load-bearing constraint that lets vitest's `vi.mock` of this file
// replace the entire surface without resolving the underlying package.
import Superwall, {
  PaywallPresentationHandler,
  type PaywallSkippedReason,
} from '@superwall/react-native-superwall';

/**
 * Stable identifier for the Superwall placement triggered by the
 * payment_model funnel CTA. Exported as a constant so the Superwall
 * dashboard placement name and the app's call site live in lock-step —
 * a rename surfaces as a TS error rather than a silent paywall miss.
 *
 * Out of scope (Phase 2.5): additional placements for other funnel
 * surfaces (magazine unlock, etc.). They land in Phase 3/4.
 */
export const PLACEMENT_PAYMENT_MODEL_UNLOCK = 'payment_model_unlock' as const;

export type SuperwallPlacement = typeof PLACEMENT_PAYMENT_MODEL_UNLOCK;

/**
 * Discriminated union returned by {@link triggerPaywall}.
 *
 * The three terminal user-driven paths defined by the Seed are:
 *   - `purchased`  — user completed a sandbox / production purchase
 *                    The native SDK always carries a `productId` here
 *                    (the App Store SKU that completed) so the union
 *                    field is REQUIRED, not optional, on this variant.
 *   - `restored`   — Superwall detected an existing valid receipt.
 *                    The native SDK's typed PaywallResult does not
 *                    declare a `productId` for this variant, but
 *                    Phase 2.5 still surfaces it as OPTIONAL on the
 *                    wrapper boundary so future SDK versions (or
 *                    custom PurchaseController integrations) can
 *                    forward a SKU without a wrapper-level type break.
 *   - `declined`   — user dismissed the paywall without purchasing.
 *                    There is no SKU; the variant carries no productId.
 *
 * Two further outcomes are surfaced as thrown errors rather than as
 * outcome values so the happy-path code in `payment-model.tsx` can stay
 * linear (`try { const result = await triggerPaywall(...) } catch ...`):
 *   - SDK presentation error  → throws {@link SuperwallTriggerError}
 *   - configure not yet run   → throws {@link SuperwallNotConfiguredError}
 *
 * "Explicit skip" (user taps 나중에 할게요) is owned entirely by the
 * route file and never reaches this wrapper — that path bypasses the
 * paywall trigger and routes straight to locked result-reveal.
 *
 * Discriminator field is named `outcome` (NOT `status`) per Phase 2.5
 * sub-AC 3.2. The dedicated name disambiguates the value from React
 * Native's many `status` fields (network, gesture, animation) and
 * matches the Seed ontology concept `paywallOutcome`.
 */
export type PaywallOutcome =
  | { readonly outcome: 'purchased'; readonly productId: string }
  | { readonly outcome: 'restored'; readonly productId?: string }
  | { readonly outcome: 'declined' };

/**
 * Thrown by {@link configureSuperwall} when the API key is structurally
 * invalid (regex check from `core-ts/superwall/key.ts` fails) or when
 * the underlying SDK rejects the configure call.
 *
 * Distinct from {@link SuperwallTriggerError} so route code can decide
 * whether to retry (configure errors should not be retried with the same
 * key — the developer's .env needs fixing) vs. transient trigger errors
 * (which can be retried by tapping the CTA again).
 */
export class SuperwallNotConfiguredError extends Error {
  public override readonly name = 'SuperwallNotConfiguredError';
  public override readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

/**
 * Thrown by {@link triggerPaywall} when the paywall fails to present
 * (network loss, asset CDN unreachable, etc.) or the SDK rejects the
 * register call. The route file catches this and surfaces a Korean
 * inline error message + re-enables the CTA for retry per the Seed
 * "error_transparency" evaluation principle.
 */
export class SuperwallTriggerError extends Error {
  public override readonly name = 'SuperwallTriggerError';
  // `placement` is plain `string` (not the {@link SuperwallPlacement}
  // literal union) because Sub-AC 3.2 widens `triggerPaywall`'s
  // signature to accept any placement string. The error class is the
  // last hop before propagation up to the route file, where it gets
  // surfaced as a Korean inline error message — the field is logged,
  // not used as a discriminator, so the wider type is appropriate.
  public readonly placement: string;
  public override readonly cause?: unknown;
  constructor(message: string, placement: string, cause?: unknown) {
    super(message);
    this.placement = placement;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

/**
 * Module-private flag that gates the SDK `configure(...)` call so it
 * runs exactly once per JS runtime, even if `configureSuperwall` is
 * invoked from multiple lifecycle hooks. The Superwall SDK itself is
 * idempotent on repeat configure but we belt-and-suspender so the
 * single-source-of-truth contract is visible in this file.
 */
let configured = false;

/**
 * One-shot SDK initialiser. Call from the root layout's `useEffect`
 * with an empty dependency array so it runs once at app mount.
 *
 * Behaviour:
 *   - Validates `apiKey` via `assertValidSuperwallApiKey` from core-ts.
 *     A malformed key throws {@link SuperwallNotConfiguredError} with
 *     `cause` set to the underlying `SuperwallApiKeyError` so callers
 *     can branch on the discriminator (`empty` / `invalid_format`).
 *   - Resolves the first call and is a no-op on subsequent calls (the
 *     SDK is configured exactly once per runtime).
 *   - Logs a single-line breadcrumb via `console.log` (TODO: replace
 *     with PostHog `superwall_configured` event in Phase 4 when the
 *     analytics swap lands per `MVP-PLAN.md`).
 */
export async function configureSuperwall(apiKey: string): Promise<void> {
  if (configured) {
    return;
  }
  let validated: SuperwallApiKey;
  try {
    validated = assertValidSuperwallApiKey(apiKey);
  } catch (cause) {
    throw new SuperwallNotConfiguredError(
      `Superwall API key failed validation: ${(cause as Error).message}`,
      cause,
    );
  }
  try {
    await Superwall.configure({ apiKey: validated });
    configured = true;
    // TODO(phase-4): replace with posthog.capture('superwall_configured')
    // eslint-disable-next-line no-console
    console.log('[superwall] configured');
  } catch (cause) {
    const message =
      cause instanceof Error ? cause.message : 'unknown error';
    throw new SuperwallNotConfiguredError(
      `Superwall.configure() rejected: ${message}`,
      cause,
    );
  }
}

/**
 * Test-only reset hook. Lets vitest restart from an unconfigured state
 * between test cases that exercise the configure error branch.
 *
 * Not exported from the public barrel and intentionally guarded by the
 * `__TEST__` underscore prefix so it cannot accidentally be called from
 * production code (a lint rule could enforce this, but the naming
 * convention is the first line of defence).
 */
export function __resetSuperwallConfiguredForTest(): void {
  configured = false;
}

/**
 * Trigger a Superwall paywall for the named placement and resolve when
 * the user completes one of the three terminal paths (purchased,
 * restored, declined).
 *
 * @param placement Stable placement identifier registered on the
 *                  Superwall dashboard. Phase 2.5 only ships
 *                  {@link PLACEMENT_PAYMENT_MODEL_UNLOCK}; the typed
 *                  parameter accepts plain `string` so future
 *                  placements can be added without a wrapper signature
 *                  rev (the placement-name → screen-route correctness
 *                  is enforced by `placements.ts` at the call site).
 * @param params    Optional structured parameters forwarded to the
 *                  Superwall campaign audience filter. Phase 2.5 has no
 *                  audience filtering of its own, so callers normally
 *                  omit this. We keep the field on the public signature
 *                  so a future "trigger paywall when user is in
 *                  segment X" feature does not require a wrapper rev.
 *                  Per Seed constraint "No PII in payment slice or
 *                  analytics payloads", callers MUST NOT pass
 *                  transaction tokens, receipts, or email here.
 *
 * Errors:
 *   - Throws {@link SuperwallNotConfiguredError} if `configureSuperwall`
 *     has not been called (or threw) — the caller should ensure
 *     configure ran successfully in the root layout before any CTA tap.
 *   - Throws {@link SuperwallTriggerError} on network / asset / SDK
 *     failure. The route file maps this to a Korean inline error
 *     message and re-enables the CTA for retry.
 *
 * SDK contract bridging:
 *   The native SDK exposes the outcome via the
 *   {@link PaywallPresentationHandler} callbacks rather than via the
 *   `Superwall.register(...)` promise's resolved value. This wrapper
 *   collects the relevant callback (onDismiss with PaywallResult,
 *   onSkip with PaywallSkippedReason, onError with a string) into a
 *   promise chain so callers see a clean Promise<PaywallOutcome>.
 *
 * Outcome mapping:
 *   - SDK `onDismiss → PaywallResult.type === 'purchased'`  →
 *       `{ outcome: 'purchased', productId }` — the SDK guarantees
 *       a non-empty productId on this variant (see PaywallResult.ts
 *       in @superwall/react-native-superwall).
 *   - SDK `onDismiss → PaywallResult.type === 'restored'`   →
 *       `{ outcome: 'restored' }` — the SDK's typed restored variant
 *       does not carry a productId, but the wrapper defensively
 *       forwards a `productId` field if one is present at runtime
 *       (e.g. via a custom PurchaseController). Tests verify both
 *       presence-with-productId and absence-of-productId paths.
 *   - SDK `onDismiss → PaywallResult.type === 'declined'`   →
 *       `{ outcome: 'declined' }` (no productId).
 *   - SDK `onSkip`   (no-audience-match, etc.)              →
 *       `{ outcome: 'declined' }` (rationale: the user did not get a
 *       chance to purchase, so funnel-wise this is indistinguishable
 *       from a dismissal; the funnel just stays locked. Superwall's
 *       own dashboard captures the distinction.)
 *   - SDK `onError`                                         →
 *       throws SuperwallTriggerError
 */
export async function triggerPaywall(
  placement: string,
  params?: Record<string, unknown>,
): Promise<PaywallOutcome> {
  if (!configured) {
    throw new SuperwallNotConfiguredError(
      'configureSuperwall(apiKey) must complete before triggerPaywall(...)',
    );
  }

  // A handler instance per call so a stale closure from a previous
  // trigger cannot leak state across CTA taps.
  const handler = new PaywallPresentationHandler();

  const outcomePromise = new Promise<PaywallOutcome>((resolve, reject) => {
    handler.onDismiss((_info, result) => {
      if (result.type === 'purchased') {
        // SDK contract: productId is REQUIRED on the purchased variant.
        // We pass it through verbatim so the route file can record the
        // SKU for analytics tracking (purely the identifier — no
        // transaction tokens or receipts cross this boundary).
        resolve({ outcome: 'purchased', productId: result.productId });
        return;
      }
      if (result.type === 'restored') {
        // Defensive productId forwarding: the SDK's typed restored
        // variant has no productId, but a future SDK version (or a
        // custom PurchaseController) may attach one. Read via a
        // structural lookup so a TypeScript-strict build does not
        // require the field on the SDK type union.
        const maybeProductId = (result as { productId?: unknown }).productId;
        if (typeof maybeProductId === 'string' && maybeProductId.length > 0) {
          resolve({ outcome: 'restored', productId: maybeProductId });
          return;
        }
        resolve({ outcome: 'restored' });
        return;
      }
      if (result.type === 'declined') {
        resolve({ outcome: 'declined' });
        return;
      }
      reject(
        new SuperwallTriggerError(
          `Unknown PaywallResult.type for '${placement}'`,
          placement,
        ),
      );
    });
    handler.onSkip((_reason: PaywallSkippedReason) => {
      // The user never saw a paywall (Superwall decided not to present
      // one based on audience filters / holdouts / already subscribed).
      // From the funnel's perspective this is functionally identical
      // to a dismissal — the user did not unlock — so we surface
      // `declined`. Superwall's dashboard separately records the skip
      // reason for product-analytics drill-downs.
      resolve({ outcome: 'declined' });
    });
    handler.onError((errorString: string) => {
      reject(
        new SuperwallTriggerError(
          `Superwall paywall onError for '${placement}': ${errorString}`,
          placement,
        ),
      );
    });
  });

  // Kick off the register() call. Its promise resolves once the
  // register flow completes (Superwall has decided whether to present
  // a paywall and routed through the handler). Errors raised before
  // the handler gets wired up surface here.
  //
  // We only include `params` in the SDK call when the caller actually
  // passed something (TypeScript's exactOptionalPropertyTypes config
  // disallows `params: undefined` on the SDK's `params?:` field —
  // the value must be omitted, not set to undefined).
  try {
    const registerArgs: {
      placement: string;
      handler: PaywallPresentationHandler;
      params?: Record<string, unknown>;
    } = { placement, handler };
    if (params !== undefined) {
      registerArgs.params = params;
    }
    await Superwall.shared.register(registerArgs);
  } catch (cause) {
    throw new SuperwallTriggerError(
      `Superwall.register('${placement}') rejected`,
      placement,
      cause,
    );
  }

  return outcomePromise;
}
