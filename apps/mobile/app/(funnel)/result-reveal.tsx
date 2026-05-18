/**
 * Funnel placeholder — result_reveal (Phase 2.1, step 9 of 12)
 *
 * Externally-allowed: reachable via `/s/<token>` and `/result-reveal`
 * deep links carrying `share_token`. When the token is present the
 * screen activates `isPreviewMode` and renders a read-only preview
 * placeholder (a recipient-view branch) — Sub-AC 12.
 *
 * Real preview UI lands in a subsequent unit. For now the dev-info
 * row surfaces the `preview` boolean so the smoke test can pin both
 * branches at the placeholder layer.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';

import { FunnelPlaceholder } from '../../src/funnel-placeholder';

export default function ResultRevealScreen(): JSX.Element {
  const router = useRouter();
  const params = useLocalSearchParams();
  const shareToken = typeof params['share_token'] === 'string' ? params['share_token'] : undefined;
  const isPreviewMode = shareToken !== undefined;
  if (isPreviewMode) {
    return (
      <FunnelPlaceholder
        stepId="result_reveal"
        routeParams={params as Record<string, unknown>}
        isPreviewMode
      />
    );
  }
  return (
    <FunnelPlaceholder
      stepId="result_reveal"
      routeParams={params as Record<string, unknown>}
      isPreviewMode={false}
      onNext={() => router.push('/(funnel)/referral-gate')}
    />
  );
}
