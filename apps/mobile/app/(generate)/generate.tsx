/**
 * (generate)/generate — end-to-end generation route (AC2).
 *
 * Thin route file: owns all side-effects (selfie pick, auth token, transport
 * call, state machine) and wires the pure {@link GenerationScreen}.
 *
 * Responsibilities (this file only):
 *   1. Read the selected `recipeId` from the route params.
 *   2. On "generate": pick a fresh selfie (`pickSelfie`), resolve the auth
 *      token (`getAuthToken`), POST to `/v1/generate` via
 *      `createGenerationTransport` + `requestGeneration`, and drive the
 *      idle → loading → success / error state machine.
 *   3. The server owns the 30 s budget + reject/retry loop; the client simply
 *      awaits and renders the watermarked result (a data URI) or a typed error.
 *
 * What this file DOES NOT own:
 *   - Rendering / state copy — delegated to `GenerationScreen`.
 *   - Wire shapes / error mapping — defined in `src/request-generation.ts`.
 *   - Auth persistence — owned by `src/storage/auth-token-storage.ts`.
 */
import * as React from 'react';
import { useCallback, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';

import { getApiBaseUrl } from '../../src/config/api-base-url';
import { getAuthToken } from '../../src/config/auth-token';
import { pickSelfie } from '../../src/pick-selfie';
import {
  createGenerationTransport,
  GenerationRequestError,
  requestGeneration,
  type GenerationErrorKind,
} from '../../src/request-generation';
import {
  GenerationScreen,
  type GenerationStatus,
} from '../../src/screens/generate/GenerationScreen';

export default function GenerateRoute(): React.ReactElement {
  const params = useLocalSearchParams<{ recipeId?: string }>();
  const recipeId = typeof params.recipeId === 'string' ? params.recipeId : '';

  const [status, setStatus] = useState<GenerationStatus>('idle');
  const [imageDataUri, setImageDataUri] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<GenerationErrorKind | null>(null);

  const runGeneration = useCallback(async (): Promise<void> => {
    if (recipeId === '') {
      setErrorKind('recipe_not_found');
      setStatus('error');
      return;
    }

    const selfie = await pickSelfie();
    if (selfie === null) {
      // User cancelled / denied — stay on the idle CTA, no error.
      setStatus('idle');
      return;
    }

    setStatus('loading');
    setImageDataUri(null);
    setErrorKind(null);
    try {
      const token = await getAuthToken();
      const transport = createGenerationTransport({
        recipeId,
        selfie,
        token: token ?? '',
        baseUrl: getApiBaseUrl(),
      });
      const result = await requestGeneration(transport);
      setImageDataUri(result.imageDataUri);
      setStatus('success');
    } catch (err) {
      setErrorKind(err instanceof GenerationRequestError ? err.kind : 'unknown');
      setStatus('error');
    }
  }, [recipeId]);

  const handleGenerate = useCallback((): void => {
    void runGeneration();
  }, [runGeneration]);

  return (
    <GenerationScreen
      status={status}
      imageDataUri={imageDataUri}
      errorKind={errorKind}
      onGenerate={handleGenerate}
      onRetry={handleGenerate}
    />
  );
}
