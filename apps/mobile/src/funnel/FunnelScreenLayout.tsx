/**
 * `FunnelScreenLayout` — shared frame component for every funnel screen
 * (welcome_hook → fake_loader and any later step that lands under
 * `app/(funnel)/`).
 *
 * Responsibilities (AC 8):
 *   1. **SafeAreaView** — wrap the screen body in
 *      `react-native-safe-area-context`'s `SafeAreaView` so the layout respects
 *      the notch / dynamic island on iOS and the status-bar height on Android.
 *      The shared layout is the *single* place this concern is handled, so
 *      individual screen components do not need to re-implement the inset
 *      math — they simply hand their content to `<FunnelScreenLayout>` and
 *      forget about device chrome.
 *   2. **Common padding / spacing** — apply the project's horizontal and
 *      vertical content insets pulled directly from the `SPACING` design
 *      tokens (`SPACING.lg = 24` horizontal, `SPACING.xl = 32` vertical).
 *      These values are the calibration the Phase 2.3 designs were drawn at
 *      and are the same constants every screen StyleSheet block consumes for
 *      its own internal spacing, so the layout's edge-padding never drifts
 *      from the screen's internal rhythm.
 *   3. **Background colour token** — paint the entire safe-area surface with
 *      `COLORS.grayscale.background` (pure white). Centralising this means
 *      a future "soft pink hero" variant only needs to change one prop on the
 *      layout, not five screen-local backgrounds. The Seed constraint pins
 *      the project to light mode only, so the background colour is a constant
 *      (not a theme-switch lookup).
 *
 * Why a thin frame component (not a full layout DSL):
 *   - The Seed exit condition `codebase_pattern_consistency` calls out the
 *     "thin route wrapper" pattern: route files delegate to a presentational
 *     component, presentational components delegate to shared primitives.
 *     `FunnelScreenLayout` is the *outermost* shared primitive — every
 *     screen-specific concern (cards, segmented controls, loaders) is layered
 *     INSIDE the layout, not configured by it.
 *   - A "layout DSL" with slots for header / body / footer would push the
 *     screens to compose against a rigid contract, but the five MVP screens
 *     have visibly different vertical compositions (welcome_hook centres a
 *     hero, value_props is a scroll stack, fake_loader is a centred spinner).
 *     A single `children` prop preserves the freedom each screen needs while
 *     still hoisting the SafeAreaView + padding + background concerns.
 *
 * Why `react-native-safe-area-context` (and not RN's built-in `SafeAreaView`):
 *   - RN's `SafeAreaView` only respects iOS insets and silently no-ops on
 *     Android. The community library reads the live insets from the platform
 *     (via the `SafeAreaProvider` that expo-router mounts at app root by
 *     default) on BOTH platforms — and is already a dependency of the
 *     project (`apps/mobile/package.json` pins `4.10.5`).
 *   - Zero new dependencies satisfies the Seed exit condition
 *     `zero_new_dependencies` (we are using a package already in the manifest).
 *
 * Why expose `accessibilityLabel` + `testID` as optional props:
 *   - Per-screen tests need a stable hook to query the layout root (e.g.
 *     "the welcome_hook root has accessibilityLabel '환영합니다'"). Defaulting
 *     `testID` to the literal `'funnel-screen-layout'` covers the common
 *     case (smoke render tests for any screen) while letting individual
 *     screens override with their own kebab-prefixed value when they want
 *     to distinguish themselves in a multi-component tree.
 *   - Both props are *optional* — passing nothing renders a layout with no
 *     accessibility decoration, which is the right default for the shared
 *     frame (the meaningful accessibility content lives inside `children`).
 *
 * Why `style` override is intentionally absent:
 *   - The whole point of this component is to *normalise* the edge padding
 *     and background colour across screens. Exposing a `style` prop would
 *     let a screen silently break the shared rhythm and the exit condition
 *     `design_tokens_complete` ("tokens are consumed by all 5 screen
 *     StyleSheet definitions"). If a future screen genuinely needs a
 *     different frame (e.g. a full-bleed hero with no padding), the right
 *     answer is to introduce a *named variant* prop on this layout (e.g.
 *     `variant: 'default' | 'full-bleed'`) so the divergence is auditable
 *     in one place.
 *
 * Out of scope (deferred):
 *   - No safe-area `edges` prop yet — the default `['top', 'right', 'bottom',
 *     'left']` covers every MVP funnel screen. A later modal step
 *     (rating-gate) renders inside an expo-router modal which itself owns
 *     the bottom-sheet inset, so when that screen lands we can either add an
 *     `edges` prop or have the modal wrapper handle its own insets.
 *   - No status bar styling — handled by `<StatusBar />` at the root layout
 *     so it stays consistent across the whole app.
 */
import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { COLORS, SPACING } from '../theme';

/**
 * Props for {@link FunnelScreenLayout}. The contract is intentionally minimal:
 * the layout only needs the screen body (`children`) and two optional
 * accessibility / testing hooks. All visual decisions (padding, background)
 * are baked into the component so screens cannot drift from the shared rhythm.
 */
export interface FunnelScreenLayoutProps {
  /**
   * Screen body. Render the entire content of a funnel step inside this
   * prop; the layout supplies SafeAreaView insets and shared edge padding
   * so the screen body can focus purely on its own composition (hero,
   * card stack, loader, etc.).
   */
  readonly children: React.ReactNode;
  /**
   * Override the default `testID` (`'funnel-screen-layout'`). Screens that
   * want to distinguish themselves in a multi-component tree (or in a tree
   * with multiple FunnelScreenLayout instances during transitions) should
   * pass a kebab-prefixed id matching their screen name, e.g.
   * `'welcome-hook-screen'`.
   *
   * Optional — most screens use the default and rely on inner element
   * testIDs (e.g. `'welcome-hook-cta'`) for their assertions.
   */
  readonly testID?: string;
  /**
   * Optional Korean-language accessibility label for the layout root. When
   * provided, screen-reader users hear this text when they focus the screen
   * container. Individual interactive elements inside `children` retain
   * their own `accessibilityLabel`s independently of this prop.
   */
  readonly accessibilityLabel?: string;
}

/**
 * Default `testID` constant — exported so unit tests can query the default
 * layout root without re-stringing the literal. Screens that override with
 * a custom `testID` simply pass their own value to the component.
 */
export const FUNNEL_SCREEN_LAYOUT_TEST_ID = 'funnel-screen-layout';

/**
 * Shared frame for every funnel screen. Wraps `children` in a SafeAreaView
 * with the project's standard edge padding and the white background token.
 *
 * Mount this component as the *outermost* element of every screen
 * presentational file under `apps/mobile/src/funnel/` (or any future
 * presentational module for a funnel route).
 *
 * @example
 *   import { FunnelScreenLayout } from '../funnel/FunnelScreenLayout';
 *
 *   export function WelcomeHookScreen({ onNext }: { onNext: () => void }) {
 *     return (
 *       <FunnelScreenLayout accessibilityLabel="환영합니다">
 *         <FunnelHeadline headline="..." subhead="..." />
 *         <FunnelPrimaryButton label="시작하기" onPress={onNext} />
 *       </FunnelScreenLayout>
 *     );
 *   }
 */
export function FunnelScreenLayout(
  props: FunnelScreenLayoutProps,
): React.ReactElement {
  const {
    children,
    testID = FUNNEL_SCREEN_LAYOUT_TEST_ID,
    accessibilityLabel,
  } = props;

  // `SafeAreaView` from react-native-safe-area-context supplies the inset
  // padding (notch / status bar / home indicator). We layer a plain `View`
  // inside it to apply the shared content padding so the inset math and the
  // content padding compose additively rather than fighting each other for
  // the same padding prop.
  return (
    <SafeAreaView
      style={styles.safeArea}
      testID={testID}
      {...(accessibilityLabel !== undefined ? { accessibilityLabel } : {})}
    >
      <View style={styles.content} testID={`${testID}-content`}>
        {children}
      </View>
    </SafeAreaView>
  );
}

/**
 * StyleSheet for the layout. Two layers:
 *   - `safeArea`   — flex-1 fill, white background token. Painting the
 *     background here (not on the inner `content` view) means the device
 *     chrome insets at the top/bottom inherit the same colour as the
 *     content area, so a status-bar swipe-down never reveals a
 *     translucent gap.
 *   - `content`    — flex-1 fill, horizontal `SPACING.lg = 24` and vertical
 *     `SPACING.xl = 32` padding. These are the calibrated edge insets for
 *     Phase 2.3 screens — wide enough to give a hero headline breathing
 *     room on a 4-inch+ phone, tight enough to land within Korean
 *     readability heuristics for 한글 line widths.
 */
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.grayscale.background,
  },
  content: {
    flex: 1,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.xl,
  },
});
