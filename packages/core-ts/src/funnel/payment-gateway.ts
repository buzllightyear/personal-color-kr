/**
 * 통합 결제 인터페이스 — Sub-AC 2-1.
 *
 * Defines the PaymentGateway abstract protocol (charge / cancel / status)
 * that any Korean payment provider adapter (Toss / KakaoPay / NicePay) must
 * conform to.  Provides a fully-behavioural in-memory MockGateway for use in
 * tests and local development without hitting any real payment endpoint.
 *
 * Design invariants:
 *   - All three methods are async — real gateways involve network I/O.
 *   - Every result is a discriminated union (success | failure) so callers
 *     never need to catch and parse; they branch on `result.ok`.
 *   - All input/output types are deeply readonly — no accidental mutation.
 *   - MockGateway keeps an append-only call log; tests can inspect every
 *     invocation without monkey-patching.
 *   - MockGateway is deterministic when a clock is injected — safe for tests.
 *   - No network, crypto, or timer imports — portable across Node / RN / Edge.
 */

// ---------------------------------------------------------------------------
// Shared identifier types
// ---------------------------------------------------------------------------

/** Opaque string identifying a single payment transaction. */
export type TransactionId = string;

/** Payment methods supported by the Korean market variants. */
export type PaymentMethod =
  | 'toss_pay'
  | 'kakao_pay'
  | 'nice_pay'
  | 'card'
  | 'virtual_account';

// ---------------------------------------------------------------------------
// Charge
// ---------------------------------------------------------------------------

/** Input to initiate a payment charge. */
export interface ChargeRequest {
  /** Caller-generated idempotency key — prevents duplicate charges on retry. */
  readonly idempotencyKey: string;
  /** Amount in the smallest currency unit (e.g. KRW cents — *jeon*, or USD cents). */
  readonly amountMinorUnits: number;
  /** ISO 4217 currency code (e.g. "KRW", "USD"). */
  readonly currencyCode: string;
  /** Human-readable description shown on the provider's checkout UI. */
  readonly description: string;
  /** Preferred payment method; provider may fall back gracefully. */
  readonly method: PaymentMethod;
  /** Arbitrary caller metadata forwarded to the provider (e.g. plan id, user id). */
  readonly metadata: Readonly<Record<string, string>>;
}

export interface ChargeSuccess {
  readonly ok: true;
  readonly transactionId: TransactionId;
  /** Provider-assigned reference (e.g. Toss orderNo, KakaoPay tid). */
  readonly providerRef: string;
  /** Final charge status as reported by the provider at creation time. */
  readonly status: 'pending' | 'authorized' | 'captured';
  /** Epoch ms when the charge was created at the provider. */
  readonly createdAt: number;
}

export interface ChargeFailure {
  readonly ok: false;
  readonly errorCode: string;
  readonly errorMessage: string;
}

export type ChargeResult = ChargeSuccess | ChargeFailure;

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

/** Input to cancel an existing charge. */
export interface CancelRequest {
  readonly transactionId: TransactionId;
  /** Reason forwarded to the provider; may appear on the user's receipt. */
  readonly reason: string;
}

export interface CancelSuccess {
  readonly ok: true;
  readonly transactionId: TransactionId;
  readonly cancelledAt: number; // epoch ms
}

export interface CancelFailure {
  readonly ok: false;
  readonly errorCode: string;
  readonly errorMessage: string;
}

export type CancelResult = CancelSuccess | CancelFailure;

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/** Input to query the current status of a charge. */
export interface StatusRequest {
  readonly transactionId: TransactionId;
}

export type TransactionStatus =
  | 'pending'
  | 'authorized'
  | 'captured'
  | 'cancelled'
  | 'refunded'
  | 'failed';

export interface StatusSuccess {
  readonly ok: true;
  readonly transactionId: TransactionId;
  readonly status: TransactionStatus;
  /** Epoch ms of the most recent status update at the provider. */
  readonly updatedAt: number;
  /** Original charge amount (minor units) for reconciliation. */
  readonly amountMinorUnits: number;
  readonly currencyCode: string;
}

export interface StatusFailure {
  readonly ok: false;
  readonly errorCode: string;
  readonly errorMessage: string;
}

export type StatusResult = StatusSuccess | StatusFailure;

// ---------------------------------------------------------------------------
// PaymentGateway protocol
// ---------------------------------------------------------------------------

/**
 * Abstract protocol every Korean payment provider adapter must implement.
 *
 * Three responsibilities:
 *   1. `charge`  — initiate a new payment charge.
 *   2. `cancel`  — void / reverse an existing charge.
 *   3. `status`  — query the live status of a charge.
 *
 * Return types are discriminated unions (`ok: true | false`) so callers
 * can branch without try/catch on expected business errors.  Unexpected
 * infrastructure errors (network timeouts, parse failures) may still throw.
 */
export interface PaymentGateway {
  charge(request: ChargeRequest): Promise<ChargeResult>;
  cancel(request: CancelRequest): Promise<CancelResult>;
  status(request: StatusRequest): Promise<StatusResult>;
}

// ---------------------------------------------------------------------------
// In-memory MockGateway — deterministic, no network
// ---------------------------------------------------------------------------

/** A single recorded call to one of the MockGateway methods. */
export type MockGatewayCall =
  | { readonly method: 'charge'; readonly request: ChargeRequest }
  | { readonly method: 'cancel'; readonly request: CancelRequest }
  | { readonly method: 'status'; readonly request: StatusRequest };

/** Stored charge record inside the MockGateway. */
interface StoredCharge {
  transactionId: TransactionId;
  providerRef: string;
  status: TransactionStatus;
  amountMinorUnits: number;
  currencyCode: string;
  createdAt: number;
  updatedAt: number;
}

/** Options for constructing a MockGateway. */
export interface MockGatewayOptions {
  /**
   * Injectable clock (epoch ms).  Defaults to `Date.now`.
   * Inject a deterministic counter in tests for reproducible timestamps.
   */
  readonly now?: () => number;
  /**
   * Injectable transaction ID generator.
   * Defaults to `txn_<counter>` (increments per charge).
   */
  readonly idProvider?: (index: number) => TransactionId;
  /**
   * If `true`, `charge` always returns a failure result.
   * Useful for testing error-handling paths without extra mocks.
   */
  readonly forceChargeFailure?: boolean;
  /**
   * If `true`, `cancel` always returns a failure result.
   */
  readonly forceCancelFailure?: boolean;
  /**
   * If `true`, `status` always returns a failure result.
   */
  readonly forceStatusFailure?: boolean;
}

/**
 * In-memory implementation of {@link PaymentGateway}.
 *
 * Behaviour:
 *   - `charge`: stores a new `pending` transaction; returns `ChargeSuccess`.
 *   - `cancel`: looks up the transaction and marks it `cancelled`; returns
 *     `CancelSuccess`.  If the transaction is not found, returns a
 *     `CancelFailure` with `errorCode: 'not_found'`.
 *   - `status`: looks up the transaction and returns its current state.
 *     If not found, returns `StatusFailure` with `errorCode: 'not_found'`.
 *   - Every call is appended to `calls` for test inspection.
 *   - `forceXxxFailure` flags simulate provider-side errors.
 *
 * Thread-safety: JavaScript is single-threaded; no locking needed.
 */
export class MockGateway implements PaymentGateway {
  private readonly _calls: MockGatewayCall[] = [];
  private readonly _store = new Map<TransactionId, StoredCharge>();
  private _chargeCounter = 0;

  private readonly _now: () => number;
  private readonly _idProvider: (index: number) => TransactionId;
  private readonly _forceChargeFailure: boolean;
  private readonly _forceCancelFailure: boolean;
  private readonly _forceStatusFailure: boolean;

  constructor(options: MockGatewayOptions = {}) {
    this._now = options.now ?? (() => Date.now());
    this._idProvider = options.idProvider ?? ((i) => `txn_${i}`);
    this._forceChargeFailure = options.forceChargeFailure ?? false;
    this._forceCancelFailure = options.forceCancelFailure ?? false;
    this._forceStatusFailure = options.forceStatusFailure ?? false;
  }

  /** Append-only log of every call received (immutable view). */
  get calls(): readonly MockGatewayCall[] {
    return this._calls;
  }

  /** Number of transactions currently stored. */
  get storedCount(): number {
    return this._store.size;
  }

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    this._calls.push(
      Object.freeze({ method: 'charge', request: Object.freeze({ ...request }) }),
    );

    if (this._forceChargeFailure) {
      return Object.freeze({
        ok: false,
        errorCode: 'provider_error',
        errorMessage: 'MockGateway: forced charge failure',
      } satisfies ChargeFailure);
    }

    const index = this._chargeCounter++;
    const transactionId = this._idProvider(index);
    const now = this._now();
    const stored: StoredCharge = {
      transactionId,
      providerRef: `mock_ref_${index}`,
      status: 'pending',
      amountMinorUnits: request.amountMinorUnits,
      currencyCode: request.currencyCode,
      createdAt: now,
      updatedAt: now,
    };
    this._store.set(transactionId, stored);

    return Object.freeze({
      ok: true,
      transactionId,
      providerRef: stored.providerRef,
      // A freshly created charge is always 'pending'; ChargeSuccess narrows
      // status to the creation-time subset of TransactionStatus.
      status: 'pending',
      createdAt: stored.createdAt,
    } satisfies ChargeSuccess);
  }

  async cancel(request: CancelRequest): Promise<CancelResult> {
    this._calls.push(
      Object.freeze({ method: 'cancel', request: Object.freeze({ ...request }) }),
    );

    if (this._forceCancelFailure) {
      return Object.freeze({
        ok: false,
        errorCode: 'provider_error',
        errorMessage: 'MockGateway: forced cancel failure',
      } satisfies CancelFailure);
    }

    const stored = this._store.get(request.transactionId);
    if (!stored) {
      return Object.freeze({
        ok: false,
        errorCode: 'not_found',
        errorMessage: `MockGateway: transaction not found: ${request.transactionId}`,
      } satisfies CancelFailure);
    }

    const now = this._now();
    stored.status = 'cancelled';
    stored.updatedAt = now;

    return Object.freeze({
      ok: true,
      transactionId: request.transactionId,
      cancelledAt: now,
    } satisfies CancelSuccess);
  }

  async status(request: StatusRequest): Promise<StatusResult> {
    this._calls.push(
      Object.freeze({ method: 'status', request: Object.freeze({ ...request }) }),
    );

    if (this._forceStatusFailure) {
      return Object.freeze({
        ok: false,
        errorCode: 'provider_error',
        errorMessage: 'MockGateway: forced status failure',
      } satisfies StatusFailure);
    }

    const stored = this._store.get(request.transactionId);
    if (!stored) {
      return Object.freeze({
        ok: false,
        errorCode: 'not_found',
        errorMessage: `MockGateway: transaction not found: ${request.transactionId}`,
      } satisfies StatusFailure);
    }

    return Object.freeze({
      ok: true,
      transactionId: stored.transactionId,
      status: stored.status,
      updatedAt: stored.updatedAt,
      amountMinorUnits: stored.amountMinorUnits,
      currencyCode: stored.currencyCode,
    } satisfies StatusSuccess);
  }
}
