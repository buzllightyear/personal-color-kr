/**
 * Integration test — `app/(generate)/(tabs)/catalog.tsx` auth self-heal.
 *
 * Pins the wiring that prevents the stale-token trap: when the catalog fetch
 * fails with a 401 (the stored token is invalid — expired / rotated secret),
 * the route must discard the persisted token so the step-7 gate re-shows on the
 * next mount. We let the REAL `clearTokenOnUnauthorized` run and spy only on the
 * Keychain `clearAuthToken`, so this guards the route→helper→storage chain
 * end-to-end (a regression test for the one-line `clearTokenOnUnauthorized`
 * call in the catch block).
 *
 * The gallery + generate routes share the identical pattern; their self-heal is
 * covered by the `clearTokenOnUnauthorized` unit test.
 */
import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../src/api-error';

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
    ScrollView: makeHost('ScrollView'),
    Image: makeHost('Image'),
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

vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: (props: { children?: React.ReactNode; [key: string]: unknown }) =>
    React.createElement('SafeAreaView', props, props.children),
}));

vi.mock('expo-router', () => ({
  useRouter: (): { push: (path: string) => void } => ({ push: vi.fn() }),
}));

// A signed-in-looking user: a token resolves, so the catalog attempts the fetch.
vi.mock('../src/config/auth-token', () => ({
  getAuthToken: (): Promise<string | null> => Promise.resolve('stale-token'),
}));

// The catalog fetch rejects with a 401 ApiError (invalid/expired token).
vi.mock('../src/fetch-recipe-catalog', () => ({
  createRecipeCatalogTransport: () => () => Promise.reject(new ApiError(401)),
  fetchRecipeCatalog: (transport: () => Promise<unknown>): Promise<unknown> =>
    transport(),
}));

// Spy on the Keychain clear; the real clearTokenOnUnauthorized drives it.
const clearAuthTokenMock = vi.fn<[], Promise<void>>(() => Promise.resolve());
vi.mock('../src/storage/auth-token-storage', () => ({
  clearAuthToken: (): Promise<void> => clearAuthTokenMock(),
}));

import CatalogTab from '../app/(generate)/(tabs)/catalog';

function findHostByTestId(
  tree: TestRenderer.ReactTestRenderer,
  testID: string,
): boolean {
  return (
    tree.root.findAll(
      (node) => typeof node.type === 'string' && node.props?.testID === testID,
    ).length > 0
  );
}

async function renderTab(): Promise<TestRenderer.ReactTestRenderer> {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(React.createElement(CatalogTab));
  });
  // Flush the mount effect's microtasks (getAuthToken → fetch → catch).
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  if (!tree) throw new Error('renderTab: tree not created');
  return tree;
}

describe('catalog tab — auth self-heal on 401', () => {
  beforeEach(() => {
    clearAuthTokenMock.mockClear();
  });

  it('clears the persisted token and shows the error state when the fetch 401s', async () => {
    const tree = await renderTab();
    expect(clearAuthTokenMock).toHaveBeenCalledTimes(1);
    expect(findHostByTestId(tree, 'recipe-catalog-error')).toBe(true);
  });
});
