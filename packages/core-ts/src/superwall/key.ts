/**
 * SuperwallApiKey — format validation for the SUPERWALL_API_KEY env var.
 *
 * Phase 1.2 scope: Superwall is **keys-only** this phase.  The
 * superwall-react-native SDK install is deferred to Phase 2.5 because it
 * requires a custom dev client (apps/mobile is pure Expo managed
 * workflow this phase).  Until then we still want to guarantee that the
 * key bundled into the mobile app via `app.config.ts` `extra` block is
 * structurally valid, so we catch bad copy-pastes / empty placeholders
 * at config-load time instead of at runtime in Phase 2.5.
 *
 * What "valid" means here:
 *   - non-empty after trimming whitespace
 *   - starts with the `pk_` prefix (Superwall public-API-key convention)
 *   - body characters are `[A-Za-z0-9_-]+` so we accept the placeholder
 *     in `.env.example` AND real dashboard-issued keys (which can
 *     contain dashes).
 *
 * No live network calls — this is regex validation only.  The function
 * is intentionally framework-agnostic so it can be invoked from
 * `app.config.ts` (Node/Expo) or from vitest tests without any
 * react-native / Expo imports.
 */

// ---------------------------------------------------------------------------
// Public contract
// ---------------------------------------------------------------------------

/**
 * Discriminator for {@link SuperwallApiKeyError} so callers can branch
 * on `err.reason` rather than parsing the message string.
 */
export type SuperwallApiKeyErrorReason = 'empty' | 'not_string' | 'invalid_format';

export class SuperwallApiKeyError extends Error {
  public override readonly name = 'SuperwallApiKeyError';
  public readonly reason: SuperwallApiKeyErrorReason;

  constructor(reason: SuperwallApiKeyErrorReason, message: string) {
    super(message);
    this.reason = reason;
  }
}

/**
 * Branded string type for keys that have passed validation.  Callers
 * can pin parameters to `SuperwallApiKey` to statically guarantee they
 * only ever receive an already-validated value.
 */
export type SuperwallApiKey = string & { readonly __brand: 'SuperwallApiKey' };

// ---------------------------------------------------------------------------
// Regex
// ---------------------------------------------------------------------------

/**
 * Exposed for testing and for diagnostic logging (so the regex source
 * of truth is queryable without re-importing it manually).  The pattern
 * matches Superwall's documented `pk_<token>` public-API-key shape.
 *
 * Body alphabet `[A-Za-z0-9_-]+` is deliberately permissive to cover:
 *   - the `.env.example` placeholder (contains `_`)
 *   - real dashboard-issued keys (which may contain `-`)
 */
export const SUPERWALL_API_KEY_PATTERN: RegExp = /^pk_[A-Za-z0-9_-]+$/;

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/**
 * Non-throwing predicate variant.  Returns `true` iff `value` is a
 * non-empty string matching {@link SUPERWALL_API_KEY_PATTERN}.
 *
 * Use this when the caller wants to branch on validity (eg. a config
 * loader that logs a warning instead of crashing).  For load-time
 * guards prefer {@link assertValidSuperwallApiKey} so the failure
 * surfaces as a typed exception.
 */
export function isValidSuperwallApiKey(value: unknown): value is SuperwallApiKey {
  if (typeof value !== 'string') {
    return false;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return false;
  }
  return SUPERWALL_API_KEY_PATTERN.test(trimmed);
}

/**
 * Throwing variant.  Returns the validated key as a branded
 * {@link SuperwallApiKey} or throws {@link SuperwallApiKeyError}.
 *
 * The returned value is the trimmed input so callers do not need to
 * trim again before forwarding to the SDK in Phase 2.5.
 *
 * @throws SuperwallApiKeyError
 *   - reason `not_string` when value is not a string
 *   - reason `empty` when value is an empty / whitespace-only string
 *   - reason `invalid_format` when value does not match the pk_ prefix
 *     + body alphabet contract
 */
export function assertValidSuperwallApiKey(value: unknown): SuperwallApiKey {
  if (typeof value !== 'string') {
    throw new SuperwallApiKeyError(
      'not_string',
      `SUPERWALL_API_KEY must be a string (got: ${typeof value})`,
    );
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new SuperwallApiKeyError('empty', 'SUPERWALL_API_KEY must not be empty');
  }
  if (!SUPERWALL_API_KEY_PATTERN.test(trimmed)) {
    throw new SuperwallApiKeyError(
      'invalid_format',
      `SUPERWALL_API_KEY must match ${SUPERWALL_API_KEY_PATTERN.source} (got: "${trimmed}")`,
    );
  }
  return trimmed as SuperwallApiKey;
}
