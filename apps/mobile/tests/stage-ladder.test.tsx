/**
 * Unit test — `apps/mobile/src/components/StageLadder.tsx` shared progress
 * ladder (Phase 6.2).
 *
 * What this test pins (behavioural assertions only — no snapshots):
 *   1. Renders exactly one row per `items` entry, in order, with each row's
 *      label text equal to the item's `label`.
 *   2. Normalises the tolerant item shape: `state`, `status`, and
 *      `isActive` / `isDone` booleans all resolve to the same row state.
 *   3. Marks the active row (and only it) with
 *      `accessibilityState.selected === true`.
 *   4. Picks the documented token colour per state (coral for reached rows,
 *      grayscale-disabled for pending rows) — zero new hex values.
 *   5. Forwards `ariaLive` → `accessibilityLiveRegion` (`off` → `none`).
 *   6. Renders a `${progress}%` readout when `progress` is supplied and omits
 *      it entirely when it is not; clamps out-of-range values.
 *   7. Re-roots every testID under a custom `testIDPrefix`.
 *
 * Why react-test-renderer + the same `vi.mock('react-native')` shape as the
 * sibling component tests: see guide-list.test.tsx for the full rationale.
 */
import * as React from 'react';
import TestRenderer from 'react-test-renderer';
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
    TextInput: makeHost('TextInput'),
    Image: makeHost('Image'),
    Switch: makeHost('Switch'),
    ScrollView: makeHost('ScrollView'),
    Modal: makeHost('Modal'),
    StyleSheet: {
      create: (s: Record<string, unknown>): Record<string, unknown> => s,
      flatten: (s: unknown): unknown => {
        // Mirror RN's flatten: collapse an array of style objects into one.
        if (Array.isArray(s)) {
          return s.reduce(
            (acc: Record<string, unknown>, cur) =>
              cur ? { ...acc, ...(cur as Record<string, unknown>) } : acc,
            {},
          );
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
  StageLadder,
  resolveItemState,
  type StageLadderItem,
} from '../src/components/StageLadder';
import { COLORS } from '../src/theme';

interface TestInstance {
  readonly type: unknown;
  readonly props: Record<string, unknown>;
  readonly children: readonly (TestInstance | string)[];
}

function findAllByTestId(
  tree: TestRenderer.ReactTestRenderer,
  testID: string,
): readonly TestInstance[] {
  return tree.root.findAll(
    (node) => typeof node.type === 'string' && node.props?.testID === testID,
  ) as unknown as readonly TestInstance[];
}

function getByTestId(
  tree: TestRenderer.ReactTestRenderer,
  testID: string,
): TestInstance {
  const matches = findAllByTestId(tree, testID);
  if (matches.length !== 1) {
    throw new Error(`getByTestId('${testID}'): ${matches.length} matches (expected 1)`);
  }
  return matches[0] as TestInstance;
}

function render(element: React.ReactElement): TestRenderer.ReactTestRenderer {
  return TestRenderer.create(element);
}

/** Flatten the array-or-object style prop into a single object for assertions. */
function flatStyle(node: TestInstance): Record<string, unknown> {
  const style = node.props.style;
  if (Array.isArray(style)) {
    return style.reduce(
      (acc: Record<string, unknown>, cur) =>
        cur ? { ...acc, ...(cur as Record<string, unknown>) } : acc,
      {},
    );
  }
  return (style as Record<string, unknown>) ?? {};
}

const LOADER_ITEMS: readonly StageLadderItem[] = [
  { label: '얼굴 인식', status: 'done' },
  { label: '피부 톤 측정', status: 'active' },
  { label: '컬러 매칭', status: 'pending' },
];

describe('StageLadder — row rendering (1:1, in order)', () => {
  it('renders exactly one row per item', () => {
    const tree = render(
      React.createElement(StageLadder, {
        items: LOADER_ITEMS,
        testIDPrefix: 'ladder',
      }),
    );
    const rows = tree.root.findAll(
      (node) =>
        typeof node.type === 'string' &&
        typeof node.props?.testID === 'string' &&
        /^ladder-item-\d+$/.test(node.props.testID as string),
    );
    expect(rows.length).toBe(3);
  });

  it('renders each row label in order', () => {
    const tree = render(
      React.createElement(StageLadder, {
        items: LOADER_ITEMS,
        testIDPrefix: 'ladder',
      }),
    );
    expect(getByTestId(tree, 'ladder-item-0-label').props.children).toBe('얼굴 인식');
    expect(getByTestId(tree, 'ladder-item-1-label').props.children).toBe(
      '피부 톤 측정',
    );
    expect(getByTestId(tree, 'ladder-item-2-label').props.children).toBe('컬러 매칭');
  });
});

describe('StageLadder — item-state normalisation', () => {
  it('resolveItemState prioritises explicit `state`', () => {
    expect(resolveItemState({ label: 'x', state: 'done', status: 'pending' })).toBe(
      'done',
    );
  });

  it('resolveItemState falls back to core-ts `status`', () => {
    expect(resolveItemState({ label: 'x', status: 'active' })).toBe('active');
  });

  it('resolveItemState derives from isActive / isDone booleans', () => {
    expect(resolveItemState({ label: 'x', isActive: true })).toBe('active');
    expect(resolveItemState({ label: 'x', isDone: true })).toBe('done');
  });

  it('resolveItemState defaults to pending', () => {
    expect(resolveItemState({ label: 'x' })).toBe('pending');
  });

  it('renders identically whether fed `state` or `status`', () => {
    const viaState = render(
      React.createElement(StageLadder, {
        items: [{ label: '측정', state: 'active' }],
        testIDPrefix: 'a',
      }),
    );
    const viaStatus = render(
      React.createElement(StageLadder, {
        items: [{ label: '측정', status: 'active' }],
        testIDPrefix: 'b',
      }),
    );
    expect(getByTestId(viaState, 'a-item-0').props.accessibilityState).toEqual({
      selected: true,
    });
    expect(getByTestId(viaStatus, 'b-item-0').props.accessibilityState).toEqual({
      selected: true,
    });
  });
});

describe('StageLadder — accessibility', () => {
  it('marks only the active row as selected', () => {
    const tree = render(
      React.createElement(StageLadder, {
        items: LOADER_ITEMS,
        testIDPrefix: 'ladder',
      }),
    );
    expect(getByTestId(tree, 'ladder-item-0').props.accessibilityState).toEqual({
      selected: false,
    });
    expect(getByTestId(tree, 'ladder-item-1').props.accessibilityState).toEqual({
      selected: true,
    });
    expect(getByTestId(tree, 'ladder-item-2').props.accessibilityState).toEqual({
      selected: false,
    });
  });

  it('forwards each row label as accessibilityLabel', () => {
    const tree = render(
      React.createElement(StageLadder, {
        items: LOADER_ITEMS,
        testIDPrefix: 'ladder',
      }),
    );
    expect(getByTestId(tree, 'ladder-item-1').props.accessibilityLabel).toBe(
      '피부 톤 측정',
    );
  });

  it('maps ariaLive=polite to accessibilityLiveRegion=polite', () => {
    const tree = render(
      React.createElement(StageLadder, {
        items: LOADER_ITEMS,
        ariaLive: 'polite',
        testIDPrefix: 'ladder',
      }),
    );
    expect(getByTestId(tree, 'ladder').props.accessibilityLiveRegion).toBe('polite');
  });

  it('maps ariaLive=assertive to accessibilityLiveRegion=assertive', () => {
    const tree = render(
      React.createElement(StageLadder, {
        items: LOADER_ITEMS,
        ariaLive: 'assertive',
        testIDPrefix: 'ladder',
      }),
    );
    expect(getByTestId(tree, 'ladder').props.accessibilityLiveRegion).toBe('assertive');
  });

  it('maps ariaLive=off to accessibilityLiveRegion=none', () => {
    const tree = render(
      React.createElement(StageLadder, {
        items: LOADER_ITEMS,
        ariaLive: 'off',
        testIDPrefix: 'ladder',
      }),
    );
    expect(getByTestId(tree, 'ladder').props.accessibilityLiveRegion).toBe('none');
  });
});

describe('StageLadder — token colours (zero new hex)', () => {
  it('colours done labels with grayscale.disabled', () => {
    const tree = render(
      React.createElement(StageLadder, {
        items: LOADER_ITEMS,
        testIDPrefix: 'ladder',
      }),
    );
    // item-0 ('얼굴 인식') is `done` — a completed stage recedes into the muted
    // grayscale.disabled tone so the active row remains the focal point.
    expect(flatStyle(getByTestId(tree, 'ladder-item-0-label')).color).toBe(
      COLORS.grayscale.disabled,
    );
  });

  it('colours the active label with base.coral in bold weight', () => {
    const tree = render(
      React.createElement(StageLadder, {
        items: LOADER_ITEMS,
        testIDPrefix: 'ladder',
      }),
    );
    // item-1 ('피부 톤 측정') is `active` — the in-progress focal row.
    const activeLabel = flatStyle(getByTestId(tree, 'ladder-item-1-label'));
    expect(activeLabel.color).toBe(COLORS.base.coral);
    expect(activeLabel.fontWeight).toBe('700');
  });

  it('keeps non-active labels at the regular (400) weight', () => {
    const tree = render(
      React.createElement(StageLadder, {
        items: LOADER_ITEMS,
        testIDPrefix: 'ladder',
      }),
    );
    // done (item-0) and pending (item-2) inherit the body.regular weight,
    // so only the active row is emphasised.
    expect(flatStyle(getByTestId(tree, 'ladder-item-0-label')).fontWeight).toBe('400');
    expect(flatStyle(getByTestId(tree, 'ladder-item-2-label')).fontWeight).toBe('400');
  });

  it('drives active colour purely from item state (state vs status agree)', () => {
    const viaState = render(
      React.createElement(StageLadder, {
        items: [{ label: '측정', state: 'active' }],
        testIDPrefix: 'a',
      }),
    );
    const viaStatus = render(
      React.createElement(StageLadder, {
        items: [{ label: '측정', status: 'active' }],
        testIDPrefix: 'b',
      }),
    );
    expect(flatStyle(getByTestId(viaState, 'a-item-0-label')).color).toBe(
      COLORS.base.coral,
    );
    expect(flatStyle(getByTestId(viaStatus, 'b-item-0-label')).color).toBe(
      COLORS.base.coral,
    );
  });

  it('colours pending labels with grayscale.disabled', () => {
    const tree = render(
      React.createElement(StageLadder, {
        items: LOADER_ITEMS,
        testIDPrefix: 'ladder',
      }),
    );
    expect(flatStyle(getByTestId(tree, 'ladder-item-2-label')).color).toBe(
      COLORS.grayscale.disabled,
    );
  });
});

describe('StageLadder — done-state checkmark marker', () => {
  // LOADER_ITEMS[0] ('얼굴 인식') is the single `done` row, so the checkmark
  // glyph '✓ ' (U+2713 + space) appears exactly once in the rendered tree.
  function findCheckmarks(
    tree: TestRenderer.ReactTestRenderer,
  ): readonly TestInstance[] {
    return tree.root.findAll(
      (node) => typeof node.type === 'string' && node.props?.children === '✓ ',
    ) as unknown as readonly TestInstance[];
  }

  it('renders done rows with the checkmark prefix glyph (U+2713 + space)', () => {
    const tree = render(
      React.createElement(StageLadder, {
        items: LOADER_ITEMS,
        testIDPrefix: 'ladder',
      }),
    );
    const checks = findCheckmarks(tree);
    expect(checks).toHaveLength(1);
    expect(checks[0].props.children).toBe('✓ ');
  });

  it('colours the done checkmark with grayscale.disabled', () => {
    const tree = render(
      React.createElement(StageLadder, {
        items: LOADER_ITEMS,
        testIDPrefix: 'ladder',
      }),
    );
    expect(flatStyle(findCheckmarks(tree)[0]).color).toBe(COLORS.grayscale.disabled);
  });

  it('hides the decorative checkmark from screen readers', () => {
    const tree = render(
      React.createElement(StageLadder, {
        items: LOADER_ITEMS,
        testIDPrefix: 'ladder',
      }),
    );
    const glyph = findCheckmarks(tree)[0];
    expect(glyph.props.accessibilityElementsHidden).toBe(true);
    expect(glyph.props.importantForAccessibility).toBe('no');
  });

  it('renders no checkmark when no row is done', () => {
    const tree = render(
      React.createElement(StageLadder, {
        items: [
          { label: '측정', status: 'active' },
          { label: '대기', status: 'pending' },
        ],
        testIDPrefix: 'ladder',
      }),
    );
    expect(findCheckmarks(tree)).toHaveLength(0);
  });

  it('renders a checkmark per done row (multiple done rows)', () => {
    const tree = render(
      React.createElement(StageLadder, {
        items: [
          { label: '얼굴 인식', status: 'done' },
          { label: '피부 톤 측정', status: 'done' },
          { label: '컬러 매칭', status: 'active' },
        ],
        testIDPrefix: 'ladder',
      }),
    );
    expect(findCheckmarks(tree)).toHaveLength(2);
  });
});

describe('StageLadder — progress meter', () => {
  it('renders ${progress}% when progress is supplied', () => {
    const tree = render(
      React.createElement(StageLadder, {
        items: LOADER_ITEMS,
        progress: 40,
        testIDPrefix: 'ladder',
      }),
    );
    expect(getByTestId(tree, 'ladder-progress').props.children).toBe('40%');
  });

  it('omits the progress readout when progress is not supplied', () => {
    const tree = render(
      React.createElement(StageLadder, {
        items: LOADER_ITEMS,
        testIDPrefix: 'ladder',
      }),
    );
    expect(findAllByTestId(tree, 'ladder-progress')).toHaveLength(0);
  });

  it('clamps out-of-range progress into 0–100', () => {
    const over = render(
      React.createElement(StageLadder, {
        items: LOADER_ITEMS,
        progress: 150,
        testIDPrefix: 'hi',
      }),
    );
    const under = render(
      React.createElement(StageLadder, {
        items: LOADER_ITEMS,
        progress: -20,
        testIDPrefix: 'lo',
      }),
    );
    expect(getByTestId(over, 'hi-progress').props.children).toBe('100%');
    expect(getByTestId(under, 'lo-progress').props.children).toBe('0%');
  });
});

describe('StageLadder — testID prefixing', () => {
  it('re-roots all testIDs under the supplied prefix', () => {
    const tree = render(
      React.createElement(StageLadder, {
        items: LOADER_ITEMS,
        progress: 60,
        testIDPrefix: 'scan-animation-ladder',
      }),
    );
    expect(getByTestId(tree, 'scan-animation-ladder')).toBeTruthy();
    expect(getByTestId(tree, 'scan-animation-ladder-item-0')).toBeTruthy();
    expect(getByTestId(tree, 'scan-animation-ladder-progress')).toBeTruthy();
    // The generic prefix must NOT leak when a custom one is supplied.
    expect(findAllByTestId(tree, 'ladder')).toHaveLength(0);
  });
});

describe('StageLadder — synthetic tri-state row contract (testID + label + style)', () => {
  // A single synthetic fixture exercising all three lifecycle states at once,
  // asserting the full per-row contract — testID wiring, accessibilityLabel
  // forwarding, and token-bound style — together for pending / active / done.
  // This is the focal AC: pure render, behavioural assertions, zero snapshots.
  const TRI_STATE: readonly StageLadderItem[] = [
    { label: '대기 단계', state: 'pending' },
    { label: '진행 단계', state: 'active' },
    { label: '완료 단계', state: 'done' },
  ];

  function renderTriState(): TestRenderer.ReactTestRenderer {
    return render(
      React.createElement(StageLadder, {
        items: TRI_STATE,
        testIDPrefix: 'tri',
      }),
    );
  }

  it('pending row: testID + accessibilityLabel + grayscale.disabled label', () => {
    const tree = renderTriState();
    const row = getByTestId(tree, 'tri-item-0');
    const label = getByTestId(tree, 'tri-item-0-label');
    expect(row).toBeTruthy();
    expect(row.props.accessibilityLabel).toBe('대기 단계');
    expect(row.props.accessibilityState).toEqual({ selected: false });
    expect(label.props.children).toBe('대기 단계');
    expect(flatStyle(label).color).toBe(COLORS.grayscale.disabled);
    expect(flatStyle(label).fontWeight).toBe('400');
  });

  it('active row: testID + accessibilityLabel + base.coral bold label', () => {
    const tree = renderTriState();
    const row = getByTestId(tree, 'tri-item-1');
    const label = getByTestId(tree, 'tri-item-1-label');
    expect(row.props.accessibilityLabel).toBe('진행 단계');
    expect(row.props.accessibilityState).toEqual({ selected: true });
    expect(label.props.children).toBe('진행 단계');
    expect(flatStyle(label).color).toBe(COLORS.base.coral);
    expect(flatStyle(label).fontWeight).toBe('700');
  });

  it('done row: testID + accessibilityLabel + grayscale.disabled label', () => {
    const tree = renderTriState();
    const row = getByTestId(tree, 'tri-item-2');
    const label = getByTestId(tree, 'tri-item-2-label');
    expect(row.props.accessibilityLabel).toBe('완료 단계');
    expect(row.props.accessibilityState).toEqual({ selected: false });
    expect(label.props.children).toBe('완료 단계');
    expect(flatStyle(label).color).toBe(COLORS.grayscale.disabled);
    expect(flatStyle(label).fontWeight).toBe('400');
  });

  it('keeps the three synthetic rows disjoint and in order under the prefix', () => {
    const tree = renderTriState();
    const rows = tree.root.findAll(
      (node) =>
        typeof node.type === 'string' &&
        typeof node.props?.testID === 'string' &&
        /^tri-item-\d+$/.test(node.props.testID as string),
    );
    expect(rows.map((r) => (r.props as { testID: string }).testID)).toEqual([
      'tri-item-0',
      'tri-item-1',
      'tri-item-2',
    ]);
  });
});

describe('StageLadder — pending glyph colour (grayscale.border)', () => {
  it('renders the pending row ○ marker in COLORS.grayscale.border', () => {
    const tree = render(
      React.createElement(StageLadder, {
        items: LOADER_ITEMS,
        testIDPrefix: 'ladder',
      }),
    );
    // item-2 ('컬러 매칭') is the only `pending` row in the fixture; its ○
    // outline marker must render in the light `border` token — a faint
    // hairline cue, distinct from the muted `disabled` label beside it, with
    // zero new hex values introduced.
    const glyphNodes = tree.root.findAll(
      (node) =>
        typeof node.type === 'string' &&
        node.type === 'Text' &&
        node.props?.children === '\u25CB',
    ) as unknown as readonly TestInstance[];
    expect(glyphNodes).toHaveLength(1);
    expect(flatStyle(glyphNodes[0]).color).toBe(COLORS.grayscale.border);
  });

  it('uses the border token (not disabled) for the pending glyph', () => {
    const tree = render(
      React.createElement(StageLadder, {
        items: LOADER_ITEMS,
        testIDPrefix: 'ladder',
      }),
    );
    const glyph = tree.root.findAll(
      (node) =>
        typeof node.type === 'string' &&
        node.type === 'Text' &&
        node.props?.children === '\u25CB',
    )[0] as unknown as TestInstance;
    const color = flatStyle(glyph).color;
    expect(color).toBe(COLORS.grayscale.border);
    expect(color).not.toBe(COLORS.grayscale.disabled);
  });
});
