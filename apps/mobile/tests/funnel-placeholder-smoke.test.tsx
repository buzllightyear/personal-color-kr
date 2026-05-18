/**
 * Smoke render test — AC 8.
 *
 * Renders the shared `FunnelPlaceholder` component once for every funnel
 * step id and asserts:
 *   1. It does not throw / does render some output.
 *   2. The "Step N of 12" counter matches the canonical 1-based index.
 *   3. The kebab subtitle equals the snake-id's kebab transform.
 *
 * Why the shared component (not each screen file):
 *   The Expo Router default exports import `useRouter` / `useLocalSearchParams`
 *   which require an Expo Router context the unit-test environment does not
 *   provide. The screen files are themselves thin wrappers that hand a
 *   `stepId` (and optionally params + an `onNext`) to `FunnelPlaceholder`;
 *   exercising the placeholder directly hits the same render path without
 *   the router-mock surface area.
 *
 * Together with the registry cross-check test
 * (`funnel-registry-cross-check.test.ts`), this pins both
 * "every kebab file exists" (registry completeness) and "every placeholder
 * renders sanely" (crash-free smoke) for all 12 v0.2 steps.
 */
import * as React from 'react';
import TestRenderer from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

// Mock `react-native` ESM entry to a minimal host-component set. The setup-rn-stub
// pre-populates Node's CJS require cache (which `@testing-library/react-native`'s
// helper modules use) but Vite's SSR transform resolves the placeholder's
// `import { View, Text, Pressable, StyleSheet } from 'react-native'` through
// the ESM path — which lands on the real `react-native/index.js` Flow file and
// fails the parse. Mocking here intercepts the ESM resolution with the same
// host-component shape the CJS stub provides.
vi.mock('react-native', async () => {
  const reactActual: any = await vi.importActual('react');
  const makeHost =
    (label: string) =>
    (props: any) =>
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
      flatten: (s: unknown): unknown => s,
    },
    Platform: { OS: 'ios', select: (m: any) => m.ios ?? m.default },
  };
});

// react-test-renderer-based queries — we avoid @testing-library/react-native here
// because its accessibility helpers require `StyleSheet.flatten` over a fuller
// stylesheet surface than our minimal `react-native` mock provides.

interface TestInstance {
  readonly props: Record<string, unknown>;
  findAllByProps: (filter: Record<string, unknown>) => readonly TestInstance[];
}

function makeQuery(tree: TestRenderer.ReactTestRenderer) {
  const root = tree.root;
  const findOne = (testID: string): TestInstance | null => {
    const matches = root.findAll((node) => node.props?.testID === testID);
    return (matches[0] as unknown as TestInstance) ?? null;
  };
  return {
    getByTestId(testID: string): TestInstance {
      const match = findOne(testID);
      if (!match) throw new Error(`getByTestId('${testID}'): no match`);
      return match;
    },
    queryByTestId(testID: string): TestInstance | null {
      return findOne(testID);
    },
  };
}

function render(element: React.ReactElement) {
  const tree = TestRenderer.create(element);
  return makeQuery(tree);
}

import {
  FUNNEL_STEPS_ORDERED,
  type FunnelStepId,
} from 'core-ts/funnel/types';

import {
  FUNNEL_KEBAB_SLUGS,
  toKebabSlug,
} from '../src/linking.config';
import { FunnelPlaceholder } from '../src/funnel-placeholder';

describe('FunnelPlaceholder — smoke render for all 12 v0.2 steps (AC 8)', () => {
  for (const stepId of FUNNEL_STEPS_ORDERED) {
    const expectedIndex = FUNNEL_STEPS_ORDERED.indexOf(stepId) + 1;
    const expectedKebab = FUNNEL_KEBAB_SLUGS[stepId];

    it(`renders ${stepId} (step ${expectedIndex}/12) without crashing`, () => {
      const result = render(
        React.createElement(FunnelPlaceholder, { stepId } as { stepId: FunnelStepId }),
      );
      const root = result.getByTestId('funnel-placeholder');
      expect(root).toBeTruthy();
    });

    it(`renders the canonical "Step ${expectedIndex} of 12" counter for ${stepId}`, () => {
      const result = render(
        React.createElement(FunnelPlaceholder, { stepId } as { stepId: FunnelStepId }),
      );
      const stepLabel = result.getByTestId('funnel-placeholder-step');
      expect(stepLabel.props.children).toBe(`Step ${expectedIndex} of 12`);
    });

    it(`renders /${expectedKebab} as the kebab subtitle for ${stepId}`, () => {
      const result = render(
        React.createElement(FunnelPlaceholder, { stepId } as { stepId: FunnelStepId }),
      );
      const kebabLabel = result.getByTestId('funnel-placeholder-kebab');
      expect(kebabLabel.props.children).toBe(`/${expectedKebab}`);
      // Defense-in-depth: the visible kebab must match the deterministic
      // toKebabSlug transform of the snake id.
      expect(expectedKebab).toBe(toKebabSlug(stepId));
    });
  }

  it('renders the (none) literal when no route params are passed', () => {
    const result = render(
      React.createElement(FunnelPlaceholder, { stepId: 'welcome_hook' }),
    );
    expect(result.getByTestId('funnel-placeholder-params-dump').props.children).toBe('(none)');
  });

  it('renders the live route params dump when params are passed', () => {
    const result = render(
      React.createElement(FunnelPlaceholder, {
        stepId: 'welcome_hook',
        routeParams: { utm_source: 'instagram', referrer_code: 'abc123' },
      }),
    );
    const dump = result.getByTestId('funnel-placeholder-params-dump').props.children as string;
    expect(dump).toContain('utm_source');
    expect(dump).toContain('"instagram"');
    expect(dump).toContain('referrer_code');
    expect(dump).toContain('"abc123"');
  });
});

describe('FunnelPlaceholder — share_token preview mode (AC 12)', () => {
  it('renders preview: false when isPreviewMode is false', () => {
    const result = render(
      React.createElement(FunnelPlaceholder, {
        stepId: 'result_reveal',
        isPreviewMode: false,
      }),
    );
    expect(result.getByTestId('funnel-placeholder-preview-flag').props.children).toBe('false');
  });

  it('renders preview: true when isPreviewMode is true (share_token branch)', () => {
    const result = render(
      React.createElement(FunnelPlaceholder, {
        stepId: 'result_reveal',
        isPreviewMode: true,
        routeParams: { share_token: 'opaque_token_xyz' },
      }),
    );
    expect(result.getByTestId('funnel-placeholder-preview-flag').props.children).toBe('true');
    const dump = result.getByTestId('funnel-placeholder-params-dump').props.children as string;
    expect(dump).toContain('share_token');
  });

  it('omits the preview row when isPreviewMode is not provided', () => {
    const result = render(
      React.createElement(FunnelPlaceholder, { stepId: 'value_props' }),
    );
    expect(result.queryByTestId('funnel-placeholder-preview-flag')).toBeNull();
  });
});

describe('FunnelPlaceholder — guard stub status surface (AC 11 fail-loud visibility)', () => {
  it('renders the guard name + value when guardStatus is provided', () => {
    const result = render(
      React.createElement(FunnelPlaceholder, {
        stepId: 'referral_gate',
        guardStatus: { name: 'shouldBypassReferral', value: false },
      }),
    );
    const text = result.getByTestId('funnel-placeholder-guard-status').props.children as string;
    expect(text).toBe('shouldBypassReferral → false (stub)');
  });

  it('omits the guard row when guardStatus is not provided', () => {
    const result = render(
      React.createElement(FunnelPlaceholder, { stepId: 'value_props' }),
    );
    expect(result.queryByTestId('funnel-placeholder-guard-status')).toBeNull();
  });
});
