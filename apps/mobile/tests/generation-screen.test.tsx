/**
 * Unit test — `GenerationScreen` presentational component (AC2).
 *
 * Pure props-in / callbacks-out: no network, no router, no expo modules.
 * Verifies the four-state machine and the callback wiring.
 */
import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

// SafeAreaView passthrough — the screen wraps its root in the safe-area-context
// SafeAreaView (top inset). The node env has no native module, so render it as
// a plain host that forwards props/children (edges/testID flow through).
vi.mock('react-native-safe-area-context', async () => {
  const reactActual: typeof import('react') = await vi.importActual('react');
  return {
    SafeAreaView: (props: Record<string, unknown> & { children?: React.ReactNode }) =>
      reactActual.createElement('SafeAreaView', props, props?.children),
  };
});

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
    Image: makeHost('Image'),
    StyleSheet: {
      create: (s: Record<string, unknown>): Record<string, unknown> => s,
      hairlineWidth: 1,
    },
  };
});

vi.mock('../src/theme', () => ({
  COLORS: {
    grayscale: {
      background: '#fff',
      text: '#000',
      border: '#ccc',
      disabled: '#999',
    },
    base: { pink: '#fce' },
  },
  SPACING: { sm: 8, md: 16, lg: 24, xl: 32 },
}));

import { GenerationScreen } from '../src/screens/generate/GenerationScreen';

function _findByTestId(root: TestRenderer.ReactTestInstance, testID: string) {
  // Match host nodes only (string `type`); the RN mock renders each primitive
  // as a function component that also carries `testID`, so an unfiltered query
  // would double-count the component instance and its host element.
  return root.findAll((n) => typeof n.type === 'string' && n.props?.testID === testID);
}

describe('GenerationScreen', () => {
  it('idle: renders the generate CTA and calls onGenerate on press', () => {
    const onGenerate = vi.fn();
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <GenerationScreen status="idle" onGenerate={onGenerate} onRetry={vi.fn()} />,
      );
    });
    const btns = _findByTestId(tree.root, 'generation-generate-button');
    expect(btns).toHaveLength(1);
    act(() => {
      btns[0]!.props.onPress();
    });
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it('loading: renders the loading indicator and no CTA', () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <GenerationScreen status="loading" onGenerate={vi.fn()} onRetry={vi.fn()} />,
      );
    });
    expect(_findByTestId(tree.root, 'generation-loading')).toHaveLength(1);
    expect(_findByTestId(tree.root, 'generation-generate-button')).toHaveLength(0);
  });

  it('success: renders the result image with the data URI', () => {
    const uri = 'data:image/png;base64,AAAA';
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <GenerationScreen
          status="success"
          imageDataUri={uri}
          onGenerate={vi.fn()}
          onRetry={vi.fn()}
        />,
      );
    });
    const imgs = _findByTestId(tree.root, 'generation-result');
    expect(imgs).toHaveLength(1);
    expect(imgs[0]!.props.source).toEqual({ uri });
  });

  it('error (recoverable): renders error + retry CTA and calls onRetry', () => {
    const onRetry = vi.fn();
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <GenerationScreen
          status="error"
          errorKind="generation_failed"
          onGenerate={vi.fn()}
          onRetry={onRetry}
        />,
      );
    });
    expect(_findByTestId(tree.root, 'generation-error')).toHaveLength(1);
    const retry = _findByTestId(tree.root, 'generation-retry-button');
    expect(retry).toHaveLength(1);
    act(() => {
      retry[0]!.props.onPress();
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it.each(['unauthorized', 'recipe_not_found'] as const)(
    'error (%s): shows no retry CTA (terminal failure)',
    (kind) => {
      let tree!: TestRenderer.ReactTestRenderer;
      act(() => {
        tree = TestRenderer.create(
          <GenerationScreen
            status="error"
            errorKind={kind}
            onGenerate={vi.fn()}
            onRetry={vi.fn()}
          />,
        );
      });
      expect(_findByTestId(tree.root, 'generation-error')).toHaveLength(1);
      expect(_findByTestId(tree.root, 'generation-retry-button')).toHaveLength(0);
    },
  );
});
