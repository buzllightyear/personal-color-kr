/**
 * Unit test — `SelfieUploadPressable` component module (Phase 2.3, Sub-AC 5.2).
 *
 * Sub-AC 5.2 mandate:
 *   "Create a SelfieUploadPressable component module exposing an onCapture
 *    callback that fires a stub URI string when pressed, with a unit test
 *    simulating a press event and asserting the callback receives the stub
 *    URI."
 *
 * Asserts:
 *   1. Renders the idle Korean label "셀카 등록하기" when `selfieUri === null`.
 *   2. Renders the captured Korean label "셀카 등록됨" when `selfieUri` is a
 *      non-null string.
 *   3. Simulating a press event invokes `onCapture` exactly once with a
 *      string matching the documented `stub://selfie/<timestamp>` shape —
 *      THE Sub-AC core assertion.
 *   4. Subsequent presses produce a *new* timestamp suffix (re-capture path).
 *   5. The wrapper Pressable uses the default testID sentinel when none is
 *      supplied; a caller-supplied testID overrides it.
 *   6. The accessibility label mirrors the captured state so screen readers
 *      announce the post-tap transition naturally.
 *
 * Why react-test-renderer + vi.mock('react-native'):
 *   Same rationale as `funnel-primary-button.test.tsx` and
 *   `diagnosis-input-screen.test.tsx` — the unit-test environment does not
 *   ship the real RN runtime (Node cannot parse RN's Flow syntax), and
 *   `@testing-library/react-native` is heavier than this leaf component
 *   needs. The mock returns minimal host-component shells that record the
 *   props the component passes; the test extracts and invokes the `onPress`
 *   handler directly to simulate the press.
 */
import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', async () => {
  const reactActual: typeof import('react') = await vi.importActual('react');
  const makeHost =
    (label: string) =>
    (props: Record<string, unknown> & { children?: React.ReactNode }) =>
      reactActual.createElement(label, props, props?.children);
  return {
    View: makeHost('View'),
    Text: makeHost('Text'),
    Pressable: makeHost('Pressable'),
    StyleSheet: {
      create: (s: Record<string, unknown>): Record<string, unknown> => s,
      flatten: (s: unknown): unknown => {
        if (Array.isArray(s)) {
          return s.reduce((acc: Record<string, unknown>, item: unknown) => {
            if (item == null || typeof item !== 'object') return acc;
            return { ...acc, ...(item as Record<string, unknown>) };
          }, {});
        }
        return s;
      },
    },
    Platform: {
      OS: 'ios',
      select: (m: { ios?: unknown; default?: unknown }) => m.ios ?? m.default,
    },
  };
});

import {
  SELFIE_UPLOAD_CAPTURED_LABEL,
  SELFIE_UPLOAD_IDLE_LABEL,
  SELFIE_UPLOAD_PRESSABLE_DEFAULT_TEST_ID,
  SelfieUploadPressable,
  buildStubSelfieUri,
} from '../src/components/funnel/SelfieUploadPressable';

interface TestInstance {
  readonly type: unknown;
  readonly props: Record<string, unknown>;
}

function findHostByTestId(
  tree: TestRenderer.ReactTestRenderer,
  testID: string,
): TestInstance | null {
  const matches = tree.root.findAll(
    (node) => typeof node.type === 'string' && node.props?.testID === testID,
  );
  return (matches[0] as unknown as TestInstance) ?? null;
}

function render(element: React.ReactElement): TestRenderer.ReactTestRenderer {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  act(() => {
    tree = TestRenderer.create(element);
  });
  if (!tree) throw new Error('render: tree not created');
  return tree;
}

const NO_OP_CAPTURE = (_uri: string): void => undefined;

describe('SelfieUploadPressable — render', () => {
  it('renders the idle Korean label "셀카 등록하기" when selfieUri is null', () => {
    const tree = render(
      React.createElement(SelfieUploadPressable, {
        selfieUri: null,
        onCapture: NO_OP_CAPTURE,
      }),
    );
    const idle = findHostByTestId(tree, 'selfie-upload-label-idle');
    expect(idle).toBeTruthy();
    expect(idle?.props.children).toBe(SELFIE_UPLOAD_IDLE_LABEL);
    expect(idle?.props.children).toBe('셀카 등록하기');
    expect(
      findHostByTestId(tree, 'selfie-upload-label-captured'),
    ).toBeNull();
  });

  it('renders the captured Korean label "셀카 등록됨" when selfieUri is a non-null string', () => {
    const tree = render(
      React.createElement(SelfieUploadPressable, {
        selfieUri: 'stub://selfie/123456',
        onCapture: NO_OP_CAPTURE,
      }),
    );
    const captured = findHostByTestId(tree, 'selfie-upload-label-captured');
    expect(captured).toBeTruthy();
    expect(captured?.props.children).toBe(SELFIE_UPLOAD_CAPTURED_LABEL);
    expect(captured?.props.children).toBe('셀카 등록됨');
    expect(findHostByTestId(tree, 'selfie-upload-label-idle')).toBeNull();
  });

  it('renders the camera emoji glyph (no icon packages)', () => {
    const tree = render(
      React.createElement(SelfieUploadPressable, {
        selfieUri: null,
        onCapture: NO_OP_CAPTURE,
      }),
    );
    const icon = findHostByTestId(tree, 'selfie-upload-icon');
    expect(icon).toBeTruthy();
    expect(icon?.props.children).toBe('📷');
  });

  it('uses the default testID sentinel when none is supplied', () => {
    const tree = render(
      React.createElement(SelfieUploadPressable, {
        selfieUri: null,
        onCapture: NO_OP_CAPTURE,
      }),
    );
    expect(
      findHostByTestId(tree, SELFIE_UPLOAD_PRESSABLE_DEFAULT_TEST_ID),
    ).not.toBeNull();
  });

  it('honours a caller-supplied testID override', () => {
    const tree = render(
      React.createElement(SelfieUploadPressable, {
        selfieUri: null,
        onCapture: NO_OP_CAPTURE,
        testID: 'diagnosis-input-capture-surface',
      }),
    );
    expect(
      findHostByTestId(tree, 'diagnosis-input-capture-surface'),
    ).not.toBeNull();
    // Default sentinel must NOT also be present — the caller's value wins.
    expect(
      findHostByTestId(tree, SELFIE_UPLOAD_PRESSABLE_DEFAULT_TEST_ID),
    ).toBeNull();
  });
});

describe('SelfieUploadPressable — onCapture wiring (Sub-AC 5.2 core)', () => {
  it('fires onCapture exactly once with a stub://selfie/<timestamp> URI when pressed', () => {
    const onCapture = vi.fn();
    const tree = render(
      React.createElement(SelfieUploadPressable, {
        selfieUri: null,
        onCapture,
      }),
    );

    const surface = findHostByTestId(
      tree,
      SELFIE_UPLOAD_PRESSABLE_DEFAULT_TEST_ID,
    );
    expect(surface).toBeTruthy();
    const onPress = surface?.props.onPress as (e: unknown) => void;
    expect(typeof onPress).toBe('function');

    act(() => {
      onPress({} as unknown);
    });

    // Sub-AC 5.2 core contract: callback received exactly one stub URI string.
    expect(onCapture).toHaveBeenCalledTimes(1);
    const arg = onCapture.mock.calls[0]?.[0] as unknown;
    expect(typeof arg).toBe('string');
    expect(arg as string).toMatch(/^stub:\/\/selfie\/\d+$/);
  });

  it('mints a new timestamp suffix on each press (re-capture path)', () => {
    // Drive Date.now deterministically so the two URIs are guaranteed to
    // differ — we cannot rely on a millisecond elapsing inside the same
    // test tick under fake timers or fast CPUs.
    const dateNowSpy = vi.spyOn(Date, 'now');
    dateNowSpy.mockReturnValueOnce(1000).mockReturnValueOnce(2000);

    const onCapture = vi.fn();
    const tree = render(
      React.createElement(SelfieUploadPressable, {
        selfieUri: null,
        onCapture,
      }),
    );
    const surface = findHostByTestId(
      tree,
      SELFIE_UPLOAD_PRESSABLE_DEFAULT_TEST_ID,
    );
    const onPress = surface?.props.onPress as (e: unknown) => void;

    act(() => {
      onPress({} as unknown);
    });
    act(() => {
      onPress({} as unknown);
    });

    expect(onCapture).toHaveBeenCalledTimes(2);
    expect(onCapture.mock.calls[0]?.[0]).toBe('stub://selfie/1000');
    expect(onCapture.mock.calls[1]?.[0]).toBe('stub://selfie/2000');

    dateNowSpy.mockRestore();
  });

  it('fires onCapture even when a selfieUri is already present (re-capture supported)', () => {
    const onCapture = vi.fn();
    const tree = render(
      React.createElement(SelfieUploadPressable, {
        selfieUri: 'stub://selfie/999',
        onCapture,
      }),
    );
    const surface = findHostByTestId(
      tree,
      SELFIE_UPLOAD_PRESSABLE_DEFAULT_TEST_ID,
    );
    const onPress = surface?.props.onPress as (e: unknown) => void;

    act(() => {
      onPress({} as unknown);
    });

    expect(onCapture).toHaveBeenCalledTimes(1);
    const arg = onCapture.mock.calls[0]?.[0] as unknown;
    expect(typeof arg).toBe('string');
    expect(arg as string).toMatch(/^stub:\/\/selfie\/\d+$/);
  });
});

describe('SelfieUploadPressable — accessibility', () => {
  it('sets accessibilityRole="button" always', () => {
    const tree = render(
      React.createElement(SelfieUploadPressable, {
        selfieUri: null,
        onCapture: NO_OP_CAPTURE,
      }),
    );
    const surface = findHostByTestId(
      tree,
      SELFIE_UPLOAD_PRESSABLE_DEFAULT_TEST_ID,
    );
    expect(surface?.props.accessibilityRole).toBe('button');
  });

  it('mirrors the captured state in accessibilityLabel', () => {
    const idleTree = render(
      React.createElement(SelfieUploadPressable, {
        selfieUri: null,
        onCapture: NO_OP_CAPTURE,
      }),
    );
    const idleSurface = findHostByTestId(
      idleTree,
      SELFIE_UPLOAD_PRESSABLE_DEFAULT_TEST_ID,
    );
    expect(idleSurface?.props.accessibilityLabel).toBe(
      SELFIE_UPLOAD_IDLE_LABEL,
    );

    const capturedTree = render(
      React.createElement(SelfieUploadPressable, {
        selfieUri: 'stub://selfie/abc',
        onCapture: NO_OP_CAPTURE,
      }),
    );
    const capturedSurface = findHostByTestId(
      capturedTree,
      SELFIE_UPLOAD_PRESSABLE_DEFAULT_TEST_ID,
    );
    expect(capturedSurface?.props.accessibilityLabel).toBe(
      SELFIE_UPLOAD_CAPTURED_LABEL,
    );
  });

  it('mirrors the captured state in accessibilityState.selected', () => {
    const idleTree = render(
      React.createElement(SelfieUploadPressable, {
        selfieUri: null,
        onCapture: NO_OP_CAPTURE,
      }),
    );
    const idleSurface = findHostByTestId(
      idleTree,
      SELFIE_UPLOAD_PRESSABLE_DEFAULT_TEST_ID,
    );
    expect(
      (idleSurface?.props.accessibilityState as { selected: boolean }).selected,
    ).toBe(false);

    const capturedTree = render(
      React.createElement(SelfieUploadPressable, {
        selfieUri: 'stub://selfie/abc',
        onCapture: NO_OP_CAPTURE,
      }),
    );
    const capturedSurface = findHostByTestId(
      capturedTree,
      SELFIE_UPLOAD_PRESSABLE_DEFAULT_TEST_ID,
    );
    expect(
      (capturedSurface?.props.accessibilityState as { selected: boolean })
        .selected,
    ).toBe(true);
  });

  it('hides the emoji glyph from screen readers (no double announcement)', () => {
    const tree = render(
      React.createElement(SelfieUploadPressable, {
        selfieUri: null,
        onCapture: NO_OP_CAPTURE,
      }),
    );
    const icon = findHostByTestId(tree, 'selfie-upload-icon');
    expect(icon?.props.accessibilityElementsHidden).toBe(true);
    expect(icon?.props.importantForAccessibility).toBe('no');
  });
});

describe('SelfieUploadPressable — buildStubSelfieUri helper', () => {
  it('returns a string matching stub://selfie/<timestamp>', () => {
    const uri = buildStubSelfieUri();
    expect(typeof uri).toBe('string');
    expect(uri).toMatch(/^stub:\/\/selfie\/\d+$/);
  });

  it('embeds the current Date.now() timestamp in the URI', () => {
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(424242);
    expect(buildStubSelfieUri()).toBe('stub://selfie/424242');
    dateNowSpy.mockRestore();
  });
});
