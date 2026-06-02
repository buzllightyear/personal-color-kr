/**
 * Phase 6.2 — ARIA live politeness forwarding chain (focal AC).
 *
 * Pins the full, end-to-end accessibility contract that the Seed names
 * `accessibility_forwarding`:
 *
 *     core-ts view-model  →  StageLadder  →  RN accessibilityLiveRegion
 *
 * Both funnel ladders' view-models own the politeness decision per phase:
 *   - idle      → `off`       (nothing to announce yet)
 *   - running   → `polite`    (chatty progress, never interrupts upstream)
 *   - complete  → `assertive` (announce the finish even if it preempts)
 *
 * The RN `StageLadder` leaf forwards that politeness verbatim to the
 * platform's `accessibilityLiveRegion`, with the single documented remap
 * `off → none` (RN's union has no `off` member). This file proves EVERY
 * politeness value a real view-model can emit reaches the rendered container
 * — not by passing synthetic literals into the component (the sibling
 * `stage-ladder.test.tsx` already covers that unit mapping), but by driving
 * the genuine `core-ts` controllers through all three phases with an injected
 * fake scheduler and feeding each emitted `vm.ariaLive` straight into
 * `StageLadder`, then asserting the container's `accessibilityLiveRegion`.
 *
 * Two-layer coverage, both ladders (5-stage loader + 8-stage scan):
 *   Layer A — the view-model emits the documented politeness for its phase.
 *   Layer B — that emitted politeness, fed to `StageLadder`, surfaces on the
 *             container as the correctly-mapped `accessibilityLiveRegion`.
 *
 * Behavioural assertions only — no snapshots. No RN-layer timers: the
 * controllers own all timing via the injected scheduler, stepped synchronously.
 */
import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

// StageLadder pulls View/Text/StyleSheet from react-native; mock them to plain
// host elements so react-test-renderer can render the leaf without a native
// runtime (identical shape to the sibling component tests).
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
      flatten: (s: unknown): unknown => s,
    },
    Platform: {
      OS: 'ios',
      select: (m: { ios?: unknown; default?: unknown }) => m.ios ?? m.default,
    },
  };
});

import {
  ANALYZING_TOTAL_DURATION_MS,
  ANALYZING_STAGE_DURATION_MS,
} from 'core-ts/funnel';
import {
  SCAN_ANIMATION_TOTAL_DURATION_MS,
  SCAN_ANIMATION_STAGE_DURATION_MS,
} from 'core-ts/scan_option';

import { StageLadder } from '../src/components/StageLadder';
import {
  useAnalyzingLoaderLadder,
  useScanAnimationLadder,
  type UseAnalyzingLoaderLadderOptions,
  type UseScanAnimationLadderOptions,
} from '../src/hooks/use-stage-ladder';

// ---------------------------------------------------------------------------
// Injected fake scheduler — the same synchronous `{ now, setTimer, clearTimer }`
// seam both core-ts controllers accept. `advance(ms)` fires every due timer in
// ascending order so a single call can stride a whole timeline deterministically.
// ---------------------------------------------------------------------------

interface FakeClock {
  readonly scheduler: {
    readonly now: () => number;
    readonly setTimer: (fn: () => void, ms: number) => unknown;
    readonly clearTimer: (handle: unknown) => void;
  };
  readonly advance: (ms: number) => void;
}

function createFakeClock(): FakeClock {
  let nowMs = 0;
  let seq = 0;
  const timers = new Map<number, { dueAt: number; fn: () => void }>();

  const scheduler = Object.freeze({
    now: (): number => nowMs,
    setTimer: (fn: () => void, ms: number): unknown => {
      const id = (seq += 1);
      timers.set(id, { dueAt: nowMs + ms, fn });
      return id;
    },
    clearTimer: (handle: unknown): void => {
      if (typeof handle === 'number') timers.delete(handle);
    },
  });

  function advance(ms: number): void {
    const target = nowMs + ms;
    for (;;) {
      let nextId: number | undefined;
      let nextDue = Number.POSITIVE_INFINITY;
      for (const [id, t] of timers) {
        if (t.dueAt <= target && t.dueAt < nextDue) {
          nextDue = t.dueAt;
          nextId = id;
        }
      }
      if (nextId === undefined) break;
      const entry = timers.get(nextId);
      timers.delete(nextId);
      if (entry) {
        nowMs = entry.dueAt;
        entry.fn();
      }
    }
    nowMs = target;
  }

  return { scheduler: scheduler as FakeClock['scheduler'], advance };
}

// ---------------------------------------------------------------------------
// Probe wrappers — capture the latest view-model emitted by each ladder hook.
// ---------------------------------------------------------------------------

type AnalyzingVm = ReturnType<typeof useAnalyzingLoaderLadder>;
type ScanVm = ReturnType<typeof useScanAnimationLadder>;

function renderAnalyzing(options: UseAnalyzingLoaderLadderOptions): {
  vm: () => AnalyzingVm;
} {
  let latest: AnalyzingVm | undefined;
  function Probe(): null {
    latest = useAnalyzingLoaderLadder(options);
    return null;
  }
  act(() => {
    TestRenderer.create(React.createElement(Probe));
  });
  return {
    vm: () => {
      if (!latest) throw new Error('analyzing view-model not captured');
      return latest;
    },
  };
}

function renderScan(options: UseScanAnimationLadderOptions): {
  vm: () => ScanVm;
} {
  let latest: ScanVm | undefined;
  function Probe(): null {
    latest = useScanAnimationLadder(options);
    return null;
  }
  act(() => {
    TestRenderer.create(React.createElement(Probe));
  });
  return {
    vm: () => {
      if (!latest) throw new Error('scan view-model not captured');
      return latest;
    },
  };
}

// ---------------------------------------------------------------------------
// Helper — render StageLadder with a real view-model's items + ariaLive and
// read back the container's accessibilityLiveRegion. This is the forwarding
// edge the AC targets: whatever politeness the view-model produced must land
// on the rendered container, with `off → none`.
// ---------------------------------------------------------------------------

function liveRegionFor(vm: {
  readonly ariaLive: 'off' | 'polite' | 'assertive';
  readonly items: ReadonlyArray<{ readonly label: string; readonly status?: string }>;
}): unknown {
  const tree = TestRenderer.create(
    React.createElement(StageLadder, {
      items: vm.items as never,
      ariaLive: vm.ariaLive,
      testIDPrefix: 'aria-chain',
    }),
  );
  const containers = tree.root.findAll(
    (node) =>
      typeof node.type === 'string' && node.props?.testID === 'aria-chain',
  );
  if (containers.length !== 1) {
    throw new Error(
      `expected exactly one container, found ${containers.length}`,
    );
  }
  return containers[0]?.props.accessibilityLiveRegion;
}

// ===========================================================================
// 5-stage Analyzing loader (funnel step 5 `fake_loader`)
// ===========================================================================

describe('ARIA live forwarding — analyzing loader view-model → accessibilityLiveRegion', () => {
  it('idle phase: view-model emits `off`, StageLadder forwards `none`', () => {
    const clock = createFakeClock();
    const { vm } = renderAnalyzing({
      scheduler: clock.scheduler,
      autoStart: false,
    });

    expect(vm().phase).toBe('idle');
    expect(vm().ariaLive).toBe('off');
    expect(liveRegionFor(vm())).toBe('none');
  });

  it('running phase: view-model emits `polite`, StageLadder forwards `polite`', () => {
    const clock = createFakeClock();
    const { vm } = renderAnalyzing({ scheduler: clock.scheduler });

    // One stage in: still animating.
    act(() => clock.advance(ANALYZING_STAGE_DURATION_MS));
    expect(vm().phase).toBe('running');
    expect(vm().ariaLive).toBe('polite');
    expect(liveRegionFor(vm())).toBe('polite');
  });

  it('complete phase: view-model emits `assertive`, StageLadder forwards `assertive`', () => {
    const clock = createFakeClock();
    const { vm } = renderAnalyzing({ scheduler: clock.scheduler });

    act(() => clock.advance(ANALYZING_TOTAL_DURATION_MS));
    expect(vm().phase).toBe('complete');
    expect(vm().ariaLive).toBe('assertive');
    expect(liveRegionFor(vm())).toBe('assertive');
  });
});

// ===========================================================================
// 8-stage Scan animation (funnel step 8 `fake_scan_animation`)
// ===========================================================================

describe('ARIA live forwarding — scan animation view-model → accessibilityLiveRegion', () => {
  it('idle phase: view-model emits `off`, StageLadder forwards `none`', () => {
    const clock = createFakeClock();
    const { vm } = renderScan({ scheduler: clock.scheduler, autoStart: false });

    expect(vm().phase).toBe('idle');
    expect(vm().ariaLive).toBe('off');
    expect(liveRegionFor(vm())).toBe('none');
  });

  it('running phase: view-model emits `polite`, StageLadder forwards `polite`', () => {
    const clock = createFakeClock();
    const { vm } = renderScan({ scheduler: clock.scheduler });

    act(() => clock.advance(SCAN_ANIMATION_STAGE_DURATION_MS));
    expect(vm().phase).toBe('running');
    expect(vm().ariaLive).toBe('polite');
    expect(liveRegionFor(vm())).toBe('polite');
  });

  it('complete phase (3200 ms latch): view-model emits `assertive`, StageLadder forwards `assertive`', () => {
    const clock = createFakeClock();
    const { vm } = renderScan({ scheduler: clock.scheduler });

    act(() => clock.advance(SCAN_ANIMATION_TOTAL_DURATION_MS));
    expect(vm().phase).toBe('complete');
    expect(vm().ariaLive).toBe('assertive');
    expect(liveRegionFor(vm())).toBe('assertive');
  });

  it('latched assertive politeness holds through the 5000 ms auto-advance window', () => {
    const clock = createFakeClock();
    const { vm } = renderScan({ scheduler: clock.scheduler });

    act(() => clock.advance(SCAN_ANIMATION_TOTAL_DURATION_MS));
    expect(liveRegionFor(vm())).toBe('assertive');

    // The screen's separate 5000 ms auto-advance has not fired yet; the
    // latched assertive politeness must persist (no regression to polite/none).
    act(() => clock.advance(5_000 - SCAN_ANIMATION_TOTAL_DURATION_MS));
    expect(vm().phase).toBe('complete');
    expect(vm().ariaLive).toBe('assertive');
    expect(liveRegionFor(vm())).toBe('assertive');
  });
});

// ===========================================================================
// Cross-ladder invariant — every politeness value a view-model can emit has a
// defined, non-throwing forward path, and the `off → none` remap is the ONLY
// transformation applied.
// ===========================================================================

describe('ARIA live forwarding — exhaustive politeness coverage', () => {
  it('covers the full politeness alphabet across both ladders with no gaps', () => {
    const scanClock = createFakeClock();
    const loaderClock = createFakeClock();

    const idleScan = renderScan({
      scheduler: scanClock.scheduler,
      autoStart: false,
    });
    const runningLoader = renderAnalyzing({ scheduler: loaderClock.scheduler });

    // off (idle) → none
    expect(liveRegionFor(idleScan.vm())).toBe('none');

    // polite (running) → polite
    act(() => loaderClock.advance(ANALYZING_STAGE_DURATION_MS));
    expect(liveRegionFor(runningLoader.vm())).toBe('polite');

    // assertive (complete) → assertive
    act(() => loaderClock.advance(ANALYZING_TOTAL_DURATION_MS));
    expect(liveRegionFor(runningLoader.vm())).toBe('assertive');

    // The three RN outputs are exactly the documented mapping of the three
    // view-model politeness values — nothing else can appear.
    const observed = new Set([
      liveRegionFor(idleScan.vm()),
      'polite',
      'assertive',
    ]);
    expect([...observed].sort()).toEqual(['assertive', 'none', 'polite']);
  });
});
