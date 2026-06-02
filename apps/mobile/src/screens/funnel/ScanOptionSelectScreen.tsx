/**
 * Funnel step 6 — `scan_option_select` presentational screen.
 *
 * Three vertically stacked scan options sourced from
 * `FUNNEL_SCREENS.scan_option_select.ctas`:
 *
 *   1. Primary scan — `퍼스널 컬러 진단` (action=`select_scan_personal_color`).
 *      The single enabled option for Phase 2.3 — selecting it advances to
 *      step 7 (`diagnosis_input`).
 *   2. Secondary scan slot 2 — `두번째 스캔 (곧 오픈)` — disabled placeholder
 *      surfaced as "Phase-N TBD" per the FUNNEL_SCREENS metadata.
 *   3. Secondary scan slot 3 — `세번째 스캔 (곧 오픈)` — disabled placeholder.
 *
 * The Korean copy and the "곧 오픈" affordance live in `core-ts/funnel/screens.ts`
 * (single source of truth for Korean variant funnel copy). This screen only
 * decides the visual treatment — and that visual rule itself now lives in
 * the dedicated `<ScanOptionItem />` leaf component (Sub-AC 3.2). The screen's
 * job here is reduced to the option *layout* (vertical stack with the
 * `getScanOptions()` ordering) plus dispatching the primary `onPress` callback
 * down to the enabled card. The enabled-vs-disabled colouring, "곧 오픈"
 * badge, and a11y state branching all live inside `ScanOptionItem` and are
 * unit-tested there in isolation.
 *
 * Pattern parity with Phase 2.2 screens:
 *   - Pure props-in / callbacks-out. The route wrapper resolves
 *     `useRouter().push(...)` and hands the navigation callback in via
 *     `onSelectPersonalColor`. Tests synthesise the prop without any
 *     expo-router context.
 *   - All Korean labels sourced from FUNNEL_SCREENS — no string literals
 *     duplicated at the call-site.
 */
import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import { FUNNEL_SCREENS } from 'core-ts/funnel';

import { FunnelHeadline } from '../../components/FunnelHeadline';
import { ScanOptionItem } from '../../components/funnel/ScanOptionItem';
import { FunnelScreenLayout } from '../../funnel/FunnelScreenLayout';
import { getScanOptions } from '../../funnel/scan-options';
import { SPACING } from '../../theme';

export interface ScanOptionSelectScreenProps {
  /**
   * Invoked when the user selects the primary scan (`퍼스널 컬러 진단`).
   * Parent route wires this to
   * `router.push('/(funnel)/diagnosis-input')` — the only path the v0.2
   * funnel currently models. The two disabled secondary options never
   * trigger this callback.
   */
  readonly onSelectPersonalColor: () => void;
}

const SCREEN = FUNNEL_SCREENS.scan_option_select;

/**
 * Resolved at module load so any drift between
 * `FUNNEL_SCREENS.scan_option_select.metadata.optionCount` and the CTA
 * list throws synchronously (and breaks the build) instead of producing
 * a half-rendered screen. The selector itself lives in
 * `src/funnel/scan-options.ts` so it can be unit-tested in isolation
 * (see `tests/scan-options.test.ts`).
 */
const SCAN_OPTIONS = getScanOptions();

/**
 * No-op press handler passed to the two disabled cards. The Pressable on
 * a disabled card receives `disabled={true}` and an `onPress` of
 * `undefined` inside `<ScanOptionItem />`, so this no-op is never invoked
 * at runtime — but the `ScanOptionItem` prop typing requires *some*
 * callback. Keeping the no-op hoisted (rather than re-instantiating it
 * inside the render loop) avoids needlessly invalidating the
 * Pressable's memoisation between renders.
 */
const NO_OP_PRESS = (): void => undefined;

export function ScanOptionSelectScreen(
  props: ScanOptionSelectScreenProps,
): React.ReactElement {
  const { onSelectPersonalColor } = props;

  return (
    <FunnelScreenLayout
      testID="scan-option-select-screen"
      accessibilityLabel="스캔 옵션 선택"
    >
      <FunnelHeadline
        headline={SCREEN.headline}
        subhead={SCREEN.subhead}
        testIDPrefix="scan-option-select"
      />
      <View style={styles.optionStack} testID="scan-option-select-option-list">
        {SCAN_OPTIONS.map((option) => (
          <ScanOptionItem
            key={option.key}
            option={option}
            onPress={option.enabled ? onSelectPersonalColor : NO_OP_PRESS}
            testIDPrefix="scan-option-select"
          />
        ))}
      </View>
    </FunnelScreenLayout>
  );
}

const styles = StyleSheet.create({
  optionStack: {
    flex: 1,
    gap: SPACING.md,
    paddingTop: SPACING.xl,
  },
});
