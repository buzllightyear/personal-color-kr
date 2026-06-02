/**
 * Smoke test — `app/(funnel)/diagnosis-input.tsx` route wrapper (Sub-AC 2.2).
 *
 * Verifies the thin expo-router route file:
 *   1. Mounts the presentational `DiagnosisInputScreen` underneath it (the
 *      route is a *wrapper*, not a re-implementation — the entire visual
 *      decision tree lives in the screen file).
 *   2. Reads `selfieUri` from `FunnelStateContext.diagnosisInput` via
 *      `useFunnelState()` and forwards it as the screen's `selfieUri` prop.
 *   3. Wires `onCaptureSelfie` → `setDiagnosisInput({ selfieUri })` so a
 *      capture-surface tap writes the stub URI into the funnel context.
 *   4. Wires `onNext` → `useRouter().push('/(funnel)/fake-scan-animation')`
 *      so the primary CTA advances the funnel to step 8 (fake_scan_animation).
 *
 * The screen component itself is covered exhaustively by
 * `diagnosis-input-screen.test.tsx`; this file pins the *wiring* contract
 * (route → screen → context → router.push) without re-asserting the
 * intra-screen rendering details.
 *
 * Mocking strategy mirrors `scan-option-select-route.test.tsx`:
 *   - `react-native`: minimal host-component set so Vite's ESM resolver does
 *     not land on the real RN entry (Flow `import typeof` parse failure).
 *   - `react-native-safe-area-context`: tiny `SafeAreaView` stub matching
 *     the surface the layout consumes.
 *   - `expo-router`: `useRouter` returns a stub object whose `push` is a
 *     `vi.fn`, so the test can assert the route wrapper calls it with the
 *     correct kebab path for step 8.
 *
 * Because the route uses `useFunnelState()` (which throws when no provider
 * is mounted above it), the test wraps `DiagnosisInputRoute` in a real
 * `<FunnelStateProvider>`. Using the real provider (rather than a mocked
 * hook) means this smoke test also pins the full route → context →
 * `setDiagnosisInput` flow end-to-end — a tap on the capture surface
 * updates the context slice, which re-renders the screen with the enabled
 * CTA, which then forwards `router.push(...)` correctly.
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

// Module-scope router push spy — the mocked `useRouter` closes over this so
// individual tests can introspect call count and arguments after rendering.
const pushSpy = vi.fn();

vi.mock('expo-router', () => {
  return {
    useRouter: (): { push: (path: string) => void } => ({ push: pushSpy }),
  };
});

// Import the default export AFTER the mocks have been registered so the
// route module's `import { useRouter } from 'expo-router'` resolves to the
// mocked surface above.
import DiagnosisInputRoute from '../app/(funnel)/diagnosis-input';
import { FunnelStateProvider } from '../src/providers/FunnelStateProvider';

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

function renderRoute(): TestRenderer.ReactTestRenderer {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  act(() => {
    tree = TestRenderer.create(
      React.createElement(
        FunnelStateProvider,
        {},
        React.createElement(DiagnosisInputRoute),
      ),
    );
  });
  if (!tree) throw new Error('render: tree not created');
  return tree;
}

describe('diagnosis-input route wrapper — mount smoke (Sub-AC 2.2)', () => {
  it('mounts the DiagnosisInputScreen presentational component', () => {
    pushSpy.mockClear();
    const tree = renderRoute();
    // The screen overrides the FunnelScreenLayout testID to
    // `diagnosis-input-screen` — its presence under the route wrapper proves
    // the wrapper delegated to the correct component.
    expect(findHostByTestId(tree, 'diagnosis-input-screen')).toBeTruthy();
  });

  it('renders the idle capture label "셀카 등록하기" before any tap (selfieUri starts null)', () => {
    pushSpy.mockClear();
    const tree = renderRoute();
    // FunnelStateProvider seeds diagnosisInput with selfieUri === null, so
    // the screen renders the idle state. This pins the read side of the
    // wiring (context.diagnosisInput.selfieUri → screen.selfieUri). The
    // label testID is owned by SelfieUploadPressable (Sub-AC 5.2): post
    // composition (Sub-AC 5.3) the screen delegates the label to the
    // component, so we assert against the component's contract.
    expect(findHostByTestId(tree, 'selfie-upload-label-idle')).toBeTruthy();
    expect(findHostByTestId(tree, 'selfie-upload-label-captured')).toBeNull();
  });

  it('forwards capture-surface taps into setDiagnosisInput (screen re-renders with captured state)', () => {
    pushSpy.mockClear();
    const tree = renderRoute();
    const surface = findHostByTestId(tree, 'diagnosis-input-capture-surface');
    expect(surface).toBeTruthy();
    const onPress = surface?.props.onPress as (() => void) | undefined;
    expect(typeof onPress).toBe('function');
    act(() => {
      (onPress as () => void)();
    });
    // After the tap the route's onCaptureSelfie wrote a stub URI into
    // context.diagnosisInput, which re-renders the screen with the captured
    // label visible — this is the route → context write contract.
    expect(findHostByTestId(tree, 'selfie-upload-label-captured')).toBeTruthy();
    expect(findHostByTestId(tree, 'selfie-upload-label-idle')).toBeNull();
  });

  it('forwards useRouter().push to onNext (advances to /(funnel)/fake-scan-animation)', () => {
    pushSpy.mockClear();
    const tree = renderRoute();
    // First capture a selfie so the CTA's disabled gate flips off — the
    // FunnelPrimaryButton suppresses onPress while disabled.
    const surface = findHostByTestId(tree, 'diagnosis-input-capture-surface');
    const capturePress = surface?.props.onPress as () => void;
    act(() => capturePress());

    const submit = findHostByTestId(tree, 'diagnosis-input-submit');
    expect(submit).toBeTruthy();
    expect((submit?.props.accessibilityState as { disabled: boolean }).disabled).toBe(
      false,
    );
    const submitPress = submit?.props.onPress as ((e: unknown) => void) | undefined;
    expect(typeof submitPress).toBe('function');
    act(() => {
      (submitPress as (e: unknown) => void)({});
    });
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy).toHaveBeenCalledWith('/(funnel)/fake-scan-animation');
  });
});
