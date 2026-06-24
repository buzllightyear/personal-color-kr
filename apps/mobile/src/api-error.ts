/**
 * `api-error.ts` — a typed error for failed authenticated API calls plus the
 * single `isUnauthorized` predicate the auth self-heal path keys on.
 *
 * Why a typed error (not a string message):
 *   The `fetch`-backed transports (recipe catalog, gallery) used to throw a
 *   plain `Error` whose only signal was the status baked into the message
 *   string. A caller that wants to react to a 401 (specifically: discard the
 *   now-invalid stored token) had to substring-match the message — fragile and
 *   easy to break with a copy change. `ApiError` carries the numeric `status`
 *   as structured data so callers branch on `err.status === 401` directly. The
 *   default message still embeds the status, so the existing
 *   `rejects.toThrow(/status 401/)` transport tests keep passing.
 *
 * Why `isUnauthorized` is here (and duck-types `kind`):
 *   It is the ONE place that answers "does this caught error mean the stored
 *   session is no longer valid?". It recognises two shapes without coupling to
 *   either client:
 *     - an {@link ApiError} with `status === 401` (catalog / gallery); and
 *     - any object carrying `kind === 'unauthorized'` — the discriminant
 *       `request-generation.ts`'s `GenerationRequestError` already exposes. We
 *       duck-type `kind` rather than import that class so this low-level module
 *       has no dependency on the generation client.
 */

/** A failed authenticated API call, carrying the HTTP status as structured data. */
export class ApiError extends Error {
  /** The HTTP status code of the non-2xx response. */
  readonly status: number;

  constructor(status: number, message?: string) {
    super(message ?? `API request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * `true` when a caught error means the stored access token is no longer valid
 * (HTTP 401 / `unauthorized`), so the caller should discard it and force a
 * re-authentication. Recognises both {@link ApiError} (status 401) and any
 * `kind: 'unauthorized'` error (the generation client's typed error). Anything
 * else — other statuses, network errors, plain `Error`s, non-objects — is
 * `false`.
 */
export function isUnauthorized(err: unknown): boolean {
  if (err instanceof ApiError) {
    return err.status === 401;
  }
  if (typeof err === 'object' && err !== null && 'kind' in err) {
    return (err as { readonly kind?: unknown }).kind === 'unauthorized';
  }
  return false;
}
