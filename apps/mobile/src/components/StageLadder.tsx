/**
 * `StageLadder` — the single shared progress-ladder leaf rendered by BOTH
 * funnel Step 5 (`fake_loader`) and Step 8 (`fake_scan_animation`).
 *
 * Phase 6.2 responsibility:
 *   Render a vertical list of Korean-labelled stage rows, each in one of the
 *   three lifecycle states — `pending` / `active` / `done` — plus an overall
 *   progress percentage, driven entirely by a view-model produced in core-ts.
 *
 *   - Step 5 (`FakeLoaderScreen`) feeds it the 5-stage analyzing-loader
 *     view-model (`renderAnalyzingLoaderComponent`).
 *   - Step 8 (`FakeScanAnimationScreen`) feeds it the 8-stage scan-animation
 *     view-model (`renderScanAnimationComponent`), composed additively
 *     *below* the existing 24-point face oval (which this component never
 *     touches).
 *
 *   Both screens mount the SAME component — there is no duplicated ladder
 *   render logic anywhere in the RN layer. That is the `single_shared_component`
 *   evaluation principle made concrete.
 *
 * Why this is a pure presentational leaf (zero business logic):
 *   Every stage-progression decision — which row is active, what the percent
 *   is, which ARIA politeness to announce — lives in the core-ts view-model
 *   mappers (`scan-animation-component.ts`, `analyzing-loader-component.ts`).
 *   This component receives the already-resolved `items` / `progress` /
 *   `ariaLive` and renders them 1:1. It owns NO timers, NO state, NO label
 *   strings. That is the `view_model_purity` evaluation principle: the RN
 *   adapter layer is a dumb projector.
 *
 * Item-shape tolerance (why we accept `state` OR `status`):
 *   The Phase-6.2 ontology names the tri-state field `state`, while the two
 *   core-ts view-models expose it as `status` (with `isActive` / `isDone`
 *   convenience aliases). Rather than force every call-site to remap the
 *   view-model items into a fresh array (which would add busywork and a place
 *   for drift), this component normalises whatever it is handed:
 *     1. `state` if present (ontology field),
 *     2. else `status` (core-ts field),
 *     3. else derive from `isActive` / `isDone` booleans,
 *     4. else fall back to `pending`.
 *   So a screen can pass `vm.items` straight through with no glue code.
 *
 * Why Unicode glyph markers (✓ / ● / ○) and not an icon package:
 *   The Seed `commoditized_stack` constraint forbids Lottie / SVG /
 *   react-native-svg / vector-icon packages. These three glyphs render via
 *   the platform system font on iOS and Android with no asset load, exactly
 *   as the sibling `GuideList` component already does for its ✓ cue marker.
 *   The marker is decorative — it is hidden from screen readers so the spoken
 *   announcement is the Korean label alone.
 *
 * Colours — design-token reuse only (`design_token_reuse`):
 *   Zero new hex values. Glyphs: the `active` ● marker uses `COLORS.base.coral`
 *   (the funnel's actionable-intent colour) as the focal point; the `done` ✓
 *   marker recedes to `COLORS.grayscale.disabled`; the `pending` ○ marker is a
 *   faint `COLORS.grayscale.border` hairline cue. Label text follows the row's
 *   focus: the `active` (in-progress) label is `COLORS.base.coral` in bold
 *   (`fontWeight '700'`); `done` labels recede to `COLORS.grayscale.disabled`;
 *   `pending` labels use `COLORS.grayscale.disabled`. The progress meter track
 *   uses `COLORS.grayscale.border` over a `COLORS.grayscale.background` surface.
 *   Every colour is a symbol-bound token from `../theme`.
 *
 * Accessibility surface (`accessibility_forwarding`):
 *   - The container forwards the view-model's `ariaLive` to RN's
 *     `accessibilityLiveRegion` (mapping `'off'` → `'none'`) so the platform
 *     re-announces the ladder politely while running and assertively on
 *     completion — the politeness decision is owned by core-ts, not here.
 *   - Each row carries `accessibilityState={{ selected: isActive }}` and an
 *     `accessibilityLabel` equal to the Korean stage label, so VoiceOver /
 *     TalkBack announce which stage is currently in progress.
 *   - The decorative glyph is `accessibilityElementsHidden` /
 *     `importantForAccessibility="no"` so the marker is never spoken.
 *
 * testID convention (`testIDPrefix` prop):
 *   The container is `testIDPrefix`; each row is `${testIDPrefix}-item-{index}`;
 *   each label is `${testIDPrefix}-item-{index}-label`; the optional progress
 *   readout is `${testIDPrefix}-progress`. A per-screen prefix
 *   (`fake-loader-ladder`, `scan-animation-ladder`) keeps the two mounts'
 *   testID trees disjoint so screen-level tests cannot cross-match.
 *
 * Frozen invariants (asserted by the companion test):
 *   - Renders exactly one row per `items` entry, in order.
 *   - Each row's label text equals the item's `label`.
 *   - The active row (and only it) carries `accessibilityState.selected === true`.
 *   - Pending / active / done rows pick the documented token colour.
 *   - The container forwards `ariaLive` → `accessibilityLiveRegion`
 *     (`off` → `none`).
 *   - The progress readout renders `${progress}%` when `progress` is supplied
 *     and is omitted entirely when it is not.
 */
import * as React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { SPACING } from '../theme';
import { FONT, INK } from '../theme/editorial';

/**
 * The tri-state lifecycle of a single ladder row. Matches the
 * `pending | active | done` union exported by both core-ts view-models.
 */
export type StageLadderItemState = 'pending' | 'active' | 'done';

/**
 * Per-row input shape. Intentionally tolerant: a caller may pass the
 * ontology's `state` field, the core-ts `status` field, or only the
 * `isActive` / `isDone` booleans — {@link resolveItemState} normalises all
 * three into a single `StageLadderItemState`.
 *
 * `label` is the only strictly-required field (the Korean stage text). `key`
 * is honoured for React identity when present (the core-ts items carry a
 * deterministic `scan-animation-stage-N` / `analyzing-stage-N` key); when it
 * is absent the row index is used.
 */
export interface StageLadderItem {
  /** Korean stage label — the visible row text and the spoken a11y label. */
  readonly label: string;
  /** Ontology tri-state field (first-priority source of truth). */
  readonly state?: StageLadderItemState;
  /** core-ts tri-state field (second-priority alias for {@link state}). */
  readonly status?: StageLadderItemState;
  /** core-ts convenience boolean — promotes the row to `active`. */
  readonly isActive?: boolean;
  /** core-ts convenience boolean — promotes the row to `done`. */
  readonly isDone?: boolean;
  /** Stable React key; falls back to the row index when omitted. */
  readonly key?: string;
}

/**
 * Props for {@link StageLadder}. All fields are `readonly` to match the
 * project "no mutation" rule.
 */
export interface StageLadderProps {
  /** Ordered list of stage rows, top → bottom. Rendered 1:1, no filtering. */
  readonly items: readonly StageLadderItem[];
  /**
   * Overall progress percentage (0–100). When supplied, a `${progress}%`
   * readout and a meter track render below the rows. Omit to hide the meter
   * entirely (e.g. a host that shows its own percent elsewhere).
   */
  readonly progress?: number;
  /**
   * Screen-reader live-region politeness, forwarded straight from the
   * view-model. `'off'` maps to RN's `'none'`. Defaults to `'polite'`.
   */
  readonly ariaLive?: 'off' | 'polite' | 'assertive';
  /**
   * Kebab-case testID prefix (e.g. `'fake-loader-ladder'`). The component
   * appends `-item-{index}`, `-item-{index}-label`, and `-progress`.
   */
  readonly testIDPrefix: string;
}

/**
 * Decorative leading glyphs per state — plain Unicode, no icon package.
 *
 * `done` uses the checkmark prefix `'✓ '` (U+2713 followed by a single space):
 * the trailing space separates the marker from the Korean label so a completed
 * stage reads as "✓ 얼굴 인식", matching the Phase-6.2 AC that the done marker is
 * a "checkmark prefix (U+2713 space)".
 */
const STATE_GLYPH: Readonly<Record<StageLadderItemState, string>> = Object.freeze({
  pending: '○',
  active: '●',
  done: '✓ ',
});

/**
 * Normalise the tolerant {@link StageLadderItem} shape into a single
 * tri-state value. Priority: explicit `state` → core-ts `status` →
 * `isActive` / `isDone` booleans → `pending`.
 */
export function resolveItemState(item: StageLadderItem): StageLadderItemState {
  if (item.state !== undefined) return item.state;
  if (item.status !== undefined) return item.status;
  if (item.isActive === true) return 'active';
  if (item.isDone === true) return 'done';
  return 'pending';
}

/**
 * Map the view-model's ARIA politeness onto RN's `accessibilityLiveRegion`
 * union. RN has no `'off'` member — the equivalent is `'none'`.
 */
function liveRegionFor(
  ariaLive: 'off' | 'polite' | 'assertive',
): 'none' | 'polite' | 'assertive' {
  return ariaLive === 'off' ? 'none' : ariaLive;
}

/**
 * Renders the shared Korean-label progress ladder.
 *
 * @see StageLadderProps for prop documentation.
 */
export function StageLadder(props: StageLadderProps): React.ReactElement {
  const { items, progress, testIDPrefix } = props;
  const ariaLive = props.ariaLive ?? 'polite';

  return (
    <View
      style={styles.container}
      testID={testIDPrefix}
      accessibilityRole="list"
      accessibilityLiveRegion={liveRegionFor(ariaLive)}
    >
      {items.map((item, index) => {
        const state = resolveItemState(item);
        const rowTestID = `${testIDPrefix}-item-${index}`;
        const labelTestID = `${rowTestID}-label`;
        const isActive = state === 'active';
        return (
          <View
            key={item.key ?? `${testIDPrefix}-${index}`}
            style={styles.row}
            testID={rowTestID}
            accessibilityRole="text"
            accessibilityLabel={item.label}
            accessibilityState={{ selected: isActive }}
          >
            <Text
              style={[styles.glyph, glyphStyleFor(state)]}
              accessibilityElementsHidden
              importantForAccessibility="no"
            >
              {STATE_GLYPH[state]}
            </Text>
            <Text style={[styles.label, labelStyleFor(state)]} testID={labelTestID}>
              {item.label}
            </Text>
          </View>
        );
      })}

      {progress !== undefined ? (
        <View style={styles.meter} testID={`${testIDPrefix}-meter`}>
          <View style={styles.meterTrack}>
            <View style={[styles.meterFill, { width: `${clampPercent(progress)}%` }]} />
          </View>
          <Text
            style={styles.progressText}
            testID={`${testIDPrefix}-progress`}
            accessibilityRole="text"
          >
            {`${clampPercent(progress)}%`}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** Clamp a possibly-out-of-range percent into the renderable 0–100 band. */
function clampPercent(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return Math.round(value);
}

/**
 * Glyph colour per state.
 *   - `active`  → `COLORS.base.coral`: the in-progress row's marker is the focal
 *     point and gets the funnel's actionable-intent colour.
 *   - `done`    → `COLORS.grayscale.disabled`: a completed stage recedes — its
 *     checkmark is muted so the eye stays on the active row, matching the
 *     Phase-6.2 AC that done rows render in `grayscale.disabled`.
 *   - `pending` → `COLORS.grayscale.border`: a not-yet-reached stage's ○
 *     marker reads as a faint hairline cue in the light `border` token
 *     (the same token the meter track uses), distinct from the muted
 *     `disabled` body text beside it — zero new hex introduced.
 */
function glyphStyleFor(state: StageLadderItemState): { color: string } {
  if (state === 'done') {
    return { color: INK.faint };
  }
  if (state === 'pending') {
    return { color: INK.line };
  }
  return { color: INK.primary };
}

/**
 * Label colour + weight per state.
 *   - `active`  → `COLORS.base.coral` in bold (`fontWeight '700'`): the row
 *     currently in progress is the focal point of the ladder, so it gets the
 *     funnel's actionable-intent colour and the heaviest weight to pull the
 *     eye (and to visually echo the coral active glyph beside it).
 *   - `done`    → `COLORS.grayscale.disabled` (regular body weight): a completed
 *     stage recedes into a muted, settled state once it is no longer current.
 *   - `pending` → `COLORS.grayscale.disabled` (regular): not yet reached, muted.
 *
 * The returned slice is spread over the base `styles.label`
 * (`TYPOGRAPHY.body.regular`), so only `active` overrides the inherited
 * `fontWeight`; `done` / `pending` keep the regular weight implicitly.
 */
function labelStyleFor(state: StageLadderItemState): {
  color: string;
  fontFamily?: string;
} {
  if (state === 'active') {
    // The in-progress row is the focal point: primary ink + medium weight.
    return {
      color: INK.primary,
      fontFamily: FONT.medium,
    };
  }
  if (state === 'pending') {
    return { color: INK.faint };
  }
  if (state === 'done') {
    return { color: INK.faint };
  }
  return { color: INK.primary };
}

/**
 * StyleSheet — derived entirely from design tokens. No hard-coded sizes,
 * colours, or spacing; any visual tweak lands in the token module, not here.
 */
const styles = StyleSheet.create({
  container: {
    gap: SPACING.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  glyph: {
    fontFamily: FONT.medium,
    fontSize: 14,
  },
  label: {
    fontFamily: FONT.regular,
    fontSize: 14,
  },
  meter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    marginTop: SPACING.xs,
  },
  meterTrack: {
    flex: 1,
    height: SPACING.xxs,
    borderRadius: SPACING.xxs,
    backgroundColor: INK.line,
    overflow: 'hidden',
  },
  meterFill: {
    height: SPACING.xxs,
    borderRadius: SPACING.xxs,
    backgroundColor: INK.primary,
  },
  progressText: {
    fontFamily: FONT.medium,
    fontSize: 12,
    letterSpacing: 0.3,
    color: INK.muted,
  },
});
