/**
 * PostHogClient — analytics capture wrapper for personal-color-kr.
 *
 * Provides a `capture(event, props)` abstraction over the underlying
 * PostHog client.  In production this wraps the `posthog-react-native`
 * SDK instance constructed in `apps/mobile`; in tests, a mock transport
 * (a `vi.fn` recorder) is injected so unit tests run without native
 * modules and without making real network calls.
 *
 * Design choices:
 *   - Transport injection — the wrapper depends on the minimal
 *     {@link PostHogTransport} contract, not the concrete
 *     posthog-react-native class.  This mirrors the `AnalyticsSink`
 *     pattern in `funnel/analytics.ts` and keeps vitest tests fast
 *     (no native modules, no live keys).
 *   - `capture(event, props?)` matches the posthog-react-native shape
 *     1:1 so wiring up the real transport in `apps/mobile` is a
 *     one-liner: `createPostHogClient({ transport: posthog })`.
 *   - Properties are shallow-cloned + frozen before forwarding —
 *     defence-in-depth against accidental mutation between user code
 *     and the transport.
 *   - Empty / non-string event names throw {@link PostHogClientError}
 *     BEFORE the transport is touched; PostHog never receives a
 *     malformed event.
 *   - Transport failures are caught and re-raised as
 *     {@link PostHogClientError} carrying the original cause; analytics
 *     never silently drops events.
 *
 * This module is intentionally framework-agnostic — it contains no
 * React, no React Native, no Expo imports.  Wiring the wrapper into the
 * mobile app belongs to a sibling task in `apps/mobile/src/analytics/`.
 */

// ---------------------------------------------------------------------------
// Public contract — types
// ---------------------------------------------------------------------------

/**
 * Properties payload accepted by {@link PostHogClient.capture}.
 *
 * Keys are arbitrary strings; values are anything the underlying PostHog
 * client can serialize (PostHog itself accepts unknown / arbitrary JSON
 * scalars and nested objects).  We use `unknown` here rather than `any`
 * so callers narrow values at the call site.
 */
export type PostHogProperties = Readonly<Record<string, unknown>>;

/**
 * Minimal transport contract the wrapper depends on.
 *
 * In production this is satisfied by a `posthog-react-native` PostHog
 * instance (its `capture` method has this exact signature).  In tests
 * any object with a `capture` method satisfies the contract — typically
 * a `vi.fn` recorder.
 */
export interface PostHogTransport {
  capture(event: string, properties?: Record<string, unknown>): void;
}

/**
 * Public wrapper interface exposed to consumers.  Kept narrow on
 * purpose — the only operation the funnel and rating modules need is
 * `capture(event, props)`.  Additional operations (`identify`,
 * `flush`, `screen`, etc.) can be layered on as separate methods when a
 * concrete need arrives, without changing this core contract.
 */
export interface PostHogClient {
  capture(event: string, props?: PostHogProperties): void;
}

export interface CreatePostHogClientOptions {
  readonly transport: PostHogTransport;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Discriminator for {@link PostHogClientError} so callers can branch on
 * `err.reason` rather than parsing the message.
 */
export type PostHogClientErrorReason =
  | 'invalid_event_name'
  | 'invalid_transport'
  | 'transport_failure';

export class PostHogClientError extends Error {
  public override readonly name = 'PostHogClientError';
  public readonly reason: PostHogClientErrorReason;
  public override readonly cause?: unknown;

  constructor(reason: PostHogClientErrorReason, message: string, cause?: unknown) {
    super(message);
    this.reason = reason;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isTransport(value: unknown): value is PostHogTransport {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { capture?: unknown }).capture === 'function'
  );
}

function freezeProps(
  props: PostHogProperties | undefined,
): Record<string, unknown> | undefined {
  if (props === undefined) {
    return undefined;
  }
  // Shallow clone so the caller's object reference cannot be mutated
  // by the transport, then freeze the clone as defence-in-depth.
  const cloned: Record<string, unknown> = { ...props };
  return Object.freeze(cloned);
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Creates a {@link PostHogClient} bound to the supplied transport.
 *
 * The returned object is frozen so consumers cannot replace the
 * `capture` method at runtime (which would silently bypass the
 * validation pipeline below).
 *
 * @throws PostHogClientError ('invalid_transport') if the transport
 *   does not satisfy the {@link PostHogTransport} contract.
 */
export function createPostHogClient(
  options: CreatePostHogClientOptions,
): PostHogClient {
  if (!isTransport(options.transport)) {
    throw new PostHogClientError(
      'invalid_transport',
      'transport must implement capture(event, properties?)',
    );
  }
  const transport: PostHogTransport = options.transport;

  function capture(event: string, props?: PostHogProperties): void {
    if (!isNonEmptyString(event)) {
      throw new PostHogClientError(
        'invalid_event_name',
        `event name must be a non-empty string (got: ${String(event)})`,
      );
    }
    const frozen = freezeProps(props);
    try {
      if (frozen === undefined) {
        transport.capture(event);
      } else {
        transport.capture(event, frozen);
      }
    } catch (cause) {
      throw new PostHogClientError(
        'transport_failure',
        `PostHog transport failed while capturing event "${event}"`,
        cause,
      );
    }
  }

  return Object.freeze({ capture });
}
