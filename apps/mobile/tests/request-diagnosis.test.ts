/**
 * Unit test — `request-diagnosis.ts` (real `POST /v1/diagnose` client).
 *
 * Three surfaces:
 *   1. `mapDiagnosisWire` / `requestDiagnosis` — map the snake_case wire body
 *      to the camelCase result and derive the `${season}_${tone}` category.
 *   2. `createDiagnosisTransport(config)` — the real `fetch` + `FormData`
 *      transport: POSTs multipart against `${baseUrl}/v1/diagnose`, attaches
 *      the Bearer token + selfie part, and throws a typed
 *      `DiagnosisRequestError` on non-2xx.
 *   3. `diagnosisErrorKindForStatus` — the status → kind mapping.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  createDiagnosisTransport,
  diagnosisErrorKindForStatus,
  DIAGNOSE_PATH,
  DIAGNOSE_SELFIE_FIELD,
  DiagnosisRequestError,
  mapDiagnosisWire,
  requestDiagnosis,
  type DiagnoseFetchLike,
  type DiagnosisWireResponse,
  type FormDataLike,
  type SelfieFile,
} from '../src/request-diagnosis';

const WIRE: DiagnosisWireResponse = {
  season: 'autumn',
  confidence: 0.91,
  tone: 'warm',
  contrast: 'high',
  tone_confidence: 0.88,
  contrast_confidence: 0.93,
  skin_luma: 0.65,
  hair_luma: 0.25,
  eyes_luma: 0.3,
};

const SELFIE: SelfieFile = {
  uri: 'file:///tmp/selfie.jpg',
  name: 'selfie.jpg',
  mimeType: 'image/jpeg',
};

function okResponse(body: unknown): ReturnType<DiagnoseFetchLike> {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  });
}

/** Minimal in-memory FormData spy capturing appended parts. */
function makeFormDataSpy(): FormDataLike & {
  readonly parts: Array<[string, unknown]>;
} {
  const parts: Array<[string, unknown]> = [];
  return {
    parts,
    append(name: string, value: unknown): void {
      parts.push([name, value]);
    },
  };
}

describe('mapDiagnosisWire / requestDiagnosis — wire → camel projection', () => {
  it('maps every field to camelCase and derives the category', async () => {
    const result = await requestDiagnosis(() => Promise.resolve(WIRE));
    expect(result).toEqual({
      season: 'autumn',
      tone: 'warm',
      contrast: 'high',
      category: 'autumn_warm',
      confidence: 0.91,
      toneConfidence: 0.88,
      contrastConfidence: 0.93,
      skinLuma: 0.65,
      hairLuma: 0.25,
      eyesLuma: 0.3,
    });
  });

  it('derives the `${season}_${tone}` category for each combination', () => {
    expect(mapDiagnosisWire({ ...WIRE, season: 'spring', tone: 'warm' }).category).toBe(
      'spring_warm',
    );
    expect(mapDiagnosisWire({ ...WIRE, season: 'summer', tone: 'cool' }).category).toBe(
      'summer_cool',
    );
    expect(mapDiagnosisWire({ ...WIRE, season: 'winter', tone: 'cool' }).category).toBe(
      'winter_cool',
    );
  });

  it('propagates a transport rejection to the caller', async () => {
    await expect(
      requestDiagnosis(() => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
  });
});

describe('createDiagnosisTransport — real fetch + FormData wiring', () => {
  it('POSTs the diagnose path against the configured base URL with the selfie part', async () => {
    const formData = makeFormDataSpy();
    const fetchImpl = vi.fn<
      Parameters<DiagnoseFetchLike>,
      ReturnType<DiagnoseFetchLike>
    >(() => okResponse(WIRE));
    const transport = createDiagnosisTransport({
      selfie: SELFIE,
      accessToken: 'jwt-token',
      baseUrl: 'https://api.example.com',
      fetchImpl,
      formDataImpl: () => formData,
    });

    const body = await transport();

    expect(body).toEqual(WIRE);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = fetchImpl.mock.calls[0];
    expect(call).toBeDefined();
    const [url, init] = call!;
    expect(url).toBe(`https://api.example.com${DIAGNOSE_PATH}`);
    expect(init.method).toBe('POST');
    // The selfie part is appended under the `selfie` field as an RN file object.
    expect(formData.parts).toEqual([
      [
        DIAGNOSE_SELFIE_FIELD,
        { uri: SELFIE.uri, name: SELFIE.name, type: SELFIE.mimeType },
      ],
    ]);
  });

  it('attaches the Bearer Authorization header and does NOT pin a Content-Type', async () => {
    const fetchImpl = vi.fn<
      Parameters<DiagnoseFetchLike>,
      ReturnType<DiagnoseFetchLike>
    >(() => okResponse(WIRE));
    const transport = createDiagnosisTransport({
      selfie: SELFIE,
      accessToken: 'jwt-token',
      baseUrl: 'https://api.example.com',
      fetchImpl,
      formDataImpl: () => makeFormDataSpy(),
    });
    await transport();
    const [, init] = fetchImpl.mock.calls[0]!;
    expect(init.headers?.Authorization).toBe('Bearer jwt-token');
    // fetch must derive `multipart/form-data; boundary=...` from the body —
    // pinning Content-Type here would drop the boundary and break the upload.
    expect(init.headers?.['Content-Type']).toBeUndefined();
  });

  it('throws a typed DiagnosisRequestError on a non-2xx response', async () => {
    const fetchImpl: DiagnoseFetchLike = () =>
      Promise.resolve({
        ok: false,
        status: 422,
        json: () => Promise.resolve({ detail: 'face_not_detected' }),
      });
    const transport = createDiagnosisTransport({
      selfie: SELFIE,
      accessToken: 'jwt-token',
      baseUrl: 'https://api.example.com',
      fetchImpl,
      formDataImpl: () => makeFormDataSpy(),
    });
    await expect(transport()).rejects.toMatchObject({
      name: 'DiagnosisRequestError',
      kind: 'face_not_detected',
      status: 422,
    });
    await expect(transport()).rejects.toBeInstanceOf(DiagnosisRequestError);
  });
});

describe('diagnosisErrorKindForStatus — status → kind mapping', () => {
  it('maps each documented status to its kind', () => {
    expect(diagnosisErrorKindForStatus(401)).toBe('unauthorized');
    expect(diagnosisErrorKindForStatus(403)).toBe('user_not_found');
    expect(diagnosisErrorKindForStatus(413)).toBe('payload_too_large');
    expect(diagnosisErrorKindForStatus(415)).toBe('unsupported_media_type');
    expect(diagnosisErrorKindForStatus(422)).toBe('face_not_detected');
    expect(diagnosisErrorKindForStatus(400)).toBe('invalid_selfie');
    expect(diagnosisErrorKindForStatus(500)).toBe('server_error');
  });

  it('falls back to `unknown` for an unmapped status', () => {
    expect(diagnosisErrorKindForStatus(418)).toBe('unknown');
    expect(diagnosisErrorKindForStatus(502)).toBe('unknown');
  });
});
