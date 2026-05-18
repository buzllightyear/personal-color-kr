/**
 * Unit test — `OnboardingPrimingScreen` presentational component.
 *
 * Asserts:
 *   1. Renders Q1 (selfieEditStyle) with 3 options.
 *   2. Renders Q2 (priorDiagnosis) with 3 options.
 *   3. Selecting an option fires the corresponding onSelect callback.
 *   4. Submit CTA is disabled when either answer is null.
 *   5. Submit CTA is enabled when both answers are non-null.
 *   6. Each option button has accessibilityState.selected reflecting state.
 */
import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
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
    Platform: {
      OS: 'ios',
      select: (m: { ios?: unknown; default?: unknown }) => m.ios ?? m.default,
    },
  };
});

vi.mock('react-native-safe-area-context', () => {
  return {
    SafeAreaView: (props: { children?: React.ReactNode; [key: string]: unknown }) =>
      React.createElement('SafeAreaView', props, props.children),
  };
});

import { OnboardingPrimingScreen } from '../src/screens/funnel/OnboardingPrimingScreen';
import { INITIAL_FUNNEL_ONBOARDING_ANSWERS } from '../src/contracts/funnel-state';

interface TestInstance {
  readonly type: unknown;
  readonly props: Record<string, unknown>;
}

function findHostByTestId(
  tree: TestRenderer.ReactTestRenderer,
  testID: string,
): TestInstance | null {
  const matches = tree.root.findAll(
    (node) =>
      typeof node.type === 'string' && node.props?.testID === testID,
  );
  return (matches[0] as unknown as TestInstance) ?? null;
}

function render(element: React.ReactElement): TestRenderer.ReactTestRenderer {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  act(() => {
    tree = TestRenderer.create(element);
  });
  if (!tree) throw new Error('render: tree not created');
  return tree;
}

const NO_OP = (): void => undefined;

describe('OnboardingPrimingScreen — render', () => {
  it('renders Q1 with 3 selfie-edit-style options', () => {
    const tree = render(
      React.createElement(OnboardingPrimingScreen, {
        onboarding: INITIAL_FUNNEL_ONBOARDING_ANSWERS,
        onSelectSelfieEditStyle: NO_OP,
        onSelectPriorDiagnosis: NO_OP,
        onNext: NO_OP,
      }),
    );
    expect(findHostByTestId(tree, 'onboarding-priming-q1-option-natural')).toBeTruthy();
    expect(findHostByTestId(tree, 'onboarding-priming-q1-option-subtle')).toBeTruthy();
    expect(findHostByTestId(tree, 'onboarding-priming-q1-option-expressive')).toBeTruthy();
  });

  it('renders Q2 with 3 prior-diagnosis options', () => {
    const tree = render(
      React.createElement(OnboardingPrimingScreen, {
        onboarding: INITIAL_FUNNEL_ONBOARDING_ANSWERS,
        onSelectSelfieEditStyle: NO_OP,
        onSelectPriorDiagnosis: NO_OP,
        onNext: NO_OP,
      }),
    );
    expect(findHostByTestId(tree, 'onboarding-priming-q2-option-never')).toBeTruthy();
    expect(findHostByTestId(tree, 'onboarding-priming-q2-option-self-test')).toBeTruthy();
    expect(findHostByTestId(tree, 'onboarding-priming-q2-option-professional')).toBeTruthy();
  });
});

describe('OnboardingPrimingScreen — interaction', () => {
  it('invokes onSelectSelfieEditStyle with the option value on press', () => {
    const onSelect = vi.fn();
    const tree = render(
      React.createElement(OnboardingPrimingScreen, {
        onboarding: INITIAL_FUNNEL_ONBOARDING_ANSWERS,
        onSelectSelfieEditStyle: onSelect,
        onSelectPriorDiagnosis: NO_OP,
        onNext: NO_OP,
      }),
    );
    const naturalOption = findHostByTestId(tree, 'onboarding-priming-q1-option-natural');
    const onPress = naturalOption?.props.onPress as () => void;
    act(() => onPress());
    expect(onSelect).toHaveBeenCalledWith('natural');
  });

  it('invokes onSelectPriorDiagnosis with the option value on press', () => {
    const onSelect = vi.fn();
    const tree = render(
      React.createElement(OnboardingPrimingScreen, {
        onboarding: INITIAL_FUNNEL_ONBOARDING_ANSWERS,
        onSelectSelfieEditStyle: NO_OP,
        onSelectPriorDiagnosis: onSelect,
        onNext: NO_OP,
      }),
    );
    const professionalOption = findHostByTestId(
      tree,
      'onboarding-priming-q2-option-professional',
    );
    const onPress = professionalOption?.props.onPress as () => void;
    act(() => onPress());
    expect(onSelect).toHaveBeenCalledWith('professional');
  });

  it('reflects selected state on the active Q1 option via accessibilityState', () => {
    const tree = render(
      React.createElement(OnboardingPrimingScreen, {
        onboarding: { selfieEditStyle: 'subtle', priorDiagnosis: null },
        onSelectSelfieEditStyle: NO_OP,
        onSelectPriorDiagnosis: NO_OP,
        onNext: NO_OP,
      }),
    );
    const subtleOption = findHostByTestId(tree, 'onboarding-priming-q1-option-subtle');
    const naturalOption = findHostByTestId(tree, 'onboarding-priming-q1-option-natural');
    expect((subtleOption?.props.accessibilityState as { selected: boolean }).selected).toBe(true);
    expect((naturalOption?.props.accessibilityState as { selected: boolean }).selected).toBe(false);
  });
});

describe('OnboardingPrimingScreen — submit gating', () => {
  it('submit CTA is disabled when both answers are null', () => {
    const tree = render(
      React.createElement(OnboardingPrimingScreen, {
        onboarding: INITIAL_FUNNEL_ONBOARDING_ANSWERS,
        onSelectSelfieEditStyle: NO_OP,
        onSelectPriorDiagnosis: NO_OP,
        onNext: NO_OP,
      }),
    );
    const submit = findHostByTestId(tree, 'onboarding-priming-submit');
    expect((submit?.props.accessibilityState as { disabled: boolean }).disabled).toBe(true);
  });

  it('submit CTA is disabled when only Q1 is answered', () => {
    const tree = render(
      React.createElement(OnboardingPrimingScreen, {
        onboarding: { selfieEditStyle: 'natural', priorDiagnosis: null },
        onSelectSelfieEditStyle: NO_OP,
        onSelectPriorDiagnosis: NO_OP,
        onNext: NO_OP,
      }),
    );
    const submit = findHostByTestId(tree, 'onboarding-priming-submit');
    expect((submit?.props.accessibilityState as { disabled: boolean }).disabled).toBe(true);
  });

  it('submit CTA is enabled when both answers are non-null', () => {
    const tree = render(
      React.createElement(OnboardingPrimingScreen, {
        onboarding: { selfieEditStyle: 'expressive', priorDiagnosis: 'professional' },
        onSelectSelfieEditStyle: NO_OP,
        onSelectPriorDiagnosis: NO_OP,
        onNext: NO_OP,
      }),
    );
    const submit = findHostByTestId(tree, 'onboarding-priming-submit');
    expect((submit?.props.accessibilityState as { disabled: boolean }).disabled).toBe(false);
  });

  it('submit CTA invokes onNext when pressed in enabled state', () => {
    const onNext = vi.fn();
    const tree = render(
      React.createElement(OnboardingPrimingScreen, {
        onboarding: { selfieEditStyle: 'natural', priorDiagnosis: 'never' },
        onSelectSelfieEditStyle: NO_OP,
        onSelectPriorDiagnosis: NO_OP,
        onNext,
      }),
    );
    const submit = findHostByTestId(tree, 'onboarding-priming-submit');
    const onPress = submit?.props.onPress as (e: unknown) => void;
    act(() => onPress({}));
    expect(onNext).toHaveBeenCalledTimes(1);
  });
});
