/**
 * `FunnelPlaceholder` — shared dev-info render surface for the 12 funnel
 * placeholder screens (Phase 2.1 work unit).
 *
 * What this component exists to render:
 *   The seed spec for Phase 2.1 calls out a specific dev-info layout that
 *   every kebab placeholder must show until real screens land:
 *
 *     [Step N of 12]
 *     <screenId>
 *     route params dump (live)
 *     Next →   (linear navigation)
 *     guard stub status
 *     preview true/false
 *
 *   Centralising this in one component keeps the 12 placeholder files thin
 *   (`<FunnelPlaceholder stepId="welcome_hook" />` etc.) and means a dev-info
 *   UX change applies uniformly without a 12-file edit.
 *
 * What this component is NOT:
 *   - Real screen UI. Every placeholder is intentionally austere; styling
 *     beyond dev-info legibility lands in a subsequent unit.
 *   - A route-params parser. Callers pass the params (or `undefined`) as
 *     props — the placeholder only renders them; Zod validation lives in
 *     `packages/core-ts/funnel` so the server-side share/referral endpoints
 *     can reuse the same schemas.
 *   - A navigation router. The `Next →` button calls the optional `onNext`
 *     prop; the parent screen wires it to `router.push(...)` (or omits it
 *     when the screen is a terminal step like `payment-model`).
 *
 * Why the props are this shape:
 *   - `stepId` (snake_case): pinned to `FunnelStepId` so a typo at the call
 *     site fails the type check rather than silently rendering "Step ? of 12".
 *     The component derives `stepIndex` (1-based) and the kebab slug
 *     from this id alone.
 *   - `routeParams`: optional `Record<string, unknown>` rendered as JSON for
 *     dev visibility. Most screens pass `undefined`; only `welcome-hook`
 *     and `result-reveal` carry real params (and `result-reveal` also
 *     receives the derived `isPreviewMode`).
 *   - `isPreviewMode`: `result-reveal` specific. Other screens omit it and
 *     the row is hidden.
 *   - `guardStatus`: optional descriptor for screens whose render depends
 *     on a fail-loud guard stub (e.g. rating-gate, referral-gate). Other
 *     screens omit it.
 *
 * Frozen invariants:
 *   - `stepIndex` is always `FUNNEL_STEPS_ORDERED.indexOf(stepId) + 1`. The
 *     value is asserted by the sibling smoke-render test for all 12 ids.
 *   - The dev-info block uses stable `testID`s so the smoke test can pin
 *     each row without re-implementing the text-match logic.
 */
import * as React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

import { FUNNEL_STEPS_ORDERED, type FunnelStepId } from 'core-ts/funnel/types';

import { FUNNEL_KEBAB_SLUGS } from './linking.config';

export interface FunnelPlaceholderGuardStatus {
  readonly name: string;
  readonly value: boolean;
}

export interface FunnelPlaceholderProps {
  readonly stepId: FunnelStepId;
  readonly routeParams?: Readonly<Record<string, unknown>>;
  readonly isPreviewMode?: boolean;
  readonly guardStatus?: FunnelPlaceholderGuardStatus;
  readonly onNext?: () => void;
}

/**
 * Internal helper — pretty-print the route params as a compact JSON string,
 * or render the literal `(none)` so the smoke test has a stable visible
 * label even when the params are absent.  Renders one line per key so the
 * row stays readable on a phone-width screen.
 */
function formatRouteParams(
  params: Readonly<Record<string, unknown>> | undefined,
): string {
  if (!params || Object.keys(params).length === 0) return '(none)';
  return Object.entries(params)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join('\n');
}

export function FunnelPlaceholder(props: FunnelPlaceholderProps): JSX.Element {
  const { stepId, routeParams, isPreviewMode, guardStatus, onNext } = props;
  const stepIndex = FUNNEL_STEPS_ORDERED.indexOf(stepId) + 1;
  const kebab = FUNNEL_KEBAB_SLUGS[stepId];

  return (
    <View style={styles.container} testID="funnel-placeholder">
      <Text style={styles.stepCounter} testID="funnel-placeholder-step">
        {`Step ${stepIndex} of 12`}
      </Text>
      <Text style={styles.screenId} testID="funnel-placeholder-screen-id">
        {stepId}
      </Text>
      <Text style={styles.kebab} testID="funnel-placeholder-kebab">
        {`/${kebab}`}
      </Text>

      <View style={styles.devInfoBlock} testID="funnel-placeholder-dev-info">
        <Text style={styles.devLabel}>route params</Text>
        <Text style={styles.devValue} testID="funnel-placeholder-params-dump">
          {formatRouteParams(routeParams)}
        </Text>

        {typeof isPreviewMode === 'boolean' && (
          <>
            <Text style={styles.devLabel}>preview</Text>
            <Text style={styles.devValue} testID="funnel-placeholder-preview-flag">
              {String(isPreviewMode)}
            </Text>
          </>
        )}

        {guardStatus && (
          <>
            <Text style={styles.devLabel}>guard</Text>
            <Text style={styles.devValue} testID="funnel-placeholder-guard-status">
              {`${guardStatus.name} → ${String(guardStatus.value)} (stub)`}
            </Text>
          </>
        )}
      </View>

      {onNext && (
        <Pressable
          style={styles.nextButton}
          onPress={onNext}
          testID="funnel-placeholder-next"
        >
          <Text style={styles.nextButtonLabel}>Next →</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    gap: 8,
  },
  stepCounter: { fontSize: 14, opacity: 0.5, letterSpacing: 1 },
  screenId: { fontSize: 22, fontWeight: '600' },
  kebab: { fontSize: 12, opacity: 0.5, fontFamily: 'Menlo' },
  devInfoBlock: {
    marginTop: 24,
    padding: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.04)',
    alignSelf: 'stretch',
    gap: 4,
  },
  devLabel: {
    fontSize: 10,
    opacity: 0.5,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  devValue: { fontSize: 12, fontFamily: 'Menlo' },
  nextButton: {
    marginTop: 24,
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 999,
    backgroundColor: 'black',
  },
  nextButtonLabel: { color: 'white', fontWeight: '600' },
});
