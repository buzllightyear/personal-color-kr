/**
 * `LockIcon` — a thin-stroke padlock line icon (react-native-svg).
 *
 * Replaces the former 🔒 emoji on the result-reveal locked-asset overlays, per
 * the editorial/VSCO direction (docs/DESIGN.md: thin line icons, never emoji).
 * Geometry is the Feather "lock" glyph on a 24×24 viewBox; stroke-only, no
 * fill, so it reads as a hairline mark in any ink colour.
 */
import * as React from 'react';
import Svg, { Path, Rect } from 'react-native-svg';

import { INK } from '../../theme/editorial';

export interface LockIconProps {
  /** Square edge length in px. Defaults to 28. */
  readonly size?: number;
  /** Stroke colour. Defaults to primary ink. */
  readonly color?: string;
  /** Stable testID forwarded to the SVG root. */
  readonly testID?: string;
  /** Korean accessibility label (e.g. "잠김"). */
  readonly accessibilityLabel?: string;
}

export function LockIcon(props: LockIconProps): React.ReactElement {
  const { size = 28, color = INK.primary, testID, accessibilityLabel } = props;
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      {...(testID !== undefined ? { testID } : {})}
      {...(accessibilityLabel !== undefined
        ? { accessibilityLabel, accessibilityRole: 'image' as const }
        : {})}
    >
      <Rect
        x={3}
        y={11}
        width={18}
        height={11}
        rx={2}
        stroke={color}
        strokeWidth={1.4}
      />
      <Path
        d="M7 11V7a5 5 0 0 1 10 0v4"
        stroke={color}
        strokeWidth={1.4}
        strokeLinecap="round"
      />
    </Svg>
  );
}
