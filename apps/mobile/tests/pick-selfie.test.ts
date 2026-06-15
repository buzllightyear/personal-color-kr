/**
 * Unit test — `pick-selfie.ts` (real device selfie capture mapper).
 *
 * The native `expo-image-picker` is aliased to an inert stub in
 * `vitest.config.ts`; here we drive `pickSelfie` through its injected
 * `requestPermission` / `launchLibrary` deps to pin the permission-deny,
 * cancel, and success → SelfieFile mappings deterministically.
 */
import { describe, expect, it, vi } from 'vitest';

import { pickSelfie, pickSelfieUri } from '../src/pick-selfie';

const GRANTED = { granted: true } as const;
const DENIED = { granted: false } as const;

function libraryResult(
  asset: { uri: string; fileName?: string | null; mimeType?: string } | null,
): {
  canceled: boolean;
  assets: ReadonlyArray<{ uri: string; fileName?: string | null; mimeType?: string }>;
} {
  if (asset === null) {
    return { canceled: true, assets: [] };
  }
  return { canceled: false, assets: [asset] };
}

describe('pickSelfie', () => {
  it('returns null when photo-library permission is denied (no picker launch)', async () => {
    const launchLibrary = vi.fn();
    const result = await pickSelfie({
      requestPermission: () => Promise.resolve(DENIED),
      launchLibrary,
    });
    expect(result).toBeNull();
    expect(launchLibrary).not.toHaveBeenCalled();
  });

  it('returns null when the user cancels the picker', async () => {
    const result = await pickSelfie({
      requestPermission: () => Promise.resolve(GRANTED),
      launchLibrary: () => Promise.resolve(libraryResult(null)),
    });
    expect(result).toBeNull();
  });

  it('maps a picked jpeg asset to a SelfieFile', async () => {
    const result = await pickSelfie({
      requestPermission: () => Promise.resolve(GRANTED),
      launchLibrary: () =>
        Promise.resolve(
          libraryResult({
            uri: 'file:///tmp/IMG_0001.jpg',
            fileName: 'IMG_0001.jpg',
            mimeType: 'image/jpeg',
          }),
        ),
    });
    expect(result).toEqual({
      uri: 'file:///tmp/IMG_0001.jpg',
      name: 'IMG_0001.jpg',
      mimeType: 'image/jpeg',
    });
  });

  it('preserves a png MIME type and default-names an asset with no fileName', async () => {
    const result = await pickSelfie({
      requestPermission: () => Promise.resolve(GRANTED),
      launchLibrary: () =>
        Promise.resolve(
          libraryResult({ uri: 'file:///tmp/abc.png', mimeType: 'image/png' }),
        ),
    });
    expect(result).toEqual({
      uri: 'file:///tmp/abc.png',
      name: 'selfie.png',
      mimeType: 'image/png',
    });
  });

  it('normalises an unknown/HEIC MIME type to jpeg', async () => {
    const result = await pickSelfie({
      requestPermission: () => Promise.resolve(GRANTED),
      launchLibrary: () =>
        Promise.resolve(
          libraryResult({ uri: 'file:///tmp/x.heic', mimeType: 'image/heic' }),
        ),
    });
    expect(result?.mimeType).toBe('image/jpeg');
    expect(result?.name).toBe('selfie.jpg');
  });
});

describe('pickSelfieUri', () => {
  it('returns just the uri string on success', async () => {
    const uri = await pickSelfieUri({
      requestPermission: () => Promise.resolve(GRANTED),
      launchLibrary: () => Promise.resolve(libraryResult({ uri: 'file:///tmp/s.jpg' })),
    });
    expect(uri).toBe('file:///tmp/s.jpg');
  });

  it('returns null on deny/cancel', async () => {
    const uri = await pickSelfieUri({
      requestPermission: () => Promise.resolve(DENIED),
      launchLibrary: () => Promise.resolve(libraryResult(null)),
    });
    expect(uri).toBeNull();
  });
});
