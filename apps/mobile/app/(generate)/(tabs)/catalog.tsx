/**
 * (generate)/(tabs)/catalog — recipe catalog tab route.
 *
 * Thin route file: owns side-effects (network fetch, navigation) and wires
 * the presentational {@link RecipeCatalogScreen} with real data.
 *
 * Responsibilities (this file only):
 *   1. Resolve the auth token via `getAuthToken()` (Keychain → dev-seam
 *      fallback). A null/empty token produces a transport that will be
 *      rejected 401 by the server; the error state is surfaced to the
 *      screen so the user sees the Korean error message.
 *   2. Fetch the recipe catalog once on mount via `fetchRecipeCatalog` +
 *      `createRecipeCatalogTransport`. The fetch is cancellable via the
 *      `cancelled` flag so a component unmount mid-request does not attempt
 *      a state update on an unmounted component.
 *   3. Pass the resolved (recipes / loading / error) state to the pure
 *      `RecipeCatalogScreen` which renders without any side-effects.
 *   4. On recipe selection, navigate to the generation screen with the
 *      selected `recipeId` as a route parameter so the user's selfie +
 *      chosen recipe can be submitted to the fal.ai pipeline.
 *
 * What this file DOES NOT own:
 *   - Rendering — delegated to `RecipeCatalogScreen`.
 *   - Sort order — delegated to `RecipeCatalogScreen`.
 *   - Network shapes — defined in `src/fetch-recipe-catalog.ts`.
 *   - Auth persistence — owned by `src/storage/auth-token-storage.ts`.
 *
 * Navigation on selection:
 *   `router.push('/(generate)/generate?recipeId=...')` is the intent;
 *   the generation screen is implemented in a subsequent phase AC. The
 *   path is constructed as a string to avoid TypeScript type-checking on
 *   routes that do not yet exist in the file system.
 */
import * as React from 'react';
import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';

import {
  fetchRecipeCatalog,
  createRecipeCatalogTransport,
  type CatalogRecipe,
} from '../../../src/fetch-recipe-catalog';
import { getAuthToken } from '../../../src/config/auth-token';
import { getApiBaseUrl } from '../../../src/config/api-base-url';
import { clearTokenOnUnauthorized } from '../../../src/clear-token-on-unauthorized';
import { RecipeCatalogScreen } from '../../../src/screens/generate/RecipeCatalogScreen';

export default function CatalogTab(): React.ReactElement {
  const router = useRouter();
  const [recipes, setRecipes] = useState<readonly CatalogRecipe[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;

    void (async (): Promise<void> => {
      try {
        const token = await getAuthToken();
        const transport = createRecipeCatalogTransport({
          accessToken: token ?? '',
          baseUrl: getApiBaseUrl(),
        });
        const result = await fetchRecipeCatalog(transport);
        if (!cancelled) {
          setRecipes(result.recipes);
          setLoading(false);
        }
      } catch (err) {
        // Self-heal: a 401 means the stored token is invalid (expired / rotated
        // secret) — discard it so the step-7 gate re-shows on next mount and the
        // user re-authenticates, instead of being stuck on a permanent error.
        await clearTokenOnUnauthorized(err);
        if (!cancelled) {
          setError(true);
          setLoading(false);
        }
      }
    })();

    return (): void => {
      cancelled = true;
    };
    // Empty deps — fetch once on mount. A pull-to-refresh or manual refetch
    // will be added in a subsequent phase when the gallery tab lands.
  }, []);

  function handleSelectRecipe(recipeId: string): void {
    // Navigate to the generation screen with the selected recipe.
    // The generate route is implemented in a subsequent phase AC.
    const path = `/(generate)/generate?recipeId=${encodeURIComponent(recipeId)}`;
    router.push(path);
  }

  return (
    <RecipeCatalogScreen
      recipes={recipes}
      loading={loading}
      error={error}
      onSelectRecipe={handleSelectRecipe}
    />
  );
}
