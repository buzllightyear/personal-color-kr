/**
 * Unit test — `RecipeCatalogScreen` presentational component
 * (Content Generation Phase, Sub-AC 2).
 *
 * The screen is a pure props-in / callbacks-out component: no network I/O,
 * no expo-router, no expo modules. Tests pass recipe data directly as props
 * — the "stub API client" requirement means we never call the real
 * `fetchRecipeCatalog` / `createRecipeCatalogTransport` inside these tests;
 * those are exercised separately in `fetch-recipe-catalog.test.ts`.
 *
 * Assertions per the Sub-AC contract:
 *   1. Render — recipes are displayed; each card surfaces the recipe ID.
 *   2. Sort display — cards appear in ascending `displayOrder` order
 *      regardless of the prop array ordering.
 *   3. Selection handler — tapping a recipe card invokes `onSelectRecipe`
 *      with the correct `recipeId`.
 *   4. Loading state — renders the loading placeholder when `loading=true`.
 *   5. Error state — renders the error fallback when `error=true`.
 *   6. Empty state — renders the empty message when `recipes=[]`.
 */
import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// react-native ESM mock (standard pattern — see diagnosis-input-screen.test.tsx)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Import AFTER mocks are registered
// ---------------------------------------------------------------------------
import {
  RecipeCatalogScreen,
  type RecipeCatalogScreenProps,
} from '../src/screens/generate/RecipeCatalogScreen';
import type { CatalogRecipe } from '../src/fetch-recipe-catalog';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RECIPE_A: CatalogRecipe = {
  recipeId: 'summer-vibes',
  styleReferenceKey: 'styles/summer.jpg',
  publishDate: '2024-06-01T00:00:00Z',
  displayOrder: 1,
  createdAt: '2024-05-20T10:00:00Z',
};

const RECIPE_B: CatalogRecipe = {
  recipeId: 'winter-chic',
  styleReferenceKey: null,
  publishDate: '2024-06-01T00:00:00Z',
  displayOrder: 2,
  createdAt: '2024-05-18T08:00:00Z',
};

const RECIPE_C: CatalogRecipe = {
  recipeId: 'autumn-warm',
  styleReferenceKey: null,
  publishDate: '2024-05-01T00:00:00Z',
  displayOrder: 3,
  createdAt: '2024-04-15T09:00:00Z',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function findAllHostByTestIdPrefix(
  tree: TestRenderer.ReactTestRenderer,
  prefix: string,
): TestInstance[] {
  const matches = tree.root.findAll(
    (node) =>
      typeof node.type === 'string' &&
      typeof node.props?.testID === 'string' &&
      (node.props.testID as string).startsWith(prefix),
  );
  return matches as unknown as TestInstance[];
}

function render(element: React.ReactElement): TestRenderer.ReactTestRenderer {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  act(() => {
    tree = TestRenderer.create(element);
  });
  if (!tree) throw new Error('render: tree not created');
  return tree;
}

const NO_OP_SELECT = (_recipeId: string): void => undefined;

function makeProps(
  overrides: Partial<RecipeCatalogScreenProps> = {},
): RecipeCatalogScreenProps {
  return {
    recipes: [RECIPE_A, RECIPE_B],
    loading: false,
    error: false,
    onSelectRecipe: NO_OP_SELECT,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Loading state
// ---------------------------------------------------------------------------

describe('RecipeCatalogScreen — loading state', () => {
  it('renders the loading placeholder when loading=true', () => {
    const tree = render(
      React.createElement(RecipeCatalogScreen, makeProps({ loading: true })),
    );
    expect(findHostByTestId(tree, 'recipe-catalog-loading')).toBeTruthy();
    expect(findHostByTestId(tree, 'recipe-catalog-screen')).toBeNull();
  });

  it('does not render any recipe cards while loading', () => {
    const tree = render(
      React.createElement(RecipeCatalogScreen, makeProps({ loading: true })),
    );
    const cards = findAllHostByTestIdPrefix(tree, 'recipe-catalog-item-');
    expect(cards).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Error state
// ---------------------------------------------------------------------------

describe('RecipeCatalogScreen — error state', () => {
  it('renders the error fallback when error=true', () => {
    const tree = render(
      React.createElement(
        RecipeCatalogScreen,
        makeProps({ error: true, loading: false }),
      ),
    );
    expect(findHostByTestId(tree, 'recipe-catalog-error')).toBeTruthy();
    expect(findHostByTestId(tree, 'recipe-catalog-screen')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Empty state
// ---------------------------------------------------------------------------

describe('RecipeCatalogScreen — empty state', () => {
  it('renders the empty-state message when recipes is empty and not loading/error', () => {
    const tree = render(
      React.createElement(
        RecipeCatalogScreen,
        makeProps({ recipes: [], loading: false, error: false }),
      ),
    );
    expect(findHostByTestId(tree, 'recipe-catalog-empty')).toBeTruthy();
    expect(findHostByTestId(tree, 'recipe-catalog-screen')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. Render — recipe cards present
// ---------------------------------------------------------------------------

describe('RecipeCatalogScreen — render', () => {
  it('renders the root container when recipes are present', () => {
    const tree = render(React.createElement(RecipeCatalogScreen, makeProps()));
    expect(findHostByTestId(tree, 'recipe-catalog-screen')).toBeTruthy();
  });

  it('renders a card for each recipe in props', () => {
    const tree = render(
      React.createElement(
        RecipeCatalogScreen,
        makeProps({ recipes: [RECIPE_A, RECIPE_B, RECIPE_C] }),
      ),
    );
    expect(
      findHostByTestId(tree, `recipe-catalog-item-${RECIPE_A.recipeId}`),
    ).toBeTruthy();
    expect(
      findHostByTestId(tree, `recipe-catalog-item-${RECIPE_B.recipeId}`),
    ).toBeTruthy();
    expect(
      findHostByTestId(tree, `recipe-catalog-item-${RECIPE_C.recipeId}`),
    ).toBeTruthy();
  });

  it('renders the recipe ID as the card label text', () => {
    const tree = render(
      React.createElement(RecipeCatalogScreen, makeProps({ recipes: [RECIPE_A] })),
    );
    const label = findHostByTestId(tree, `recipe-catalog-label-${RECIPE_A.recipeId}`);
    expect(label).toBeTruthy();
    expect(label?.props.children).toBe(RECIPE_A.recipeId);
  });

  it('renders all recipe cards as Pressable host elements', () => {
    const tree = render(
      React.createElement(
        RecipeCatalogScreen,
        makeProps({ recipes: [RECIPE_A, RECIPE_B] }),
      ),
    );
    const cards = findAllHostByTestIdPrefix(tree, 'recipe-catalog-item-');
    expect(cards).toHaveLength(2);
    cards.forEach((card) => {
      expect(card.type).toBe('Pressable');
    });
  });
});

// ---------------------------------------------------------------------------
// 5. Sort display — sorted by displayOrder ascending
// ---------------------------------------------------------------------------

describe('RecipeCatalogScreen — sort display', () => {
  it('renders cards in ascending displayOrder when props arrive in that order', () => {
    const tree = render(
      React.createElement(
        RecipeCatalogScreen,
        makeProps({ recipes: [RECIPE_A, RECIPE_B, RECIPE_C] }),
      ),
    );
    const cards = findAllHostByTestIdPrefix(tree, 'recipe-catalog-item-');
    expect(cards).toHaveLength(3);
    // Each card's testID encodes the recipeId — verify order matches displayOrder
    const ids = cards.map((c) =>
      (c.props.testID as string).replace('recipe-catalog-item-', ''),
    );
    expect(ids).toEqual([
      RECIPE_A.recipeId, // displayOrder 1
      RECIPE_B.recipeId, // displayOrder 2
      RECIPE_C.recipeId, // displayOrder 3
    ]);
  });

  it('re-sorts to ascending displayOrder when props arrive in reverse order', () => {
    // Props delivered in reverse displayOrder order (3, 2, 1)
    const reversedRecipes: readonly CatalogRecipe[] = [RECIPE_C, RECIPE_B, RECIPE_A];
    const tree = render(
      React.createElement(RecipeCatalogScreen, makeProps({ recipes: reversedRecipes })),
    );
    const cards = findAllHostByTestIdPrefix(tree, 'recipe-catalog-item-');
    expect(cards).toHaveLength(3);
    const ids = cards.map((c) =>
      (c.props.testID as string).replace('recipe-catalog-item-', ''),
    );
    // Must be sorted ascending by displayOrder: 1, 2, 3
    expect(ids).toEqual([
      RECIPE_A.recipeId, // displayOrder 1
      RECIPE_B.recipeId, // displayOrder 2
      RECIPE_C.recipeId, // displayOrder 3
    ]);
  });

  it('re-sorts when displayOrder values are non-contiguous', () => {
    const recipeX: CatalogRecipe = {
      ...RECIPE_A,
      recipeId: 'recipe-x',
      displayOrder: 10,
    };
    const recipeY: CatalogRecipe = {
      ...RECIPE_B,
      recipeId: 'recipe-y',
      displayOrder: 5,
    };
    const recipeZ: CatalogRecipe = {
      ...RECIPE_C,
      recipeId: 'recipe-z',
      displayOrder: 99,
    };
    // Prop order: 10, 5, 99
    const tree = render(
      React.createElement(
        RecipeCatalogScreen,
        makeProps({ recipes: [recipeX, recipeY, recipeZ] }),
      ),
    );
    const cards = findAllHostByTestIdPrefix(tree, 'recipe-catalog-item-');
    const ids = cards.map((c) =>
      (c.props.testID as string).replace('recipe-catalog-item-', ''),
    );
    // Must be sorted ascending: 5, 10, 99
    expect(ids).toEqual(['recipe-y', 'recipe-x', 'recipe-z']);
  });

  it('does not mutate the incoming recipes prop array', () => {
    // Immutability: the sort must produce a new array, not mutate props
    const input: CatalogRecipe[] = [RECIPE_C, RECIPE_A, RECIPE_B];
    const snapshot = [...input];
    render(React.createElement(RecipeCatalogScreen, makeProps({ recipes: input })));
    // Original array order must be unchanged after render
    expect(input).toEqual(snapshot);
  });
});

// ---------------------------------------------------------------------------
// 6. Selection handler — onSelectRecipe called with correct recipeId
// ---------------------------------------------------------------------------

describe('RecipeCatalogScreen — selection handler', () => {
  it('invokes onSelectRecipe with the recipe ID when a card is pressed', () => {
    const onSelectRecipe = vi.fn<[string], void>();
    const tree = render(
      React.createElement(RecipeCatalogScreen, makeProps({ onSelectRecipe })),
    );
    const card = findHostByTestId(tree, `recipe-catalog-item-${RECIPE_A.recipeId}`);
    expect(card).toBeTruthy();
    const onPress = card?.props.onPress as () => void;
    expect(typeof onPress).toBe('function');
    act(() => onPress());
    expect(onSelectRecipe).toHaveBeenCalledTimes(1);
    expect(onSelectRecipe).toHaveBeenCalledWith(RECIPE_A.recipeId);
  });

  it('invokes onSelectRecipe with the correct ID for each card independently', () => {
    const onSelectRecipe = vi.fn<[string], void>();
    const tree = render(
      React.createElement(
        RecipeCatalogScreen,
        makeProps({ recipes: [RECIPE_A, RECIPE_B], onSelectRecipe }),
      ),
    );

    const cardB = findHostByTestId(tree, `recipe-catalog-item-${RECIPE_B.recipeId}`);
    expect(cardB).toBeTruthy();
    const onPressB = cardB?.props.onPress as () => void;
    act(() => onPressB());
    expect(onSelectRecipe).toHaveBeenCalledWith(RECIPE_B.recipeId);
    expect(onSelectRecipe).toHaveBeenCalledTimes(1);

    onSelectRecipe.mockClear();

    const cardA = findHostByTestId(tree, `recipe-catalog-item-${RECIPE_A.recipeId}`);
    const onPressA = cardA?.props.onPress as () => void;
    act(() => onPressA());
    expect(onSelectRecipe).toHaveBeenCalledWith(RECIPE_A.recipeId);
    expect(onSelectRecipe).toHaveBeenCalledTimes(1);
  });

  it('each card has accessibilityRole="button"', () => {
    const tree = render(
      React.createElement(
        RecipeCatalogScreen,
        makeProps({ recipes: [RECIPE_A, RECIPE_B] }),
      ),
    );
    const cards = findAllHostByTestIdPrefix(tree, 'recipe-catalog-item-');
    cards.forEach((card) => {
      expect(card.props.accessibilityRole).toBe('button');
    });
  });
});
