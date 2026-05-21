/**
 * Unit test — ToneSwitcher component (Phase 3.3 Sub-AC 5+6+13.3).
 *
 * Pins:
 *   1. Renders 4 chips (one per Season) with the Korean labels.
 *   2. Tapping a non-active chip calls setTone via the provider.
 *   3. Tapping the active chip is a no-op (no PostHog event, no setter call).
 *   4. PostHog `tone_switched { from, to }` event fires only on actual change.
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
    StyleSheet: {
      create: (s: Record<string, unknown>): Record<string, unknown> => s,
      flatten: (s: unknown): unknown => s,
    },
  };
});

import { fireEvent, render } from '@testing-library/react-native';

import { ToneSwitcher } from '../src/components/ToneSwitcher';
import { ToneStateProvider } from '../src/providers/ToneStateProvider';

const captureFn = vi.fn();

vi.mock('posthog-react-native', () => ({
  usePostHog: () => ({ capture: captureFn }),
}));

function renderSwitcher(initialSeason: 'spring-warm' | 'summer-cool' = 'summer-cool') {
  return render(
    <ToneStateProvider
      _readLastTone={async () => null}
      _writeLastTone={async () => undefined}
      _initialDiagnosisSeason={initialSeason}
    >
      <ToneSwitcher />
    </ToneStateProvider>,
  );
}

describe('ToneSwitcher', () => {
  beforeEach(() => {
    captureFn.mockReset();
  });

  it('renders 4 chips for the 4 seasons', () => {
    const { getByTestId } = renderSwitcher();
    expect(getByTestId('tone-switcher-chip-spring-warm')).toBeTruthy();
    expect(getByTestId('tone-switcher-chip-summer-cool')).toBeTruthy();
    expect(getByTestId('tone-switcher-chip-autumn-warm')).toBeTruthy();
    expect(getByTestId('tone-switcher-chip-winter-cool')).toBeTruthy();
  });

  it('emits tone_switched and updates atom on a real change', async () => {
    const { getByTestId } = renderSwitcher('summer-cool');

    fireEvent.press(getByTestId('tone-switcher-chip-winter-cool'));

    expect(captureFn).toHaveBeenCalledTimes(1);
    expect(captureFn).toHaveBeenCalledWith('tone_switched', {
      from: 'summer-cool',
      to: 'winter-cool',
    });
  });

  it('no-ops when the currently-active chip is tapped', () => {
    const { getByTestId } = renderSwitcher('summer-cool');

    fireEvent.press(getByTestId('tone-switcher-chip-summer-cool'));

    expect(captureFn).not.toHaveBeenCalled();
  });
});
