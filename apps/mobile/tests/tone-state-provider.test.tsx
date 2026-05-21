/**
 * Unit test — ToneStateProvider (Phase 3.3 Sub-AC 6+7).
 *
 * Pins:
 *   1. First-install: source==='diagnosis-default', current = the
 *      injected first-install diagnosis season.
 *   2. Persisted-restore: when readLastTone resolves with a Season,
 *      provider transitions to source==='user-switched' with the
 *      restored value.
 *   3. setTone updates the atom synchronously and writes through to
 *      AsyncStorage.
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
import { act, render, waitFor } from '@testing-library/react-native';

import type { Season } from '../src/contracts/post-payment-views';
import {
  ToneStateProvider,
  useToneState,
} from '../src/providers/ToneStateProvider';

function ToneProbe(): React.ReactElement {
  const { current, source, setTone } = useToneState();
  return (
    <>
      <Text testID="current">{current}</Text>
      <Text testID="source">{source}</Text>
      <Text testID="setter" onPress={() => setTone('autumn-warm')}>
        switch
      </Text>
    </>
  );
}

describe('ToneStateProvider', () => {
  it('first install — surfaces injected diagnosis season as diagnosis-default', async () => {
    const reader = vi.fn(async () => null as Season | null);
    const writer = vi.fn(async () => undefined);

    const { getByTestId } = render(
      <ToneStateProvider
        _readLastTone={reader}
        _writeLastTone={writer}
        _initialDiagnosisSeason="spring-warm"
      >
        <ToneProbe />
      </ToneStateProvider>,
    );

    await waitFor(() => expect(reader).toHaveBeenCalledTimes(1));
    expect(getByTestId('current').children[0]).toBe('spring-warm');
    expect(getByTestId('source').children[0]).toBe('diagnosis-default');
  });

  it('persisted-restore — surfaces stored season as user-switched', async () => {
    const reader = vi.fn(async () => 'winter-cool' as Season | null);
    const writer = vi.fn(async () => undefined);

    const { getByTestId } = render(
      <ToneStateProvider
        _readLastTone={reader}
        _writeLastTone={writer}
        _initialDiagnosisSeason="summer-cool"
      >
        <ToneProbe />
      </ToneStateProvider>,
    );

    await waitFor(() =>
      expect(getByTestId('current').children[0]).toBe('winter-cool'),
    );
    expect(getByTestId('source').children[0]).toBe('user-switched');
  });

  it('setTone updates the atom synchronously and writes through to storage', async () => {
    const reader = vi.fn(async () => null as Season | null);
    const writer = vi.fn(async () => undefined);

    const { getByTestId } = render(
      <ToneStateProvider
        _readLastTone={reader}
        _writeLastTone={writer}
        _initialDiagnosisSeason="summer-cool"
      >
        <ToneProbe />
      </ToneStateProvider>,
    );

    await waitFor(() => expect(reader).toHaveBeenCalled());
    act(() => {
      getByTestId('setter').props.onPress();
    });

    expect(getByTestId('current').children[0]).toBe('autumn-warm');
    expect(getByTestId('source').children[0]).toBe('user-switched');
    expect(writer).toHaveBeenCalledWith('autumn-warm');
  });

  it('useToneState throws when used outside provider', () => {
    // Suppress React's error boundary console.error noise for this expected throw.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<ToneProbe />)).toThrow(
      /useToneState must be used inside <ToneStateProvider>/,
    );
    errSpy.mockRestore();
  });
});
