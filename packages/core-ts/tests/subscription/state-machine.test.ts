/**
 * Unit tests for the subscription state transition function — Sub-AC 16d.
 *
 * Verified invariants:
 *   Valid transitions:
 *     - trial      + trial_end     → active
 *     - active     + payment_fail  → past_due
 *     - past_due   + grace_expire  → cancelled
 *     - active     + user_cancel   → cancelled
 *   Invalid transitions:
 *     - Any (state, event) pair not in the table above raises
 *       InvalidSubscriptionTransitionError
 *     - Unknown state strings raise InvalidSubscriptionTransitionError
 *     - Unknown event strings raise InvalidSubscriptionTransitionError
 */
import { describe, expect, it } from 'vitest';
import {
  InvalidSubscriptionTransitionError,
  transition_subscription,
} from '../../src/subscription/state-machine.js';

// ---------------------------------------------------------------------------
// Valid transitions
// ---------------------------------------------------------------------------

describe('transition_subscription — valid transitions', () => {
  describe('trial + trial_end → active', () => {
    it('returns "active" when trial receives trial_end', () => {
      expect(transition_subscription('trial', 'trial_end')).toBe('active');
    });

    it('return type is a string', () => {
      const result = transition_subscription('trial', 'trial_end');
      expect(typeof result).toBe('string');
    });
  });

  describe('active + payment_fail → past_due', () => {
    it('returns "past_due" when active receives payment_fail', () => {
      expect(transition_subscription('active', 'payment_fail')).toBe('past_due');
    });
  });

  describe('past_due + grace_expire → cancelled', () => {
    it('returns "cancelled" when past_due receives grace_expire', () => {
      expect(transition_subscription('past_due', 'grace_expire')).toBe('cancelled');
    });
  });

  describe('active + user_cancel → cancelled', () => {
    it('returns "cancelled" when active receives user_cancel', () => {
      expect(transition_subscription('active', 'user_cancel')).toBe('cancelled');
    });
  });
});

// ---------------------------------------------------------------------------
// All four valid transitions in a table-driven summary
// ---------------------------------------------------------------------------

describe('transition_subscription — valid transition table', () => {
  const VALID_TRANSITIONS = [
    { from: 'trial', event: 'trial_end', to: 'active' },
    { from: 'active', event: 'payment_fail', to: 'past_due' },
    { from: 'past_due', event: 'grace_expire', to: 'cancelled' },
    { from: 'active', event: 'user_cancel', to: 'cancelled' },
  ] as const;

  for (const { from, event, to } of VALID_TRANSITIONS) {
    it(`${from} + ${event} → ${to}`, () => {
      expect(transition_subscription(from, event)).toBe(to);
    });
  }
});

// ---------------------------------------------------------------------------
// Invalid transitions — cross-state events that must throw
// ---------------------------------------------------------------------------

describe('transition_subscription — invalid transitions raise InvalidSubscriptionTransitionError', () => {
  describe('trial state rejects non-trial_end events', () => {
    it('throws on trial + payment_fail', () => {
      expect(() => transition_subscription('trial', 'payment_fail')).toThrowError(
        InvalidSubscriptionTransitionError,
      );
    });

    it('throws on trial + grace_expire', () => {
      expect(() => transition_subscription('trial', 'grace_expire')).toThrowError(
        InvalidSubscriptionTransitionError,
      );
    });

    it('throws on trial + user_cancel', () => {
      expect(() => transition_subscription('trial', 'user_cancel')).toThrowError(
        InvalidSubscriptionTransitionError,
      );
    });
  });

  describe('active state rejects non-payment_fail/non-user_cancel events', () => {
    it('throws on active + trial_end', () => {
      expect(() => transition_subscription('active', 'trial_end')).toThrowError(
        InvalidSubscriptionTransitionError,
      );
    });

    it('throws on active + grace_expire', () => {
      expect(() => transition_subscription('active', 'grace_expire')).toThrowError(
        InvalidSubscriptionTransitionError,
      );
    });
  });

  describe('past_due state rejects non-grace_expire events', () => {
    it('throws on past_due + trial_end', () => {
      expect(() => transition_subscription('past_due', 'trial_end')).toThrowError(
        InvalidSubscriptionTransitionError,
      );
    });

    it('throws on past_due + payment_fail', () => {
      expect(() => transition_subscription('past_due', 'payment_fail')).toThrowError(
        InvalidSubscriptionTransitionError,
      );
    });

    it('throws on past_due + user_cancel', () => {
      expect(() => transition_subscription('past_due', 'user_cancel')).toThrowError(
        InvalidSubscriptionTransitionError,
      );
    });
  });

  describe('cancelled state is terminal — rejects all events', () => {
    it('throws on cancelled + trial_end', () => {
      expect(() => transition_subscription('cancelled', 'trial_end')).toThrowError(
        InvalidSubscriptionTransitionError,
      );
    });

    it('throws on cancelled + payment_fail', () => {
      expect(() => transition_subscription('cancelled', 'payment_fail')).toThrowError(
        InvalidSubscriptionTransitionError,
      );
    });

    it('throws on cancelled + grace_expire', () => {
      expect(() => transition_subscription('cancelled', 'grace_expire')).toThrowError(
        InvalidSubscriptionTransitionError,
      );
    });

    it('throws on cancelled + user_cancel', () => {
      expect(() => transition_subscription('cancelled', 'user_cancel')).toThrowError(
        InvalidSubscriptionTransitionError,
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Unknown state / event inputs
// ---------------------------------------------------------------------------

describe('transition_subscription — unknown state or event strings', () => {
  it('throws InvalidSubscriptionTransitionError for an unknown state', () => {
    expect(() =>
      transition_subscription('suspended' as never, 'trial_end'),
    ).toThrowError(InvalidSubscriptionTransitionError);
  });

  it('throws InvalidSubscriptionTransitionError for an unknown event', () => {
    expect(() =>
      transition_subscription('active', 'refund_issued' as never),
    ).toThrowError(InvalidSubscriptionTransitionError);
  });

  it('throws for undefined state', () => {
    expect(() => transition_subscription(undefined as never, 'trial_end')).toThrowError(
      InvalidSubscriptionTransitionError,
    );
  });

  it('throws for null state', () => {
    expect(() => transition_subscription(null as never, 'trial_end')).toThrowError(
      InvalidSubscriptionTransitionError,
    );
  });

  it('throws for undefined event', () => {
    expect(() => transition_subscription('trial', undefined as never)).toThrowError(
      InvalidSubscriptionTransitionError,
    );
  });

  it('throws for null event', () => {
    expect(() => transition_subscription('trial', null as never)).toThrowError(
      InvalidSubscriptionTransitionError,
    );
  });

  it('throws for empty string state', () => {
    expect(() => transition_subscription('' as never, 'trial_end')).toThrowError(
      InvalidSubscriptionTransitionError,
    );
  });

  it('throws for empty string event', () => {
    expect(() => transition_subscription('active', '' as never)).toThrowError(
      InvalidSubscriptionTransitionError,
    );
  });
});

// ---------------------------------------------------------------------------
// InvalidSubscriptionTransitionError shape
// ---------------------------------------------------------------------------

describe('InvalidSubscriptionTransitionError — error shape', () => {
  it('error name is "InvalidSubscriptionTransitionError"', () => {
    let caught: InvalidSubscriptionTransitionError | undefined;
    try {
      transition_subscription('trial', 'payment_fail');
    } catch (e) {
      caught = e as InvalidSubscriptionTransitionError;
    }
    expect(caught).toBeInstanceOf(InvalidSubscriptionTransitionError);
    expect(caught?.name).toBe('InvalidSubscriptionTransitionError');
  });

  it('error message contains the current state', () => {
    let caught: InvalidSubscriptionTransitionError | undefined;
    try {
      transition_subscription('past_due', 'user_cancel');
    } catch (e) {
      caught = e as InvalidSubscriptionTransitionError;
    }
    expect(caught?.message).toMatch(/past_due/);
  });

  it('error message contains the event', () => {
    let caught: InvalidSubscriptionTransitionError | undefined;
    try {
      transition_subscription('past_due', 'user_cancel');
    } catch (e) {
      caught = e as InvalidSubscriptionTransitionError;
    }
    expect(caught?.message).toMatch(/user_cancel/);
  });

  it('error exposes currentState property', () => {
    let caught: InvalidSubscriptionTransitionError | undefined;
    try {
      transition_subscription('cancelled', 'trial_end');
    } catch (e) {
      caught = e as InvalidSubscriptionTransitionError;
    }
    expect(caught?.currentState).toBe('cancelled');
  });

  it('error exposes event property', () => {
    let caught: InvalidSubscriptionTransitionError | undefined;
    try {
      transition_subscription('cancelled', 'trial_end');
    } catch (e) {
      caught = e as InvalidSubscriptionTransitionError;
    }
    expect(caught?.event).toBe('trial_end');
  });
});

// ---------------------------------------------------------------------------
// Immutability / purity — calling the function does not mutate its inputs
// ---------------------------------------------------------------------------

describe('transition_subscription — purity', () => {
  it('calling it twice with the same args returns the same result', () => {
    expect(transition_subscription('trial', 'trial_end')).toBe(
      transition_subscription('trial', 'trial_end'),
    );
  });

  it('does not throw when called multiple times in succession', () => {
    expect(() => {
      transition_subscription('trial', 'trial_end');
      transition_subscription('active', 'payment_fail');
      transition_subscription('past_due', 'grace_expire');
      transition_subscription('active', 'user_cancel');
    }).not.toThrow();
  });
});
