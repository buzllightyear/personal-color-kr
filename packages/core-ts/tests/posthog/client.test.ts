/**
 * Unit tests — PostHogClient wrapper.
 *
 * Verifies that the `capture(event, props)` abstraction:
 *   1. forwards (event, props) to the injected transport in call order,
 *      exactly once per call,
 *   2. tolerates the no-props variant — transport is called with no
 *      properties argument when `props` is omitted,
 *   3. freezes the properties object before handing it off (defence-in-
 *      depth against transport-side mutation),
 *   4. rejects non-string / empty event names with PostHogClientError
 *      BEFORE the transport is touched,
 *   5. rejects a malformed transport at construction time,
 *   6. wraps transport-thrown errors in a PostHogClientError carrying
 *      the original cause — analytics never silently drops events.
 *
 * The tests run against a `vi.fn` mock transport so no native modules,
 * no network calls, and no PostHog keys are required.  This is the
 * "PostHogClient vitest test completes without exception" smoke test
 * referenced by the vendor-setup Exit Conditions.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  PostHogClientError,
  createPostHogClient,
  type PostHogTransport,
} from '../../src/posthog/client.js';

function makeMockTransport(): {
  readonly transport: PostHogTransport;
  readonly capture: ReturnType<typeof vi.fn>;
} {
  const capture = vi.fn();
  return {
    transport: { capture },
    capture,
  };
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('createPostHogClient — construction', () => {
  it('returns an object exposing a capture function', () => {
    const { transport } = makeMockTransport();
    const client = createPostHogClient({ transport });
    expect(typeof client.capture).toBe('function');
  });

  it('returns a frozen client (capture cannot be reassigned at runtime)', () => {
    const { transport } = makeMockTransport();
    const client = createPostHogClient({ transport });
    expect(Object.isFrozen(client)).toBe(true);
  });

  it('rejects a transport missing the capture method', () => {
    expect(() =>
      createPostHogClient({
        transport: {} as unknown as PostHogTransport,
      }),
    ).toThrow(PostHogClientError);
  });

  it('rejects a null transport', () => {
    expect(() =>
      createPostHogClient({
        transport: null as unknown as PostHogTransport,
      }),
    ).toThrow(/transport must implement capture/);
  });

  it('attaches reason="invalid_transport" on malformed-transport errors', () => {
    try {
      createPostHogClient({
        transport: { capture: 'not_a_fn' } as unknown as PostHogTransport,
      });
      expect.fail('Expected PostHogClientError to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PostHogClientError);
      expect((err as PostHogClientError).reason).toBe('invalid_transport');
    }
  });

  it('does NOT call the transport during construction (lazy)', () => {
    const { transport, capture } = makeMockTransport();
    createPostHogClient({ transport });
    expect(capture).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// capture() — happy path
// ---------------------------------------------------------------------------

describe('PostHogClient.capture — happy path', () => {
  it('forwards (event, props) to the transport', () => {
    const { transport, capture } = makeMockTransport();
    const client = createPostHogClient({ transport });

    client.capture('step_view', { stepId: 'welcome_hook', stepNumber: 1 });

    expect(capture).toHaveBeenCalledTimes(1);
    const [event, props] = capture.mock.calls[0]!;
    expect(event).toBe('step_view');
    expect(props).toEqual({ stepId: 'welcome_hook', stepNumber: 1 });
  });

  it('forwards an event with no properties argument when props is omitted', () => {
    const { transport, capture } = makeMockTransport();
    const client = createPostHogClient({ transport });

    client.capture('app_opened');

    expect(capture).toHaveBeenCalledTimes(1);
    // Important: the transport receives a single argument so it can
    // distinguish "no props" from "empty-object props".
    expect(capture.mock.calls[0]).toEqual(['app_opened']);
  });

  it('forwards multiple events in call order, exactly once each', () => {
    const { transport, capture } = makeMockTransport();
    const client = createPostHogClient({ transport });

    client.capture('first', { idx: 1 });
    client.capture('second', { idx: 2 });
    client.capture('third', { idx: 3 });

    expect(capture).toHaveBeenCalledTimes(3);
    expect(capture.mock.calls.map((c) => c[0])).toEqual(['first', 'second', 'third']);
    expect(capture.mock.calls.map((c) => c[1])).toEqual([
      { idx: 1 },
      { idx: 2 },
      { idx: 3 },
    ]);
  });

  it('freezes the props object handed to the transport', () => {
    const { transport, capture } = makeMockTransport();
    const client = createPostHogClient({ transport });

    client.capture('step_view', { stepId: 'welcome_hook' });

    const passed = capture.mock.calls[0]![1] as Record<string, unknown>;
    expect(Object.isFrozen(passed)).toBe(true);
  });

  it('does NOT mutate the caller-supplied props object', () => {
    const { transport } = makeMockTransport();
    const client = createPostHogClient({ transport });

    const original = { stepId: 'welcome_hook', n: 1 };
    const snapshot = { ...original };
    client.capture('step_view', original);

    expect(original).toEqual(snapshot);
    expect(Object.isFrozen(original)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// capture() — validation
// ---------------------------------------------------------------------------

describe('PostHogClient.capture — validation', () => {
  it('rejects an empty event name BEFORE touching the transport', () => {
    const { transport, capture } = makeMockTransport();
    const client = createPostHogClient({ transport });

    expect(() => client.capture('')).toThrow(PostHogClientError);
    expect(capture).not.toHaveBeenCalled();
  });

  it('rejects a whitespace-only event name', () => {
    const { transport, capture } = makeMockTransport();
    const client = createPostHogClient({ transport });

    expect(() => client.capture('   ')).toThrow(/non-empty string/);
    expect(capture).not.toHaveBeenCalled();
  });

  it('rejects a non-string event name', () => {
    const { transport, capture } = makeMockTransport();
    const client = createPostHogClient({ transport });

    expect(() => client.capture(42 as unknown as string)).toThrow(PostHogClientError);
    expect(() => client.capture(null as unknown as string)).toThrow(PostHogClientError);
    expect(capture).not.toHaveBeenCalled();
  });

  it('attaches reason="invalid_event_name" on bad-event errors', () => {
    const { transport } = makeMockTransport();
    const client = createPostHogClient({ transport });

    try {
      client.capture('');
      expect.fail('Expected PostHogClientError to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PostHogClientError);
      expect((err as PostHogClientError).reason).toBe('invalid_event_name');
    }
  });
});

// ---------------------------------------------------------------------------
// capture() — transport failure surfacing
// ---------------------------------------------------------------------------

describe('PostHogClient.capture — transport failure', () => {
  it('wraps a transport-thrown error in PostHogClientError carrying the cause', () => {
    const inner = new Error('boom');
    const transport: PostHogTransport = {
      capture: () => {
        throw inner;
      },
    };
    const client = createPostHogClient({ transport });

    try {
      client.capture('step_view', { stepId: 'welcome_hook' });
      expect.fail('Expected PostHogClientError to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PostHogClientError);
      const phErr = err as PostHogClientError;
      expect(phErr.reason).toBe('transport_failure');
      expect(phErr.cause).toBe(inner);
      expect(phErr.message).toMatch(/step_view/);
    }
  });
});
