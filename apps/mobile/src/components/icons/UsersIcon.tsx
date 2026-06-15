/**
 * `UsersIcon` — a thin-stroke two-people line icon (react-native-svg).
 *
 * Replaces the former 👥 emoji on the social-evolution empty / friend-count
 * states, per the editorial/VSCO direction (docs/DESIGN.md: thin line icons,
 * never emoji). Geometry is the Feather "users" glyph on a 24×24 viewBox;
 * stroke-only, no fill.
 */
import * as React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';

import { INK } from '../../theme/editorial';

export interface UsersIconProps {
  /** Square edge length in px. Defaults to 44. */
  readonly size?: number;
  /** Stroke colour. Defaults to faint ink (decorative). */
  readonly color?: string;
  /** Stable testID forwarded to the SVG root. */
  readonly testID?: string;
  /** Korean accessibility label, when the icon is not purely decorative. */
  readonly accessibilityLabel?: string;
}

export function UsersIcon(props: UsersIconProps): React.ReactElement {
  const { size = 44, color = INK.faint, testID, accessibilityLabel } = props;
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      {...(testID !== undefined ? { testID } : {})}
      {...(accessibilityLabel !== undefined ? { accessibilityLabel } : {})}
    >
      <Path
        d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"
        stroke={color}
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={9} cy={7} r={4} stroke={color} strokeWidth={1.4} />
      <Path
        d="M23 21v-2a4 4 0 0 0-3-3.87"
        stroke={color}
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M16 3.13a4 4 0 0 1 0 7.75"
        stroke={color}
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
