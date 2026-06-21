/**
 * (generate)/(tabs)/gallery — user image gallery tab route.
 *
 * Thin route file: owns side-effects (auth token, gallery fetch, authenticated
 * image-source assembly, camera-roll save) and wires the pure
 * {@link GalleryScreen}.
 *
 * Responsibilities (this file only):
 *   1. Resolve the auth token via `getAuthToken()` (Keychain → dev-seam).
 *   2. Fetch the gallery once on mount via `fetchGallery` +
 *      `createGalleryTransport` (cancellable on unmount).
 *   3. Build each item's authenticated image source
 *      (`{ uri: galleryImageUrl(id), headers: { Authorization } }`) so the RN
 *      `Image` streams the watermarked PNG with the user's Bearer token.
 *   4. On "save", download + persist the image to the camera roll via
 *      `saveGenerationToCameraRoll`.
 *
 * What this file DOES NOT own:
 *   - Rendering — delegated to `GalleryScreen`.
 *   - Network/image shapes — defined in `src/fetch-gallery.ts`.
 *   - Native save flow — owned by `src/save-to-camera-roll.ts`.
 */
import * as React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { getApiBaseUrl } from '../../../src/config/api-base-url';
import { getAuthToken } from '../../../src/config/auth-token';
import {
  createGalleryTransport,
  fetchGallery,
  galleryImageUrl,
  type GalleryItem,
} from '../../../src/fetch-gallery';
import { saveGenerationToCameraRoll } from '../../../src/save-to-camera-roll';
import {
  GalleryScreen,
  type GalleryScreenItem,
} from '../../../src/screens/generate/GalleryScreen';

export default function GalleryTab(): React.ReactElement {
  const [items, setItems] = useState<readonly GalleryItem[]>([]);
  const [token, setToken] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;

    void (async (): Promise<void> => {
      try {
        const resolved = await getAuthToken();
        const accessToken = resolved ?? '';
        const transport = createGalleryTransport({
          accessToken,
          baseUrl: getApiBaseUrl(),
        });
        const result = await fetchGallery(transport);
        if (!cancelled) {
          setToken(accessToken);
          setItems(result.items);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setError(true);
          setLoading(false);
        }
      }
    })();

    return (): void => {
      cancelled = true;
    };
  }, []);

  const screenItems = useMemo<readonly GalleryScreenItem[]>(
    () =>
      items.map((item) => ({
        generationId: item.generationId,
        recipeId: item.recipeId,
        imageSource: {
          uri: galleryImageUrl(item.generationId, getApiBaseUrl()),
          headers: { Authorization: `Bearer ${token}` },
        },
      })),
    [items, token],
  );

  const handleSave = useCallback(
    (generationId: string): void => {
      void saveGenerationToCameraRoll({
        generationId,
        token,
        baseUrl: getApiBaseUrl(),
      });
    },
    [token],
  );

  return (
    <GalleryScreen
      items={screenItems}
      loading={loading}
      error={error}
      onSave={handleSave}
    />
  );
}
