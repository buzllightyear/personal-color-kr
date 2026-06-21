/**
 * `save-to-camera-roll.ts` — persist a generated gallery image to the device
 * camera roll (Content Generation AC4).
 *
 * Flow:
 *   1. request the OS media-library write permission (Korean prompt strings
 *      declared in `app.config.ts`);
 *   2. if denied → resolve `{ kind: 'permission_denied' }`;
 *   3. download the **authenticated** gallery image to a cache file
 *      (the download forwards the `Authorization` header, so the server streams
 *      the watermarked PNG only to the owning user);
 *   4. save the downloaded file into the library via
 *      `MediaLibrary.saveToLibraryAsync`;
 *   5. resolve `{ kind: 'saved' }`, or `{ kind: 'failed' }` on any I/O error.
 *
 * Why dependency-injected:
 *   `expo-media-library` and `expo-file-system` are native modules — unavailable
 *   in the vitest node env (aliased to stubs in `vitest.config.ts`). Injecting
 *   the download + permission + save operations lets the orchestration be
 *   unit-tested deterministically without the native modules or an OS prompt.
 *
 * SDK 54 note:
 *   The default download uses the new `expo-file-system` `File` API
 *   (`File.downloadFileAsync` → cache `Directory`), which resolves to the
 *   package's published type declarations — unlike the `/legacy` entrypoint,
 *   whose TS source trips the repo's strict `exactOptionalPropertyTypes`.
 */
import { Directory, File, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';

import { galleryImageUrl } from './fetch-gallery';

/** Discriminated outcome of a camera-roll save attempt. */
export type SaveToCameraRollResult =
  | { readonly kind: 'saved' }
  | { readonly kind: 'permission_denied' }
  | { readonly kind: 'failed' };

/** Injectable native operations (default to the real expo modules). */
export interface CameraRollDeps {
  readonly requestPermission?: () => Promise<{ readonly granted: boolean }>;
  /**
   * Download an authenticated image to a local cache file and resolve its
   * `file://` URI. Throws on any download error (mapped to `failed`).
   */
  readonly downloadToCache?: (
    url: string,
    headers: Readonly<Record<string, string>>,
  ) => Promise<string>;
  readonly saveToLibrary?: (localUri: string) => Promise<void>;
}

/** Configuration for {@link saveGenerationToCameraRoll}. */
export interface SaveToCameraRollConfig {
  readonly generationId: string;
  readonly token: string;
  readonly baseUrl?: string;
}

/** Default download: fetch into the cache directory via the new File API. */
async function _defaultDownloadToCache(
  url: string,
  headers: Readonly<Record<string, string>>,
): Promise<string> {
  const file = await File.downloadFileAsync(url, new Directory(Paths.cache), {
    headers,
  });
  return file.uri;
}

/**
 * Download an owned gallery image and save it to the device camera roll.
 *
 * @param config - which generation to save + the auth token / base URL.
 * @param deps - optional native overrides (default to expo-media-library /
 *   expo-file-system).
 * @returns a discriminated {@link SaveToCameraRollResult} — never throws.
 */
export async function saveGenerationToCameraRoll(
  config: SaveToCameraRollConfig,
  deps: CameraRollDeps = {},
): Promise<SaveToCameraRollResult> {
  const requestPermission =
    deps.requestPermission ?? MediaLibrary.requestPermissionsAsync;
  const downloadToCache = deps.downloadToCache ?? _defaultDownloadToCache;
  const saveToLibrary = deps.saveToLibrary ?? MediaLibrary.saveToLibraryAsync;

  const permission = await requestPermission();
  if (!permission.granted) {
    return { kind: 'permission_denied' };
  }

  try {
    const url = galleryImageUrl(config.generationId, config.baseUrl);
    const localUri = await downloadToCache(url, {
      Authorization: `Bearer ${config.token}`,
    });
    await saveToLibrary(localUri);
    return { kind: 'saved' };
  } catch {
    return { kind: 'failed' };
  }
}
