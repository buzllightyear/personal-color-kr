/**
 * Phase 3.4 — provider-integration test (Seed AC 13).
 *
 * Exercises the contract: changing the global ToneState seasonal tone
 * causes a tab screen's wording slice (sourced from
 * `apps/mobile/src/wording/result-wording-catalog.ts`) to refresh on the
 * next render. We use the diagnosis tab's `categoryLine` slice as the
 * target — flipping the tone from 'spring-warm' to 'winter-cool' must
 * change the rendered category line accordingly.
 */
import * as React from 'react';
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
  };
});

import { Text } from 'react-native';
import { act, render } from '@testing-library/react-native';

import type { Season } from '../src/contracts/post-payment-views';
import { useDiagnosisContent } from '../src/hooks/use-diagnosis-content';
import {
  ToneStateProvider,
  useToneState,
} from '../src/providers/ToneStateProvider';
import { RESULT_WORDING_CATALOG } from '../src/wording/result-wording-catalog';

function WordingProbe(): React.ReactElement {
  const { current, setTone } = useToneState();
  const { data } = useDiagnosisContent(current);
  return (
    <>
      <Text testID="probe-category-line">{data?.categoryLine ?? ''}</Text>
      <Text
        testID="probe-set-winter"
        onPress={() => setTone('winter-cool')}
      >
        switch-to-winter
      </Text>
    </>
  );
}

describe('Phase 3.4 — tone change refreshes wording slice on the diagnosis tab (Seed AC 13)', () => {
  it('flipping ToneStateProvider.tone updates DiagnosisView.categoryLine to the new season catalog entry', async () => {
    const reader = vi.fn(async () => null as Season | null);
    const writer = vi.fn(async () => undefined);

    const { getByTestId } = render(
      <ToneStateProvider
        _readLastTone={reader}
        _writeLastTone={writer}
        _initialDiagnosisSeason="spring-warm"
      >
        <WordingProbe />
      </ToneStateProvider>,
    );

    // Initial render — spring-warm category line.
    expect(getByTestId('probe-category-line').props.children).toBe(
      RESULT_WORDING_CATALOG['spring-warm'].categoryLine,
    );

    await act(async () => {
      getByTestId('probe-set-winter').props.onPress();
    });

    // After tone switch — winter-cool category line is now rendered.
    expect(getByTestId('probe-category-line').props.children).toBe(
      RESULT_WORDING_CATALOG['winter-cool'].categoryLine,
    );
  });
});
