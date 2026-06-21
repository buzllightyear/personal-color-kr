/**
 * `request-generation.ts` — the mobile API client for `POST /v1/generate`
 * (AC2 end-to-end image generation).
 *
 * Unlike `request-diagnosis.ts` (which returns JSON), `/v1/generate` returns
 * the **server-side watermarked** image as raw `image/png` bytes plus an
 * `X-Generation-Retry-Count` header. This module:
 *   1. POSTs `recipe_id` + the selfie as `multipart/form-data` with a Bearer
 *      token (auth is REQUIRED — the endpoint rejects anonymous calls 401);
 *   2. reads the PNG bytes and the retry-count header; and
 *   3. projects the bytes into a `data:image/png;base64,...` URI the funnel's
 *      result view can render directly via `<Image source={{ uri }} />` — no
 *      `expo-file-system` round-trip, so the mapping is unit-testable in the
 *      node vitest env with zero native modules.
 *
 * Transport seam (mirrors the sibling diagnosis/referral clients):
 *   the pure {@link requestGeneration} mapper takes an injected
 *   {@link GenerationTransport} so the bytes → data-URI projection and the
 *   error mapping are testable without a live HTTP client or a `FormData`
 *   polyfill. {@link createGenerationTransport} is the thin `fetch` + `FormData`
 *   factory, itself testable via injected `fetchImpl` / `formDataImpl`.
 *
 * Error model:
 *   Non-2xx responses surface as a typed {@link GenerationRequestError} with a
 *   discriminated {@link GenerationErrorKind} so the route can branch on a
 *   recoverable `generation_failed` (offer "try again") versus an
 *   unrecoverable `unauthorized` / `recipe_not_found` without string-matching.
 */
import { getApiBaseUrl } from './config/api-base-url';
import type { FormDataLike, SelfieFile } from './request-diagnosis';

// Re-export so callers/tests import the FormData contract from this module.
export type { FormDataLike, SelfieFile } from './request-diagnosis';

// ---------------------------------------------------------------------------
// Result + error model
// ---------------------------------------------------------------------------

/** Client-facing generation result: a renderable data URI + retry telemetry. */
export interface GenerationResult {
  /** `data:image/png;base64,...` — render via `<Image source={{ uri }} />`. */
  readonly imageDataUri: string;
  /** Auto-retries the server consumed before the accepted candidate (≥ 0). */
  readonly retryCount: number;
}

/** Discriminated generation failure kinds the UI branches on. */
export type GenerationErrorKind =
  | 'unauthorized'
  | 'recipe_not_found'
  | 'generation_failed'
  | 'network'
  | 'unknown';

/** Typed error raised by the transport / mapper on a failed generation. */
export class GenerationRequestError extends Error {
  readonly kind: GenerationErrorKind;

  constructor(kind: GenerationErrorKind, message?: string) {
    super(message ?? kind);
    this.name = 'GenerationRequestError';
    this.kind = kind;
  }
}

/**
 * The raw transport payload: the PNG bytes and the parsed retry count. The
 * network seam returns this; {@link requestGeneration} projects it to a
 * {@link GenerationResult}.
 */
export interface GenerationWirePayload {
  readonly bytes: Uint8Array;
  readonly retryCount: number;
}

/** Network seam: performs the POST and returns the raw payload (or throws). */
export type GenerationTransport = () => Promise<GenerationWirePayload>;

// ---------------------------------------------------------------------------
// Pure base64 — Uint8Array → standard base64 (no Buffer / btoa dependency).
// ---------------------------------------------------------------------------

const _B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Encode bytes to a standard (padded) base64 string. Pure, dependency-free. */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = i + 1 < len ? (bytes[i + 1] ?? 0) : 0;
    const b2 = i + 2 < len ? (bytes[i + 2] ?? 0) : 0;
    out += _B64[b0 >> 2];
    out += _B64[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += i + 1 < len ? _B64[((b1 & 0x0f) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < len ? _B64[b2 & 0x3f] : '=';
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pure mapper
// ---------------------------------------------------------------------------

/**
 * Run a generation request through the injected {@link GenerationTransport} and
 * project the PNG bytes into a renderable data URI. Pure: no globals, no
 * native modules — the transport owns all I/O.
 */
export async function requestGeneration(
  transport: GenerationTransport,
): Promise<GenerationResult> {
  const { bytes, retryCount } = await transport();
  if (bytes.length === 0) {
    throw new GenerationRequestError('generation_failed', 'empty image payload');
  }
  return {
    imageDataUri: `data:image/png;base64,${bytesToBase64(bytes)}`,
    retryCount: retryCount >= 0 ? retryCount : 0,
  };
}

// ---------------------------------------------------------------------------
// Real fetch + FormData transport factory
// ---------------------------------------------------------------------------

/** Minimal `Response` slice the transport relies on (testable without DOM). */
export interface GenerationFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** Minimal `fetch` contract for the generation POST. */
export type GenerationFetchLike = (
  url: string,
  init: {
    readonly method: 'POST';
    readonly headers: Record<string, string>;
    readonly body: FormDataLike;
  },
) => Promise<GenerationFetchResponse>;

/** Configuration for {@link createGenerationTransport}. */
export interface GenerationTransportConfig {
  readonly recipeId: string;
  readonly selfie: SelfieFile;
  readonly token: string;
  readonly baseUrl?: string;
  readonly fetchImpl?: GenerationFetchLike;
  readonly formDataImpl?: () => FormDataLike;
}

function _mapStatusToError(status: number): GenerationRequestError {
  if (status === 401) return new GenerationRequestError('unauthorized');
  if (status === 404) return new GenerationRequestError('recipe_not_found');
  if (status === 502 || status === 503) {
    return new GenerationRequestError('generation_failed');
  }
  return new GenerationRequestError('unknown', `HTTP ${status}`);
}

/**
 * Build a real `fetch` + `FormData`-backed {@link GenerationTransport}.
 * Appends `recipe_id` + the selfie file, attaches `Authorization: Bearer`,
 * and never sets `Content-Type` by hand (the runtime derives the multipart
 * boundary from the `FormData` body).
 */
export function createGenerationTransport(
  config: GenerationTransportConfig,
): GenerationTransport {
  const baseUrl = config.baseUrl ?? getApiBaseUrl();
  const fetchImpl =
    config.fetchImpl ?? (globalThis.fetch as unknown as GenerationFetchLike);
  const makeFormData =
    config.formDataImpl ??
    (() => new (globalThis as { FormData: new () => FormDataLike }).FormData());

  return async (): Promise<GenerationWirePayload> => {
    const form = makeFormData();
    form.append('recipe_id', config.recipeId);
    form.append('selfie', {
      uri: config.selfie.uri,
      name: config.selfie.name,
      type: config.selfie.mimeType,
    });

    let response: GenerationFetchResponse;
    try {
      response = await fetchImpl(`${baseUrl}/v1/generate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.token}` },
        body: form,
      });
    } catch {
      throw new GenerationRequestError('network', 'generation request failed');
    }

    if (!response.ok) {
      throw _mapStatusToError(response.status);
    }

    const buf = await response.arrayBuffer();
    const header = response.headers.get('X-Generation-Retry-Count');
    const parsed = header !== null ? Number.parseInt(header, 10) : 0;
    return {
      bytes: new Uint8Array(buf),
      retryCount: Number.isFinite(parsed) && parsed >= 0 ? parsed : 0,
    };
  };
}
