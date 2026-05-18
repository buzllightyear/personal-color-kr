/**
 * Funnel placeholder — welcome_hook (Phase 2.1, step 1 of 12)
 *
 * The single external campaign-landing entry point. The seed contract
 * surfaces UTM bundle + referrer attribution as route params (utm_source,
 * utm_medium, utm_campaign, utm_term, utm_content, referrer_code,
 * referrer_channel). The placeholder forwards the live params verbatim
 * so the dev-info dump shows what the deep-link handler actually parsed
 * for the user's session.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';

import { FunnelPlaceholder } from '../../src/funnel-placeholder';

export default function WelcomeHookScreen(): JSX.Element {
  const router = useRouter();
  const params = useLocalSearchParams();
  return (
    <FunnelPlaceholder
      stepId="welcome_hook"
      routeParams={params as Record<string, unknown>}
      onNext={() => router.push('/(funnel)/value-props')}
    />
  );
}
