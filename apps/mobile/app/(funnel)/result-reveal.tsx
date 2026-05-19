/**
 * Route — funnel step 9 (`result_reveal`).
 *
 * Thin wrapper: expo-router hooks → derive isPreviewMode from share_token
 * route param (Phase 2.1 invariant preserved) → delegate to
 * `ResultRevealScreen` presentational component.
 *
 * Externally-allowed: reachable via `/s/<token>` and `/result-reveal` deep
 * links carrying `share_token`. When the token is present `isPreviewMode`
 * is true and the screen renders read-only (no "결과 잠금 해제" CTA). When
 * absent, the unlock CTA navigates to referral-gate (step 10).
 */
import * as React from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { ResultRevealScreen } from '../../src/screens/funnel/ResultRevealScreen';

export default function ResultRevealRoute(): JSX.Element {
  const router = useRouter();
  const params = useLocalSearchParams();
  const shareToken =
    typeof params['share_token'] === 'string' ? params['share_token'] : undefined;
  const isPreviewMode = shareToken !== undefined;
  return (
    <ResultRevealScreen
      isPreviewMode={isPreviewMode}
      onUnlock={() => router.push('/(funnel)/referral-gate')}
    />
  );
}
