/**
 * Unit tests — `request-generation.ts` (AC2 mobile generation transport).
 *
 * Pure mapper + fetch/FormData factory are tested with injected stubs: no
 * live HTTP, no `expo-file-system`, no native modules. Covers the bytes →
 * data-URI projection, the retry-count header parsing, and the full
 * non-2xx → typed-error mapping.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  bytesToBase64,
  createGenerationTransport,
  GenerationRequestError,
  requestGeneration,
  type FormDataLike,
  type GenerationFetchLike,
  type GenerationFetchResponse,
  type GenerationWirePayload,
} from '../src/request-generation';
import type { SelfieFile } from '../src/request-diagnosis';

const _SELFIE: SelfieFile = {
  uri: 'file:///tmp/selfie.png',
  name: 'selfie.png',
  mimeType: 'image/png',
};

function _fakeResponse(opts: {
  ok: boolean;
  status: number;
  bytes?: Uint8Array;
  retryHeader?: string | null;
}): GenerationFetchResponse {
  return {
    ok: opts.ok,
    status: opts.status,
    headers: {
      get: (name: string) =>
        name === 'X-Generation-Retry-Count' ? (opts.retryHeader ?? null) : null,
    },
    arrayBuffer: async () => (opts.bytes ?? new Uint8Array()).buffer as ArrayBuffer,
  };
}

function _fakeFormData(): { form: FormDataLike; appended: Array<[string, unknown]> } {
  const appended: Array<[string, unknown]> = [];
  const form: FormDataLike = {
    append: (name: string, value: unknown) => {
      appended.push([name, value]);
    },
  } as unknown as FormDataLike;
  return { form, appended };
}

describe('bytesToBase64', () => {
  it('matches the standard padded base64 encoding', () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG signature head
    const expected = Buffer.from(bytes).toString('base64');
    expect(bytesToBase64(bytes)).toBe(expected);
  });

  it('pads correctly for 1- and 2-byte tails', () => {
    expect(bytesToBase64(new Uint8Array([0x41]))).toBe(
      Buffer.from([0x41]).toString('base64'),
    );
    expect(bytesToBase64(new Uint8Array([0x41, 0x42]))).toBe(
      Buffer.from([0x41, 0x42]).toString('base64'),
    );
  });
});

describe('requestGeneration (pure mapper)', () => {
  it('projects bytes into a PNG data URI and preserves retryCount', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    const transport = async (): Promise<GenerationWirePayload> => ({
      bytes,
      retryCount: 3,
    });
    const result = await requestGeneration(transport);
    expect(result.retryCount).toBe(3);
    expect(result.imageDataUri).toBe(
      `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`,
    );
  });

  it('throws generation_failed on an empty payload', async () => {
    const transport = async (): Promise<GenerationWirePayload> => ({
      bytes: new Uint8Array(),
      retryCount: 0,
    });
    await expect(requestGeneration(transport)).rejects.toMatchObject({
      kind: 'generation_failed',
    });
  });

  it('clamps a negative retryCount to 0', async () => {
    const transport = async (): Promise<GenerationWirePayload> => ({
      bytes: new Uint8Array([1, 2, 3]),
      retryCount: -1,
    });
    expect((await requestGeneration(transport)).retryCount).toBe(0);
  });
});

describe('createGenerationTransport (fetch + FormData factory)', () => {
  it('POSTs recipe_id + selfie with a Bearer token and parses the result', async () => {
    const { form, appended } = _fakeFormData();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const fetchImpl = vi.fn<
      Parameters<GenerationFetchLike>,
      ReturnType<GenerationFetchLike>
    >(async () => _fakeResponse({ ok: true, status: 200, bytes, retryHeader: '2' }));
    const transport = createGenerationTransport({
      recipeId: 'r-001',
      selfie: _SELFIE,
      token: 'tok-abc',
      baseUrl: 'https://api.test',
      fetchImpl,
      formDataImpl: () => form,
    });

    const payload = await transport();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = fetchImpl.mock.calls[0]!;
    const [url, init] = call;
    expect(url).toBe('https://api.test/v1/generate');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok-abc');
    // No hand-set Content-Type (multipart boundary is runtime-derived).
    expect(init.headers['Content-Type']).toBeUndefined();
    expect(appended).toContainEqual(['recipe_id', 'r-001']);
    expect(appended.find(([k]) => k === 'selfie')?.[1]).toMatchObject({
      uri: _SELFIE.uri,
      name: _SELFIE.name,
      type: _SELFIE.mimeType,
    });
    expect(Array.from(payload.bytes)).toEqual([1, 2, 3, 4]);
    expect(payload.retryCount).toBe(2);
  });

  it('defaults retryCount to 0 when the header is absent', async () => {
    const { form } = _fakeFormData();
    const transport = createGenerationTransport({
      recipeId: 'r-001',
      selfie: _SELFIE,
      token: 't',
      fetchImpl: async () =>
        _fakeResponse({
          ok: true,
          status: 200,
          bytes: new Uint8Array([9]),
          retryHeader: null,
        }),
      formDataImpl: () => form,
    });
    expect((await transport()).retryCount).toBe(0);
  });

  it.each([
    [401, 'unauthorized'],
    [404, 'recipe_not_found'],
    [502, 'generation_failed'],
    [503, 'generation_failed'],
    [418, 'unknown'],
  ])('maps HTTP %i to a typed error (%s)', async (statusCode, kind) => {
    const { form } = _fakeFormData();
    const transport = createGenerationTransport({
      recipeId: 'r-001',
      selfie: _SELFIE,
      token: 't',
      fetchImpl: async () => _fakeResponse({ ok: false, status: statusCode }),
      formDataImpl: () => form,
    });
    await expect(transport()).rejects.toMatchObject({ kind });
  });

  it('maps a thrown fetch (offline) to a network error', async () => {
    const { form } = _fakeFormData();
    const transport = createGenerationTransport({
      recipeId: 'r-001',
      selfie: _SELFIE,
      token: 't',
      fetchImpl: async () => {
        throw new Error('offline');
      },
      formDataImpl: () => form,
    });
    await expect(transport()).rejects.toBeInstanceOf(GenerationRequestError);
    await expect(transport()).rejects.toMatchObject({ kind: 'network' });
  });
});
