/**
 * ToneStateProvider — Phase 3.3 global Tone Switcher state (Sub-AC 6 +
 * Sub-AC 7).
 *
 * Owns the single source of truth for the user's current
 * Tone Switcher selection across the entire (post-payment) shell. The
 * Seed locks the contract:
 *   - Single atom (no per-tab independent state).
 *   - Persisted across app restarts via AsyncStorage key
 *     `pck.post_payment.last_tone`.
 *   - Default on first install = the season carried by the first-install
 *     DiagnosisView fixture; later launches restore the persisted value.
 *
 * Why a React Context atom (rather than Zustand, Redux, Jotai, etc.):
 *   The project's other shell-level state (FunnelStateProvider) is also
 *   a React Context. Matching that precedent keeps the dependency tree
 *   small and the testing harness uniform — vitest tests wrap the
 *   provider directly with `render(...)`.
 *
 * Why DI of storage read/write callables:
 *   The default uses the typed wrapper API
 *   (readLastTone / writeLastTone) from
 *   `apps/mobile/src/storage/post-payment-storage.ts`. Tests inject a
 *   pair of in-memory callables (or no-ops) so the provider is unit
 *   testable without the AsyncStorage mock leaking into every test
 *   file.
 *
 * The provider deliberately does NOT emit the `tone_switched` PostHog
 * event itself — that lives in the ToneSwitcher UI component, where
 * the event context (`from`, `to`) is already structured.
 */
import * as React from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import type { Season } from '../contracts/post-payment-views';
import { DEFAULT_DIAGNOSIS } from '../fixtures/post-payment-default-diagnosis';
import {
  readLastTone as defaultReadLastTone,
  writeLastTone as defaultWriteLastTone,
} from '../storage/post-payment-storage';

/**
 * Provenance enum mirroring the Phase 3.3 seed ontology `ToneState.source`:
 *   - 'diagnosis-default' = first-install state (current = the season
 *     from the diagnosis fixture; nothing has been persisted yet).
 *   - 'user-switched'     = the user has picked a tone via the Tone
 *     Switcher, OR the persisted-restore path has surfaced the
 *     most-recently-stored value on launch.
 */
export type ToneSource = 'diagnosis-default' | 'user-switched';

/**
 * Public ToneState surface the rest of the shell consumes via
 * useToneState().
 */
export interface ToneState {
  readonly current: Season;
  readonly source: ToneSource;
  readonly setTone: (next: Season) => void;
}

const ToneStateContext = createContext<ToneState | null>(null);

interface ToneStateProviderProps {
  readonly children: React.ReactNode;
  /** Test-only override of AsyncStorage read. */
  readonly _readLastTone?: () => Promise<Season | null>;
  /** Test-only override of AsyncStorage write. */
  readonly _writeLastTone?: (s: Season) => Promise<void>;
  /** Test-only override of the first-install diagnosis season. */
  readonly _initialDiagnosisSeason?: Season;
}

/**
 * Mounts the global tone atom and wires it to AsyncStorage. Wrap the
 * (post-payment) subtree once (in `(post-payment)/_layout.tsx`) so the
 * 4 tabs and the diagnosis-reveal all read from the same atom.
 */
export function ToneStateProvider({
  children,
  _readLastTone = defaultReadLastTone,
  _writeLastTone = defaultWriteLastTone,
  _initialDiagnosisSeason = DEFAULT_DIAGNOSIS.season,
}: ToneStateProviderProps): React.ReactElement {
  const [current, setCurrent] = useState<Season>(_initialDiagnosisSeason);
  const [source, setSource] = useState<ToneSource>('diagnosis-default');

  // On mount, attempt to restore persisted tone. If a stored value exists,
  // surface it as `user-switched` (the most-recent user pick wins over the
  // diagnosis default). If null, leave the diagnosis-default state intact.
  useEffect(() => {
    let cancelled = false;
    void _readLastTone().then((restored) => {
      if (cancelled) {
        return;
      }
      if (restored !== null) {
        setCurrent(restored);
        setSource('user-switched');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [_readLastTone]);

  const setTone = useCallback(
    (next: Season): void => {
      setCurrent(next);
      setSource('user-switched');
      void _writeLastTone(next);
    },
    [_writeLastTone],
  );

  const value = useMemo<ToneState>(
    () => ({ current, source, setTone }),
    [current, source, setTone],
  );

  return (
    <ToneStateContext.Provider value={value}>{children}</ToneStateContext.Provider>
  );
}

/**
 * Consume the global tone atom from any descendant of
 * <ToneStateProvider>. Throws synchronously when used outside the
 * provider — a programmer error, not a runtime branch.
 */
export function useToneState(): ToneState {
  const ctx = useContext(ToneStateContext);
  if (ctx === null) {
    throw new Error(
      'useToneState must be used inside <ToneStateProvider>. Wrap the (post-payment) subtree with the provider.',
    );
  }
  return ctx;
}
