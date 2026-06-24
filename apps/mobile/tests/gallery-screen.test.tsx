/**
 * Unit test — `GalleryScreen` presentational component (AC4).
 *
 * Pure props-in / callbacks-out: no network, no router, no expo modules.
 * Verifies the loading / error / empty / populated states + the per-item save
 * callback wiring.
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
    ScrollView: makeHost('ScrollView'),
    StyleSheet: {
      create: (s: Record<string, unknown>): Record<string, unknown> => s,
      hairlineWidth: 1,
    },
  };
});

vi.mock('../src/theme', () => ({
  COLORS: {
    grayscale: { background: '#fff', text: '#000', border: '#ccc', disabled: '#999' },
    base: { pink: '#fce' },
  },
  SPACING: { sm: 8, md: 16, lg: 24, xl: 32 },
}));

import {
  GalleryScreen,
  type GalleryScreenItem,
} from '../src/screens/generate/GalleryScreen';

function _findByTestId(root: TestRenderer.ReactTestInstance, testID: string) {
  // Match host nodes only (string `type`); the RN mock renders each primitive
  // as a function component that also carries `testID`, so an unfiltered query
  // would double-count the component instance and its host element.
  return root.findAll((n) => typeof n.type === 'string' && n.props?.testID === testID);
}

const ITEMS: readonly GalleryScreenItem[] = [
  {
    generationId: 'gen-001',
    recipeId: 'summer-vibes',
    imageSource: {
      uri: 'https://api/x/gen-001/image',
      headers: { Authorization: 'Bearer t' },
    },
  },
  {
    generationId: 'gen-002',
    recipeId: 'winter-chic',
    imageSource: { uri: 'https://api/x/gen-002/image' },
  },
];

describe('GalleryScreen', () => {
  it('loading: renders the skeleton and no list', () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <GalleryScreen items={[]} loading error={false} onSave={vi.fn()} />,
      );
    });
    expect(_findByTestId(tree.root, 'gallery-loading')).toHaveLength(1);
    expect(_findByTestId(tree.root, 'gallery-screen')).toHaveLength(0);
  });

  it('error: renders the error fallback', () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <GalleryScreen items={[]} loading={false} error onSave={vi.fn()} />,
      );
    });
    expect(_findByTestId(tree.root, 'gallery-error')).toHaveLength(1);
  });

  it('empty: renders the empty-state', () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <GalleryScreen items={[]} loading={false} error={false} onSave={vi.fn()} />,
      );
    });
    expect(_findByTestId(tree.root, 'gallery-empty')).toHaveLength(1);
  });

  it('populated: renders one image + save CTA per item', () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <GalleryScreen items={ITEMS} loading={false} error={false} onSave={vi.fn()} />,
      );
    });
    expect(_findByTestId(tree.root, 'gallery-screen')).toHaveLength(1);
    expect(_findByTestId(tree.root, 'gallery-image-gen-001')).toHaveLength(1);
    expect(_findByTestId(tree.root, 'gallery-image-gen-002')).toHaveLength(1);
    // The image source (with auth headers) is forwarded to the Image.
    const img = _findByTestId(tree.root, 'gallery-image-gen-001')[0]!;
    expect(img.props.source).toEqual(ITEMS[0]!.imageSource);
  });

  it('save: invokes onSave with the item id', () => {
    const onSave = vi.fn();
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <GalleryScreen items={ITEMS} loading={false} error={false} onSave={onSave} />,
      );
    });
    const btn = _findByTestId(tree.root, 'gallery-save-gen-002')[0]!;
    act(() => {
      btn.props.onPress();
    });
    expect(onSave).toHaveBeenCalledWith('gen-002');
  });
});
