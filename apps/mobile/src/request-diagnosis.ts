/**
 * `request-diagnosis.ts` — the mobile API client for `POST /v1/diagnose`
 * (the real personal-color diagnosis call). This is the single seam between
 * the FastAPI diagnosis surface and the funnel's `fake_scan_animation` →
 * `result_reveal` hand-off, which until now rendered a hardcoded
 * `autumn_warm` teaser with no backend round-trip.
 *
 * Responsibility:
 *   The server is the *single source of truth* for the diagnosed season /
 *   tone / contrast. The endpoint is a deterministic, rule-based pipeline
 *   (Pillow decode → MediaPipe face detect → region colour extraction →
 *   tone/contrast/season classification); there is no LLM or Fal.ai call, so
 *   the client carries no model logic — it uploads the selfie and projects
 *   the result. This module:
 *     1. declares the wire shape the FastAPI `DiagnoseResponse` emits
 *        (snake_case 1:1 with `api.schemas.diagnose.DiagnoseResponse`);
 *     2. maps it to a client-facing camelCase value object, deriving the
 *        `${season}_${tone}` category string the funnel surfaces use (e.g.
 *        `autumn_warm`, matching the legacy hardcoded teaser); and
 *     3. provides a real `fetch`-backed transport factory that POSTs the
 *        selfie as `multipart/form-data` with a Bearer token against
 *        `${baseUrl}/v1/diagnose`.
 *
 * Why dependency injection (transport seam):
 *   Mirrors the sibling `fetch-referral-me.ts` / `submit-sign-in-with-apple.ts`
 *   stance: the pure mapping (`requestDiagnosis`) takes an injected transport
 *   so the wire → camel projection is unit-testable without a live HTTP
 *   client, a `FormData` polyfill, expo modules, or a running backend. The
 *   real transport (`createDiagnosisTransport`) is a thin factory over global
 *   `fetch` + `FormData`, itself testable via injected `fetchImpl` /
 *   `formDataImpl`.
 *
 * Auth (Bearer) is REQUIRED:
 *   Unlike the soft-gate referrals call, `/v1/diagnose` rejects an
 *   unauthenticated request with HTTP 401. The access token is minted by
 *   `POST /v1/auth/sign-in-with-apple` — an Apple-Sign-In flow that is gated
 *   on the Apple Developer membership. The token is therefore *injected* here
 *   (not read from a store) so this module stays decoupled from the
 *   auth-session wiring that is landed separately.
 *
 * Error model:
 *   Non-2xx responses are surfaced as a typed {@link DiagnosisRequestError}
 *   carrying a discriminated {@link DiagnosisErrorKind} so the funnel can
 *   branch on a recoverable `face_not_detected` (ask the user to re-take the
 *   selfie) versus an unrecoverable `unauthorized` / `server_error` without
 *   string-matching a raw message.
 */
import { getApiBaseUrl } from './config/api-base-url';

// ---------------------------------------------------------------------------
// Domain unions — the lowercase ASCII enum wire format the server emits.
// ---------------------------------------------------------------------------

/** Diagnosed personal-color season. Lowercase ASCII, 1:1 with the server. */
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

/** Warm/cool undertone axis. The server never emits `neutral`. */
export type Tone = 'warm' | 'cool';

/** High/low contrast axis (skin↔hair luma gap). */
export type Contrast = 'high' | 'low';

/**
 * The `${season}_${tone}` category string the funnel surfaces use as the
 * single "personal-color category" identifier (e.g. `autumn_warm`). Matches
 * the legacy hardcoded `FUNNEL_SCREENS.result_reveal.metadata.teaserCategory`
 * value so analytics and result rendering keyed on the old constant keep
 * working once the real diagnosis replaces the stub.
 */
export type DiagnosisCategory = `${Season}_${Tone}`;

// ---------------------------------------------------------------------------
// Wire + client shapes
// ---------------------------------------------------------------------------

/**
 * The JSON body `POST /v1/diagnose` returns on HTTP 200, snake_case 1:1 with
 * the server's `api.schemas.diagnose.DiagnoseResponse` Pydantic model. This
 * is the wire contract — keep the field names in lock-step with that schema.
 */
export interface DiagnosisWireResponse {
  readonly season: Season;
  readonly confidence: number;
  readonly tone: Tone;
  readonly contrast: Contrast;
  readonly tone_confidence: number;
  readonly contrast_confidence: number;
  readonly skin_luma: number;
  readonly hair_luma: number;
  readonly eyes_luma: number;
}

/**
 * Client-facing camelCase projection of {@link DiagnosisWireResponse}, plus
 * the derived {@link DiagnosisCategory}. The funnel reads `season` / `tone`
 * to render the localized category headline and `category` for analytics.
 * The `*Luma` / `*Confidence` fields are carried through for a future
 * "why this result" explanation surface (not rendered yet).
 */
export interface DiagnosisResult {
  readonly season: Season;
  readonly tone: Tone;
  readonly contrast: Contrast;
  /** `${season}_${tone}` — the funnel's single category identifier. */
  readonly category: DiagnosisCategory;
  readonly confidence: number;
  readonly toneConfidence: number;
  readonly contrastConfidence: number;
  readonly skinLuma: number;
  readonly hairLuma: number;
  readonly eyesLuma: number;
}

/**
 * Map the snake_case wire body to the client-facing camelCase value object,
 * deriving the `${season}_${tone}` category. Pure projection — no I/O of its
 * own; the network call is delegated to the injected {@link DiagnosisTransport}.
 */
export function mapDiagnosisWire(wire: DiagnosisWireResponse): DiagnosisResult {
  return {
    season: wire.season,
    tone: wire.tone,
    contrast: wire.contrast,
    category: `${wire.season}_${wire.tone}`,
    confidence: wire.confidence,
    toneConfidence: wire.tone_confidence,
    contrastConfidence: wire.contrast_confidence,
    skinLuma: wire.skin_luma,
    hairLuma: wire.hair_luma,
    eyesLuma: wire.eyes_luma,
  };
}

/**
 * The injectable network seam: perform the authenticated multipart
 * `POST /v1/diagnose` and resolve to its parsed wire body. Injected so the
 * `requestDiagnosis` mapper is testable without a real HTTP client, and so
 * the call site can wire a real `fetch` + `FormData`.
 */
export type DiagnosisTransport = () => Promise<DiagnosisWireResponse>;

/**
 * Map the wire body returned by an injected transport to a
 * {@link DiagnosisResult}. The transport owns the network + error surface;
 * this function owns only the pure projection so the two concerns stay
 * independently testable.
 *
 * @param transport - injectable seam performing the actual POST.
 * @returns the camelCase diagnosis result with derived category.
 */
export async function requestDiagnosis(
  transport: DiagnosisTransport,
): Promise<DiagnosisResult> {
  const wire = await transport();
  return mapDiagnosisWire(wire);
}

// ---------------------------------------------------------------------------
// Typed error surface
// ---------------------------------------------------------------------------

/**
 * Discriminated failure modes for `POST /v1/diagnose`, derived from the
 * server's `(status, detail)` error contract:
 *
 *   - `unauthorized`            — 401 `invalid_authorization` (missing/expired JWT).
 *   - `user_not_found`          — 403 `user_not_found` (valid token, deleted user).
 *   - `payload_too_large`       — 413 `payload_too_large` (selfie > 10 MiB).
 *   - `unsupported_media_type`  — 415 `unsupported_media_type` (not jpeg/png).
 *   - `face_not_detected`       — 422 `face_not_detected` (no face found — RECOVERABLE).
 *   - `invalid_selfie`          — 400 `invalid_selfie` (undecodable bytes).
 *   - `server_error`            — 500 `internal_error`.
 *   - `unknown`                 — any other / unmapped status.
 *
 * `face_not_detected` and `invalid_selfie` are the user-recoverable kinds
 * (re-take the selfie); the rest are surfaced as a generic failure.
 */
export type DiagnosisErrorKind =
  | 'unauthorized'
  | 'user_not_found'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'face_not_detected'
  | 'invalid_selfie'
  | 'server_error'
  | 'unknown';

/**
 * Map an HTTP status to its {@link DiagnosisErrorKind}. Status is the
 * authoritative discriminator (the server pins one detail string per status),
 * so we key on it rather than parsing the `detail` body.
 */
export function diagnosisErrorKindForStatus(status: number): DiagnosisErrorKind {
  switch (status) {
    case 401:
      return 'unauthorized';
    case 403:
      return 'user_not_found';
    case 413:
      return 'payload_too_large';
    case 415:
      return 'unsupported_media_type';
    case 422:
      return 'face_not_detected';
    case 400:
      return 'invalid_selfie';
    case 500:
      return 'server_error';
    default:
      return 'unknown';
  }
}

/**
 * Error thrown by {@link createDiagnosisTransport} on a non-2xx response.
 * Carries the discriminated {@link DiagnosisErrorKind} and the raw HTTP
 * status so callers can branch on a recoverable `face_not_detected` without
 * string-matching the message.
 */
export class DiagnosisRequestError extends Error {
  readonly kind: DiagnosisErrorKind;
  readonly status: number;

  constructor(kind: DiagnosisErrorKind, status: number) {
    super(`POST ${DIAGNOSE_PATH} failed with status ${status} (${kind})`);
    this.name = 'DiagnosisRequestError';
    this.kind = kind;
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Real transport factory
// ---------------------------------------------------------------------------

/** The relative path of the diagnose endpoint under the `/v1` prefix. */
export const DIAGNOSE_PATH = '/v1/diagnose' as const;

/** The multipart form field name the server reads the selfie from. */
export const DIAGNOSE_SELFIE_FIELD = 'selfie' as const;

/**
 * A selfie image to upload. The `uri` is a local `file://` path from
 * `expo-image-picker`; `name` and `mimeType` populate the multipart part's
 * filename and `Content-Type`. The server accepts only `image/jpeg` /
 * `image/png` (≤ 10 MiB) — supplying anything else yields a 415 / 413.
 */
export interface SelfieFile {
  readonly uri: string;
  readonly name: string;
  readonly mimeType: 'image/jpeg' | 'image/png';
}

/**
 * The minimal slice of the WHATWG `FormData` contract this module relies on,
 * declared locally so the factory is testable with a tiny stub (and does not
 * couple the test to a real `FormData` polyfill). React Native's `FormData`
 * accepts a `{ uri, name, type }` object as a file part — a non-standard but
 * universally-supported extension — hence the `unknown` value type.
 */
export interface FormDataLike {
  append(name: string, value: unknown): void;
}

/**
 * The minimal slice of the WHATWG `fetch` contract this module relies on for
 * the multipart POST. Declared locally so the factory is testable with a tiny
 * stub (and does not couple the test to RN's global `fetch` typing).
 */
export type DiagnoseFetchLike = (
  input: string,
  init: {
    readonly method: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly body: FormDataLike;
  },
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  json: () => Promise<unknown>;
}>;

/**
 * Configuration for {@link createDiagnosisTransport}.
 *
 * `selfie` is the image to upload; `accessToken` is the REQUIRED backend JWT
 * forwarded as a `Bearer` header; `baseUrl` defaults to {@link getApiBaseUrl};
 * `fetchImpl` / `formDataImpl` default to the runtime globals and are
 * overridable in tests.
 */
export interface DiagnosisTransportConfig {
  readonly selfie: SelfieFile;
  readonly accessToken: string;
  readonly baseUrl?: string;
  readonly fetchImpl?: DiagnoseFetchLike;
  readonly formDataImpl?: () => FormDataLike;
}

/**
 * Build a real `fetch` + `FormData`-backed {@link DiagnosisTransport} for
 * `POST /v1/diagnose`.
 *
 * The returned transport assembles a `multipart/form-data` body with the
 * selfie under the `selfie` field, attaches `Authorization: Bearer <token>`,
 * and POSTs it against `${baseUrl}${DIAGNOSE_PATH}`. On a non-2xx status it
 * throws a {@link DiagnosisRequestError} carrying the mapped
 * {@link DiagnosisErrorKind}; on success it resolves the parsed wire body.
 *
 * Note: we deliberately do NOT set a `Content-Type` header — `fetch` derives
 * the correct `multipart/form-data; boundary=...` value from the `FormData`
 * body, and overriding it would drop the boundary and break the upload.
 *
 * @param config - selfie / token / base URL / fetch+FormData overrides.
 * @returns a transport suitable for {@link requestDiagnosis}.
 */
export function createDiagnosisTransport(
  config: DiagnosisTransportConfig,
): DiagnosisTransport {
  const baseUrl = config.baseUrl ?? getApiBaseUrl();
  const fetchImpl =
    config.fetchImpl ?? (globalThis.fetch as unknown as DiagnoseFetchLike);
  const makeFormData: () => FormDataLike =
    config.formDataImpl ?? (() => new FormData());

  return async (): Promise<DiagnosisWireResponse> => {
    const form = makeFormData();
    form.append(DIAGNOSE_SELFIE_FIELD, {
      uri: config.selfie.uri,
      name: config.selfie.name,
      type: config.selfie.mimeType,
    });

    const response = await fetchImpl(`${baseUrl}${DIAGNOSE_PATH}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${config.accessToken}`,
      },
      body: form,
    });

    if (!response.ok) {
      throw new DiagnosisRequestError(
        diagnosisErrorKindForStatus(response.status),
        response.status,
      );
    }
    return (await response.json()) as DiagnosisWireResponse;
  };
}
