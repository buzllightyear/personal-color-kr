/**
 * Vitest stub for `react-native-svg`.
 *
 * `react-native-svg` is a native module whose JS entry pulls in syntax /
 * native bindings vite cannot parse in the node test env (same class of
 * problem as `expo-linking` / `expo-font`). The editorial line icons
 * (`src/components/icons/*`) import `Svg, Path, Rect, Circle, …` from it.
 *
 * `vitest.config.ts` aliases `react-native-svg` to this stub so those icons
 * render as inert host elements: each primitive becomes a host node (a string
 * `type`) that forwards its props (including `testID` / `accessibilityLabel`)
 * and children, exactly like the `react-native` host-component mock the screen
 * tests already use. That lets `findHostByTestId` locate an icon's testID
 * without a real SVG renderer.
 */
import * as React from 'react';

type HostProps = Record<string, unknown> & { children?: React.ReactNode };

function host(tag: string): (props: HostProps) => React.ReactElement {
  const Component = (props: HostProps): React.ReactElement =>
    React.createElement(tag, props, props?.children);
  Component.displayName = tag;
  return Component;
}

const Svg = host('Svg');

export default Svg;
export const Path = host('Path');
export const Rect = host('Rect');
export const Circle = host('Circle');
export const Ellipse = host('Ellipse');
export const Line = host('Line');
export const Polyline = host('Polyline');
export const Polygon = host('Polygon');
export const G = host('G');
export const Defs = host('Defs');
export const Stop = host('Stop');
export const LinearGradient = host('LinearGradient');
export const ClipPath = host('ClipPath');
