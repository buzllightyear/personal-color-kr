/**
 * Unit test — `DiagnosisInputScreen` presentational component (Phase 2.3,
 * Sub-AC 2).
 *
 * Asserts:
 *   1. Renders the Korean headline + subhead sourced from
 *      FUNNEL_SCREENS.diagnosis_input.
 *   2. Renders the stub capture surface as a Pressable with the idle Korean
 *      label "셀카 등록하기" when no selfie URI is present.
 *   3. Renders the captured indicator "셀카 등록됨" when a non-null selfieUri
 *      is supplied.
 *   4. The primary CTA is disabled while `selfieUri === null`.
 *   5. The primary CTA is enabled once `selfieUri` becomes non-null.
 *   6. Tapping the capture surface invokes `onCaptureSelfie` with a string
 *      matching the documented `stub://selfie/<timestamp>` format — this is
 *      the contract write that the route handler forwards into
 *      `FunnelStateContext.setDiagnosisInput`.
 *   7. End-to-end Context wiring: mounting the screen *inside* a real
 *      `<FunnelStateProvider>` (with a route-shaped adapter that calls
 *      `setDiagnosisInput`) writes the captured URI into the context's
 *      `diagnosisInput` slice — verifying the screen → route → context flow
 *      this Sub-AC requires.
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
      flatten: (s: unknown): unknown => s,
    },
    Platform: {
      OS: 'ios',
      select: (m: { ios?: unknown; default?: unknown }) => m.ios ?? m.default,
    },
  };
});

vi.mock('react-native-safe-area-context', () => {
  return {
    SafeAreaView: (props: { children?: React.ReactNode; [key: string]: unknown }) =>
      React.createElement('SafeAreaView', props, props.children),
  };
});

import { DiagnosisInputScreen } from '../src/screens/funnel/DiagnosisInputScreen';
import {
  FunnelStateProvider,
  useFunnelState,
} from '../src/providers/FunnelStateProvider';
import type { FunnelStateValue } from '../src/contracts/funnel-state';
import { GUIDE_ITEMS } from '../src/components/funnel/GuideList';

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
const NO_OP = (): void => undefined;

describe('DiagnosisInputScreen — render', () => {
  it('renders the Korean headline from FUNNEL_SCREENS.diagnosis_input', () => {
    const tree = render(
      React.createElement(DiagnosisInputScreen, {
        selfieUri: null,
        onCaptureSelfie: NO_OP_CAPTURE,
        onNext: NO_OP,
      }),
    );
    const headline = findHostByTestId(tree, 'diagnosis-input-headline');
    expect(headline).toBeTruthy();
    expect(headline?.props.children).toBe('셀카 1장만 올려주세요');
  });

  it('renders the Korean subhead from FUNNEL_SCREENS.diagnosis_input', () => {
    const tree = render(
      React.createElement(DiagnosisInputScreen, {
        selfieUri: null,
        onCaptureSelfie: NO_OP_CAPTURE,
        onNext: NO_OP,
      }),
    );
    const subhead = findHostByTestId(tree, 'diagnosis-input-subhead');
    expect(subhead).toBeTruthy();
    expect(subhead?.props.children).toBe(
      '정면 · 자연광 · 민낯에 가까울수록 결과가 정확해요',
    );
  });

  it('renders the idle capture label "셀카 등록하기" when selfieUri is null', () => {
    const tree = render(
      React.createElement(DiagnosisInputScreen, {
        selfieUri: null,
        onCaptureSelfie: NO_OP_CAPTURE,
        onNext: NO_OP,
      }),
    );
    // Post Sub-AC 5.3, the visible label testID is owned by
    // SelfieUploadPressable: `selfie-upload-label-idle` /
    // `selfie-upload-label-captured`.
    const idleLabel = findHostByTestId(tree, 'selfie-upload-label-idle');
    expect(idleLabel).toBeTruthy();
    expect(idleLabel?.props.children).toBe('셀카 등록하기');
    // Captured-state label should NOT appear in the idle render.
    expect(findHostByTestId(tree, 'selfie-upload-label-captured')).toBeNull();
  });

  it('renders the captured label "셀카 등록됨" when selfieUri is non-null', () => {
    const tree = render(
      React.createElement(DiagnosisInputScreen, {
        selfieUri: 'stub://selfie/123456',
        onCaptureSelfie: NO_OP_CAPTURE,
        onNext: NO_OP,
      }),
    );
    const capturedLabel = findHostByTestId(tree, 'selfie-upload-label-captured');
    expect(capturedLabel).toBeTruthy();
    expect(capturedLabel?.props.children).toBe('셀카 등록됨');
    expect(findHostByTestId(tree, 'selfie-upload-label-idle')).toBeNull();
  });

  it('mirrors the captured state on the Pressable accessibility label', () => {
    const idleTree = render(
      React.createElement(DiagnosisInputScreen, {
        selfieUri: null,
        onCaptureSelfie: NO_OP_CAPTURE,
        onNext: NO_OP,
      }),
    );
    const idleSurface = findHostByTestId(idleTree, 'diagnosis-input-capture-surface');
    expect(idleSurface?.props.accessibilityLabel).toBe('셀카 등록하기');

    const capturedTree = render(
      React.createElement(DiagnosisInputScreen, {
        selfieUri: 'stub://selfie/abc',
        onCaptureSelfie: NO_OP_CAPTURE,
        onNext: NO_OP,
      }),
    );
    const capturedSurface = findHostByTestId(
      capturedTree,
      'diagnosis-input-capture-surface',
    );
    expect(capturedSurface?.props.accessibilityLabel).toBe('셀카 등록됨');
  });
});

describe('DiagnosisInputScreen — submit gating', () => {
  it('primary CTA is disabled while selfieUri is null', () => {
    const tree = render(
      React.createElement(DiagnosisInputScreen, {
        selfieUri: null,
        onCaptureSelfie: NO_OP_CAPTURE,
        onNext: NO_OP,
      }),
    );
    const submit = findHostByTestId(tree, 'diagnosis-input-submit');
    expect(submit).toBeTruthy();
    expect((submit?.props.accessibilityState as { disabled: boolean }).disabled).toBe(
      true,
    );
  });

  it('primary CTA is enabled once selfieUri is non-null', () => {
    const tree = render(
      React.createElement(DiagnosisInputScreen, {
        selfieUri: 'stub://selfie/xyz',
        onCaptureSelfie: NO_OP_CAPTURE,
        onNext: NO_OP,
      }),
    );
    const submit = findHostByTestId(tree, 'diagnosis-input-submit');
    expect((submit?.props.accessibilityState as { disabled: boolean }).disabled).toBe(
      false,
    );
  });

  it('primary CTA invokes onNext when pressed in enabled state', () => {
    const onNext = vi.fn();
    const tree = render(
      React.createElement(DiagnosisInputScreen, {
        selfieUri: 'stub://selfie/xyz',
        onCaptureSelfie: NO_OP_CAPTURE,
        onNext,
      }),
    );
    const submit = findHostByTestId(tree, 'diagnosis-input-submit');
    const onPress = submit?.props.onPress as (e: unknown) => void;
    expect(typeof onPress).toBe('function');
    act(() => onPress({}));
    expect(onNext).toHaveBeenCalledTimes(1);
  });
});

describe('DiagnosisInputScreen — capture callback', () => {
  it('invokes onCaptureSelfie with a stub://selfie/<timestamp> URI when the capture surface is pressed', () => {
    const onCapture = vi.fn();
    const tree = render(
      React.createElement(DiagnosisInputScreen, {
        selfieUri: null,
        onCaptureSelfie: onCapture,
        onNext: NO_OP,
      }),
    );
    const surface = findHostByTestId(tree, 'diagnosis-input-capture-surface');
    const onPress = surface?.props.onPress as () => void;
    act(() => onPress());
    expect(onCapture).toHaveBeenCalledTimes(1);
    const arg = onCapture.mock.calls[0]?.[0] as unknown;
    expect(typeof arg).toBe('string');
    expect(arg as string).toMatch(/^stub:\/\/selfie\/\d+$/);
  });
});

// ---------------------------------------------------------------------------
// End-to-end Context wiring: route-style adapter writes into
// FunnelStateContext.diagnosisInput via the screen's onCaptureSelfie callback.
// This is the contract this Sub-AC explicitly requires: "writes values into
// the FunnelStateContext diagnosisInput slice".
// ---------------------------------------------------------------------------

/**
 * Route-shaped adapter that mirrors `app/(funnel)/diagnosis-input.tsx`'s
 * wiring — it reads `diagnosisInput` from `useFunnelState`, supplies it as
 * `selfieUri`, and routes `onCaptureSelfie` straight through to
 * `setDiagnosisInput`. The adapter also exposes the live context value to
 * the test via a mutable capture object so the test can assert the post-tap
 * snapshot without re-rendering plumbing.
 */
interface ContextCapture {
  latest: FunnelStateValue | null;
}

function RouteAdapter(props: { readonly capture: ContextCapture }): React.ReactElement {
  const value = useFunnelState();
  props.capture.latest = value;
  return React.createElement(DiagnosisInputScreen, {
    selfieUri: value.diagnosisInput.selfieUri,
    onCaptureSelfie: (uri: string) => value.setDiagnosisInput({ selfieUri: uri }),
    onNext: NO_OP,
  });
}

// ---------------------------------------------------------------------------
// Composition integration (Sub-AC 5.3): the screen must mount BOTH the
// GuideList (Sub-AC 5.1) and the SelfieUploadPressable (Sub-AC 5.2), and the
// tap → context write path must run end-to-end. The render/capture tests
// above already cover the props-side contract; this block pins the
// *composition* contract — that the two extracted leaf components are
// present in the tree and the upload control's URI lands on the context
// slice.
// ---------------------------------------------------------------------------

describe('DiagnosisInputScreen — composition integration (Sub-AC 5.3)', () => {
  it('mounts GuideList with all three canonical Korean cues in order', () => {
    const tree = render(
      React.createElement(DiagnosisInputScreen, {
        selfieUri: null,
        onCaptureSelfie: NO_OP_CAPTURE,
        onNext: NO_OP,
      }),
    );
    // The screen scopes the GuideList testID prefix to
    // `diagnosis-input-guide-list` so a future screen that also embeds a
    // GuideList stays addressable.
    const container = findHostByTestId(tree, 'diagnosis-input-guide-list');
    expect(container).toBeTruthy();

    // Each of the three canonical cues should be present in the documented
    // order — pinning the GUIDE_ITEMS source-of-truth against the
    // composed surface.
    GUIDE_ITEMS.forEach((cue, index) => {
      const labelNode = findHostByTestId(
        tree,
        `diagnosis-input-guide-list-item-${index}-label`,
      );
      expect(labelNode).toBeTruthy();
      expect(labelNode?.props.children).toBe(cue);
    });
  });

  it('mounts SelfieUploadPressable with the screen-scoped wrapper testID', () => {
    const tree = render(
      React.createElement(DiagnosisInputScreen, {
        selfieUri: null,
        onCaptureSelfie: NO_OP_CAPTURE,
        onNext: NO_OP,
      }),
    );
    // The screen pins the wrapper Pressable's testID to
    // `diagnosis-input-capture-surface` so route- and screen-level tests can
    // address it without colliding with the component's default sentinel.
    expect(findHostByTestId(tree, 'diagnosis-input-capture-surface')).toBeTruthy();
    // The component's own icon testID should be present too — confirming
    // the screen really delegates rendering to SelfieUploadPressable
    // instead of inlining its own emoji + label.
    expect(findHostByTestId(tree, 'selfie-upload-icon')).toBeTruthy();
  });

  it('writes the upload-control stub URI into context.diagnosisInput on tap (composition end-to-end)', () => {
    // This is the Sub-AC 5.3 integration test: pressing the upload control
    // (SelfieUploadPressable) writes the freshly minted stub URI into
    // FunnelStateContext.diagnosisInput.selfieUri through the composed
    // screen — without any inline capture-surface JSX in the screen itself.
    const capture: ContextCapture = { latest: null };
    let tree: TestRenderer.ReactTestRenderer | undefined;
    act(() => {
      tree = TestRenderer.create(
        React.createElement(
          FunnelStateProvider,
          {},
          React.createElement(RouteAdapter, { capture }),
        ),
      );
    });
    if (!tree) throw new Error('render: tree not created');

    // Pre-tap: context slice starts at null (no selfie captured yet) AND
    // the screen renders the SelfieUploadPressable's idle label — proving
    // the read side of the composition wiring.
    expect(capture.latest?.diagnosisInput.selfieUri).toBeNull();
    expect(findHostByTestId(tree, 'selfie-upload-label-idle')).toBeTruthy();

    // Tap the upload control (the embedded SelfieUploadPressable).
    const surface = findHostByTestId(tree, 'diagnosis-input-capture-surface');
    expect(surface).toBeTruthy();
    const onPress = surface?.props.onPress as () => void;
    expect(typeof onPress).toBe('function');
    act(() => onPress());

    // Post-tap: the context slice now carries a stub URI matching the
    // documented shape — this is the AC's "writes the captured stub URI
    // into FunnelStateContext.diagnosisInput" contract.
    const captured = capture.latest?.diagnosisInput.selfieUri;
    expect(captured).not.toBeNull();
    expect(typeof captured).toBe('string');
    expect(captured as string).toMatch(/^stub:\/\/selfie\/\d+$/);

    // And the composed surface re-renders with the captured label — proving
    // the read-after-write flow through the same SelfieUploadPressable.
    expect(findHostByTestId(tree, 'selfie-upload-label-captured')).toBeTruthy();
  });
});

describe('DiagnosisInputScreen — FunnelStateContext write integration', () => {
  it('captures and writes a stub selfie URI into context.diagnosisInput when the capture surface is tapped', () => {
    const capture: ContextCapture = { latest: null };
    let tree: TestRenderer.ReactTestRenderer | undefined;
    act(() => {
      tree = TestRenderer.create(
        React.createElement(
          FunnelStateProvider,
          {},
          React.createElement(RouteAdapter, { capture }),
        ),
      );
    });
    if (!tree) throw new Error('render: tree not created');

    // First render: context slice starts at null (no selfie captured yet).
    expect(capture.latest?.diagnosisInput.selfieUri).toBeNull();

    // Tap the capture surface — the route adapter forwards the URI into
    // setDiagnosisInput, which mutates the context state.
    const surface = findHostByTestId(tree, 'diagnosis-input-capture-surface');
    const onPress = surface?.props.onPress as () => void;
    expect(typeof onPress).toBe('function');
    act(() => onPress());

    // Post-tap: context now carries a stub URI.
    const captured = capture.latest?.diagnosisInput.selfieUri;
    expect(captured).not.toBeNull();
    expect(typeof captured).toBe('string');
    expect(captured as string).toMatch(/^stub:\/\/selfie\/\d+$/);

    // And the screen re-renders with the captured label and an enabled CTA.
    // Post Sub-AC 5.3, the label testID is owned by SelfieUploadPressable.
    expect(findHostByTestId(tree, 'selfie-upload-label-captured')).toBeTruthy();
    const submit = findHostByTestId(tree, 'diagnosis-input-submit');
    expect((submit?.props.accessibilityState as { disabled: boolean }).disabled).toBe(
      false,
    );
  });
});
