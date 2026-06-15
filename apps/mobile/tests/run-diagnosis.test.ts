/**
 * Unit test — `run-diagnosis.ts` (diagnosis orchestration + slice lifecycle).
 *
 * Two surfaces:
 *   1. `selfieFileFromUri` — the guard that decides whether the real call may
 *      fire (real `file://` selfie) or must degrade to the static teaser
 *      (`null` / `stub://`).
 *   2. `runDiagnosis` — drives the `diagnosis` slice through
 *      `pending → success` and `pending → error` (with the discriminated kind)
 *      without ever throwing.
 */
import { describe, expect, it, vi } from 'vitest';

import { runDiagnosis, selfieFileFromUri } from '../src/run-diagnosis';
import {
  DiagnosisRequestError,
  type DiagnosisResult,
  type SelfieFile,
} from '../src/request-diagnosis';
import type { FunnelDiagnosisPatch } from '../src/contracts/funnel-state';

const RESULT: DiagnosisResult = {
  season: 'autumn',
  tone: 'warm',
  contrast: 'high',
  category: 'autumn_warm',
  confidence: 0.9,
  toneConfidence: 0.9,
  contrastConfidence: 0.9,
  skinLuma: 0.6,
  hairLuma: 0.2,
  eyesLuma: 0.3,
};

const SELFIE: SelfieFile = {
  uri: 'file:///tmp/selfie.jpg',
  name: 'selfie.jpg',
  mimeType: 'image/jpeg',
};

describe('selfieFileFromUri', () => {
  it('returns null for a null URI (nothing captured)', () => {
    expect(selfieFileFromUri(null)).toBeNull();
  });

  it('returns null for a stub:// placeholder URI (not uploadable)', () => {
    expect(selfieFileFromUri('stub://selfie/12345')).toBeNull();
  });

  it('builds a jpeg SelfieFile for a file:// .jpg URI', () => {
    expect(selfieFileFromUri('file:///tmp/abc.jpg')).toEqual({
      uri: 'file:///tmp/abc.jpg',
      name: 'selfie.jpg',
      mimeType: 'image/jpeg',
    });
  });

  it('builds a png SelfieFile for a file:// .png URI', () => {
    expect(selfieFileFromUri('file:///tmp/abc.PNG')).toEqual({
      uri: 'file:///tmp/abc.PNG',
      name: 'selfie.png',
      mimeType: 'image/png',
    });
  });
});

describe('runDiagnosis — slice lifecycle', () => {
  it('drives pending → success on a resolved request', async () => {
    const patches: FunnelDiagnosisPatch[] = [];
    const setDiagnosis = (patch: FunnelDiagnosisPatch): void => {
      patches.push(patch);
    };
    await runDiagnosis(
      { selfie: SELFIE, accessToken: 'jwt', setDiagnosis },
      { requestImpl: () => Promise.resolve(RESULT) },
    );
    expect(patches).toEqual([
      { status: 'pending', errorKind: null },
      { status: 'success', result: RESULT, errorKind: null },
    ]);
  });

  it('forwards the selfie + token + baseUrl to the injected request', async () => {
    const requestImpl = vi.fn(() => Promise.resolve(RESULT));
    await runDiagnosis(
      {
        selfie: SELFIE,
        accessToken: 'jwt',
        setDiagnosis: () => undefined,
        baseUrl: 'https://x',
      },
      { requestImpl },
    );
    expect(requestImpl).toHaveBeenCalledWith(SELFIE, 'jwt', 'https://x');
  });

  it('drives pending → error with the discriminated kind on a DiagnosisRequestError', async () => {
    const patches: FunnelDiagnosisPatch[] = [];
    const setDiagnosis = (patch: FunnelDiagnosisPatch): void => {
      patches.push(patch);
    };
    await runDiagnosis(
      { selfie: SELFIE, accessToken: 'jwt', setDiagnosis },
      {
        requestImpl: () =>
          Promise.reject(new DiagnosisRequestError('face_not_detected', 422)),
      },
    );
    expect(patches).toEqual([
      { status: 'pending', errorKind: null },
      { status: 'error', errorKind: 'face_not_detected' },
    ]);
  });

  it('maps a non-DiagnosisRequestError (e.g. network drop) to kind=unknown', async () => {
    const patches: FunnelDiagnosisPatch[] = [];
    const setDiagnosis = (patch: FunnelDiagnosisPatch): void => {
      patches.push(patch);
    };
    await runDiagnosis(
      { selfie: SELFIE, accessToken: 'jwt', setDiagnosis },
      { requestImpl: () => Promise.reject(new Error('Network request failed')) },
    );
    expect(patches[1]).toEqual({ status: 'error', errorKind: 'unknown' });
  });

  it('never rejects — failures are captured into the slice', async () => {
    await expect(
      runDiagnosis(
        { selfie: SELFIE, accessToken: 'jwt', setDiagnosis: () => undefined },
        { requestImpl: () => Promise.reject(new Error('boom')) },
      ),
    ).resolves.toBeUndefined();
  });
});
