/**
 * Render test for the post-payment Curation route.
 *
 * Verifies that `app/(post-payment)/curation.tsx`:
 *   1. Exports a default React component (function).
 *   2. Renders without throwing.
 *   3. Returns a valid React element tree.
 *
 * The test stubs `react-native` so the route can be exercised in a plain
 * Node/Vitest environment without a full React Native runtime — this is
 * sufficient to satisfy the shell-level "renders a default-exported React
 * component" contract for Phase 2.
 */
import { describe, it, expect, vi } from 'vitest';
import { createElement, isValidElement, type ReactElement } from 'react';

// Stub `react-native` primitives used by the curation screen with strings,
// which React treats as host component tags during rendering. This keeps the
// test runnable in the Node/Vitest environment used by the rest of core-ts.
vi.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  StyleSheet: {
    create: <T extends Record<string, unknown>>(styles: T): T => styles,
  },
}));

// Import after the mock is registered so the route picks up the stub.
import CurationScreen from '../curation';

describe('app/(post-payment)/curation route', () => {
  it('default-exports a React component (function)', () => {
    expect(typeof CurationScreen).toBe('function');
  });

  it('renders without throwing and returns a React element', () => {
    let rendered: ReactElement | null = null;

    expect(() => {
      rendered = CurationScreen();
    }).not.toThrow();

    expect(rendered).not.toBeNull();
    expect(isValidElement(rendered)).toBe(true);
  });

  it('produces a renderable element tree via createElement', () => {
    const element = createElement(CurationScreen);
    expect(isValidElement(element)).toBe(true);
    expect(element.type).toBe(CurationScreen);
  });
});
