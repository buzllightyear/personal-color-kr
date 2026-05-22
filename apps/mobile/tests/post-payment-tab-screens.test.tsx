/**
 * Unit test — 4 (post-payment)/(tabs)/*.tsx screens (Phase 3.3 Sub-AC 10).
 *
 * Pins exhaustive DataHook-state handling per screen:
 *   - state === 'loading' → renders <Skeleton testID="post-payment-skeleton" />
 *   - state === 'error'   → renders <ErrorRetry testID="post-payment-error-retry" />
 *   - state === 'ready'   → renders the screen body with its tone-keyed payload
 *
 * Strategy: each screen consumes a single hook (useEditContent /
 * useDiagnosisContent / useGuideContent / useCurationContent). We mock
 * those hooks per-test to force each of the 3 states, and verify the
 * correct render branch fires. The ToneStateProvider is mounted with
 * an injected season so the screens render deterministically.
 */
import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  };
});

import { render } from '@testing-library/react-native';

import { ToneStateProvider } from '../src/providers/ToneStateProvider';

// PostHog mock — every tab fires `post_payment_tab_viewed` on mount.
const captureFn = vi.fn();
vi.mock('posthog-react-native', () => ({
  usePostHog: () => ({ capture: captureFn }),
}));

// Hook mocks — switchable per-test by reassigning the returned value.
const diagnosisHook = vi.fn();
vi.mock('../src/hooks/use-diagnosis-content', () => ({
  useDiagnosisContent: () => diagnosisHook(),
}));

const editHook = vi.fn();
vi.mock('../src/hooks/use-edit-content', () => ({
  useEditContent: () => editHook(),
}));

const guideHook = vi.fn();
vi.mock('../src/hooks/use-guide-content', () => ({
  useGuideContent: () => guideHook(),
}));

const curationHook = vi.fn();
vi.mock('../src/hooks/use-curation-content', () => ({
  useCurationContent: () => curationHook(),
}));

// Imports AFTER mocks register.
import CurationTab from '../app/(post-payment)/(tabs)/curation';
import DiagnosisTab from '../app/(post-payment)/(tabs)/diagnosis';
import EditTab from '../app/(post-payment)/(tabs)/edit';
import GuideTab from '../app/(post-payment)/(tabs)/guide';

function wrap(child: React.ReactElement): React.ReactElement {
  return (
    <ToneStateProvider
      _readLastTone={async () => null}
      _writeLastTone={async () => undefined}
      _initialDiagnosisSeason="summer-cool"
    >
      {child}
    </ToneStateProvider>
  );
}

describe('Edit tab — 3-state DataHook handling', () => {
  beforeEach(() => {
    captureFn.mockReset();
    editHook.mockReset();
  });

  it('loading → renders <Skeleton>', () => {
    editHook.mockReturnValue({ state: 'loading', data: null });
    const { getByTestId, queryByTestId } = render(wrap(<EditTab />));
    expect(getByTestId('post-payment-skeleton')).toBeTruthy();
    expect(queryByTestId('post-payment-tab-edit')).toBeNull();
  });

  it('error → renders <ErrorRetry>', () => {
    editHook.mockReturnValue({ state: 'error', data: null });
    const { getByTestId } = render(wrap(<EditTab />));
    expect(getByTestId('post-payment-error-retry')).toBeTruthy();
  });

  it('ready → renders the edit body and emits post_payment_tab_viewed', () => {
    editHook.mockReturnValue({
      state: 'ready',
      data: {
        season: 'summer-cool',
        previewImageUrl: 'https://placeholder.invalid/preview/summer-cool.jpg',
        caption: 'cap',
        vendorName: 'Fal.ai',
        categoryLine: '편1',
        ctaMicrocopy: '편2',
      },
    });
    const { getByTestId } = render(wrap(<EditTab />));
    expect(getByTestId('post-payment-tab-edit')).toBeTruthy();
    expect(captureFn).toHaveBeenCalledWith('post_payment_tab_viewed', {
      tab: 'edit',
    });
  });
});

describe('Diagnosis tab — 3-state DataHook handling', () => {
  beforeEach(() => {
    captureFn.mockReset();
    diagnosisHook.mockReset();
  });

  it('loading', () => {
    diagnosisHook.mockReturnValue({ state: 'loading', data: null });
    const { getByTestId } = render(wrap(<DiagnosisTab />));
    expect(getByTestId('post-payment-skeleton')).toBeTruthy();
  });

  it('error', () => {
    diagnosisHook.mockReturnValue({ state: 'error', data: null });
    const { getByTestId } = render(wrap(<DiagnosisTab />));
    expect(getByTestId('post-payment-error-retry')).toBeTruthy();
  });

  it('ready', () => {
    diagnosisHook.mockReturnValue({
      state: 'ready',
      data: {
        season: 'summer-cool',
        koreanLabel: '여름쿨',
        confidence: 0.85,
        toneLabel: '쿨톤',
        contrastLabel: '저대비',
        categoryLine: '진1',
      },
    });
    const { getByTestId } = render(wrap(<DiagnosisTab />));
    expect(getByTestId('post-payment-tab-diagnosis')).toBeTruthy();
    expect(captureFn).toHaveBeenCalledWith('post_payment_tab_viewed', {
      tab: 'diagnosis',
    });
  });
});

describe('Guide tab — 3-state DataHook handling', () => {
  beforeEach(() => {
    captureFn.mockReset();
    guideHook.mockReset();
  });

  it('loading', () => {
    guideHook.mockReturnValue({ state: 'loading', data: null });
    const { getByTestId } = render(wrap(<GuideTab />));
    expect(getByTestId('post-payment-skeleton')).toBeTruthy();
  });

  it('error', () => {
    guideHook.mockReturnValue({ state: 'error', data: null });
    const { getByTestId } = render(wrap(<GuideTab />));
    expect(getByTestId('post-payment-error-retry')).toBeTruthy();
  });

  it('ready', () => {
    guideHook.mockReturnValue({
      state: 'ready',
      data: {
        season: 'summer-cool',
        tiles: [{ id: 't1', title: 'T1', body: 'B1' }],
        guideLines: ['지1', '지2', '지3', '지4'],
      },
    });
    const { getByTestId } = render(wrap(<GuideTab />));
    expect(getByTestId('post-payment-tab-guide')).toBeTruthy();
    expect(captureFn).toHaveBeenCalledWith('post_payment_tab_viewed', {
      tab: 'guide',
    });
  });
});

describe('Curation tab — 3-state DataHook handling', () => {
  beforeEach(() => {
    captureFn.mockReset();
    curationHook.mockReset();
  });

  it('loading', () => {
    curationHook.mockReturnValue({ state: 'loading', data: null });
    const { getByTestId } = render(wrap(<CurationTab />));
    expect(getByTestId('post-payment-skeleton')).toBeTruthy();
  });

  it('error', () => {
    curationHook.mockReturnValue({ state: 'error', data: null });
    const { getByTestId } = render(wrap(<CurationTab />));
    expect(getByTestId('post-payment-error-retry')).toBeTruthy();
  });

  it('ready', () => {
    curationHook.mockReturnValue({
      state: 'ready',
      data: {
        season: 'summer-cool',
        items: [
          { id: 'c1', name: 'I1', blurb: 'B1', toneTag: 'T1' },
          { id: 'c2', name: 'I2', blurb: 'B2', toneTag: 'T2' },
          { id: 'c3', name: 'I3', blurb: 'B3', toneTag: 'T3' },
          { id: 'c4', name: 'I4', blurb: 'B4', toneTag: 'T4' },
        ],
        recommendationLines: ['헤1', '서1', '아1', '아2', '아3', '아4'],
      },
    });
    const { getByTestId } = render(wrap(<CurationTab />));
    expect(getByTestId('post-payment-tab-curation')).toBeTruthy();
    expect(captureFn).toHaveBeenCalledWith('post_payment_tab_viewed', {
      tab: 'curation',
    });
  });
});
