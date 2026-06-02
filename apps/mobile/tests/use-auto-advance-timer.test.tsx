/**
 * useAutoAdvanceTimer — unit tests (AC 11).
 *
 * Pins the contract for the shared one-shot auto-advance timer hook used by
 * step 5 `fake_loader` (and later step 8 `fake_scan_animation`).
 *
 * Covered behaviour:
 *   1. Fires `onElapsed` exactly once after `durationMs` elapses.
 *   2. Does NOT fire if the component unmounts before the timer elapses
 *      (cleanup via `clearTimeout` runs).
 *   3. Does NOT schedule a timer when `enabled: false`.
 *   4. Re-scheduling on `durationMs` change clears the previous timer.
 *   5. The latched-callback ref picks up the newest closure without
 *      restarting the countdown.
 *
 * Why react-test-renderer + vi.useFakeTimers:
 *   The hook is pure React (no native modules). We render a host component
 *   that consumes the hook, then advance vitest's fake timer clock to assert
 *   the callback runs / does not run. No `react-native` surface is needed
 *   beyond what the setup-rn-stub already provides, but we additionally
 *   `vi.mock('react-native')` to satisfy the ESM resolution path that
 *   funnel-placeholder-smoke.test.tsx documents.
 */
import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAutoAdvanceTimer } from '../src/hooks/use-auto-advance-timer';

interface ProbeProps {
  readonly durationMs: number;
  readonly onElapsed: () => void;
  readonly enabled?: boolean;
}

/**
 * Minimal probe component that mounts the hook. Renders `null` because the
 * test asserts on the callback, not on rendered output.
 */
function Probe(props: ProbeProps): React.ReactElement | null {
  useAutoAdvanceTimer({
    durationMs: props.durationMs,
    onElapsed: props.onElapsed,
    ...(props.enabled !== undefined ? { enabled: props.enabled } : {}),
  });
  return null;
}

describe('useAutoAdvanceTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires onElapsed exactly once after durationMs', () => {
    const onElapsed = vi.fn();
    act(() => {
      TestRenderer.create(React.createElement(Probe, { durationMs: 5_000, onElapsed }));
    });

    expect(onElapsed).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(4_999);
    });
    expect(onElapsed).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onElapsed).toHaveBeenCalledTimes(1);

    // Continuing to advance must not re-fire the one-shot timer.
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(onElapsed).toHaveBeenCalledTimes(1);
  });

  it('does not fire onElapsed if the component unmounts before durationMs elapses', () => {
    const onElapsed = vi.fn();
    let tree: TestRenderer.ReactTestRenderer | undefined;
    act(() => {
      tree = TestRenderer.create(
        React.createElement(Probe, { durationMs: 5_000, onElapsed }),
      );
    });

    act(() => {
      vi.advanceTimersByTime(2_000);
    });

    act(() => {
      tree?.unmount();
    });

    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(onElapsed).not.toHaveBeenCalled();
  });

  it('does not schedule a timer when enabled is false', () => {
    const onElapsed = vi.fn();
    act(() => {
      TestRenderer.create(
        React.createElement(Probe, {
          durationMs: 5_000,
          onElapsed,
          enabled: false,
        }),
      );
    });

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(onElapsed).not.toHaveBeenCalled();
  });

  it('clears the previous timer when durationMs changes (re-schedules)', () => {
    const onElapsed = vi.fn();
    let tree: TestRenderer.ReactTestRenderer | undefined;
    act(() => {
      tree = TestRenderer.create(
        React.createElement(Probe, { durationMs: 5_000, onElapsed }),
      );
    });

    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(onElapsed).not.toHaveBeenCalled();

    // Re-render with a new duration. The previous timer (which would have
    // fired in 2_000ms more) must be cleared; a fresh 10_000ms timer starts.
    act(() => {
      tree?.update(React.createElement(Probe, { durationMs: 10_000, onElapsed }));
    });

    // 2_000ms more would have fired the original 5_000ms timer — assert it
    // does NOT fire (the cleanup cleared it).
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(onElapsed).not.toHaveBeenCalled();

    // Advance enough that the fresh 10_000ms timer fires.
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(onElapsed).toHaveBeenCalledTimes(1);
  });

  it('latches the latest onElapsed without restarting the countdown', () => {
    const firstCallback = vi.fn();
    const secondCallback = vi.fn();

    let tree: TestRenderer.ReactTestRenderer | undefined;
    act(() => {
      tree = TestRenderer.create(
        React.createElement(Probe, {
          durationMs: 5_000,
          onElapsed: firstCallback,
        }),
      );
    });

    act(() => {
      vi.advanceTimersByTime(3_000);
    });

    // Swap the callback mid-flight. Because the hook reads from a ref at
    // fire time, the countdown must NOT restart — the original 5_000ms
    // deadline still applies, but the *new* callback should fire.
    act(() => {
      tree?.update(
        React.createElement(Probe, {
          durationMs: 5_000,
          onElapsed: secondCallback,
        }),
      );
    });

    act(() => {
      vi.advanceTimersByTime(2_000);
    });

    expect(firstCallback).not.toHaveBeenCalled();
    expect(secondCallback).toHaveBeenCalledTimes(1);
  });
});
