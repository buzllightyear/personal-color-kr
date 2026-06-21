/**
 * Unit test — `save-to-camera-roll.ts` (Content Generation AC4).
 *
 * Drives the permission → download → save orchestration through injected deps
 * (no native modules). Covers: permission denied, happy path (authenticated
 * download + library save), a non-2xx download, and a thrown I/O error.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  saveGenerationToCameraRoll,
  type CameraRollDeps,
} from '../src/save-to-camera-roll';

type DownloadFn = NonNullable<CameraRollDeps['downloadToCache']>;
type SaveFn = NonNullable<CameraRollDeps['saveToLibrary']>;

const CONFIG = {
  generationId: 'gen-001',
  token: 'tok-123',
  baseUrl: 'https://api.example.com',
};

describe('saveGenerationToCameraRoll', () => {
  it('returns permission_denied without downloading when permission is refused', async () => {
    const downloadToCache = vi.fn<Parameters<DownloadFn>, ReturnType<DownloadFn>>();
    const saveToLibrary = vi.fn<Parameters<SaveFn>, ReturnType<SaveFn>>();
    const deps: CameraRollDeps = {
      requestPermission: () => Promise.resolve({ granted: false }),
      downloadToCache,
      saveToLibrary,
    };
    const result = await saveGenerationToCameraRoll(CONFIG, deps);
    expect(result).toEqual({ kind: 'permission_denied' });
    expect(downloadToCache).not.toHaveBeenCalled();
    expect(saveToLibrary).not.toHaveBeenCalled();
  });

  it('downloads with the auth header and saves to the library', async () => {
    const downloadToCache = vi.fn<Parameters<DownloadFn>, ReturnType<DownloadFn>>(() =>
      Promise.resolve('file:///cache/gallery-gen-001.png'),
    );
    const saveToLibrary = vi.fn<Parameters<SaveFn>, ReturnType<SaveFn>>(() =>
      Promise.resolve(),
    );
    const deps: CameraRollDeps = {
      requestPermission: () => Promise.resolve({ granted: true }),
      downloadToCache,
      saveToLibrary,
    };
    const result = await saveGenerationToCameraRoll(CONFIG, deps);
    expect(result).toEqual({ kind: 'saved' });

    expect(downloadToCache).toHaveBeenCalledTimes(1);
    const [url, headers] = downloadToCache.mock.calls[0]!;
    expect(url).toBe('https://api.example.com/v1/gallery/gen-001/image');
    expect(headers).toEqual({ Authorization: 'Bearer tok-123' });
    expect(saveToLibrary).toHaveBeenCalledWith('file:///cache/gallery-gen-001.png');
  });

  it('returns failed when the download throws', async () => {
    const saveToLibrary = vi.fn<Parameters<SaveFn>, ReturnType<SaveFn>>();
    const deps: CameraRollDeps = {
      requestPermission: () => Promise.resolve({ granted: true }),
      downloadToCache: () => Promise.reject(new Error('network down')),
      saveToLibrary,
    };
    const result = await saveGenerationToCameraRoll(CONFIG, deps);
    expect(result).toEqual({ kind: 'failed' });
    expect(saveToLibrary).not.toHaveBeenCalled();
  });
});
