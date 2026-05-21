/**
 * Render test — `apps/mobile/app/(post-payment)/_layout.tsx`.
 *
 * Phase 3.3 Sub-AC 1.1 contract (verbatim from the Seed):
 *   "Create apps/mobile/app/(post-payment)/_layout.tsx route group with
 *    first-entry detection logic that routes initial post-payment
 *    navigation to diagnosis-reveal full-screen (no tab bar) and excludes
 *    (post-payment) routes from the deep-link allowlist."
 *
 * What this suite locks down (all derived from the contract above):
 *
 *   1. **Default export shape.** The layout module default-exports a
 *      React function component (the convention every Expo Router
 *      `_layout.tsx` is required to follow).
 *
 *   2. **First-entry redirect.** When the user lands anywhere INSIDE
 *      `(post-payment)` that is NOT the reveal route (the typical case
 *      on the very first entry — `usePathname()` returns the implicit
 *      `(tabs)` index), the layout emits a single `<Redirect />` whose
 *      `href` points at `/(post-payment)/diagnosis-reveal`. No Stack
 *      mounts in this branch (the layout returns the Redirect directly,
 *      mirroring the precedent set by `(funnel)/_layout.tsx`).
 *
 *   3. **Redirect-loop suppression.** When `usePathname()` already
 *      resolves to a path whose last segment is `diagnosis-reveal`, the
 *      layout does NOT emit a Redirect — it renders the Stack so the
 *      reveal screen can mount inside it. Without this guard the
 *      layout would loop indefinitely.
 *
 *   4. **Stack registry — the two children declared.** When the Stack
 *      DOES render, exactly two `Stack.Screen` children are declared:
 *      `diagnosis-reveal` and `(tabs)`. This is the security-relevant
 *      structural assertion: a regression that drops `(tabs)` from the
 *      registry would leave the entire post-payment content surface
 *      un-mounted; a regression that drops `diagnosis-reveal` would
 *      break the first-touch experience.
 *
 *   5. **Diagnosis-reveal screen options.** The reveal screen is
 *      declared with `presentation: 'fullScreenModal'` (full-screen, no
 *      tab bar, no native Stack header — combined with the parent's
 *      `headerShown: false`) and `gestureEnabled: false` so the user
 *      cannot swipe-dismiss the reveal mid-animation. These are the
 *      knobs that operationalise the "first-touch full-screen
 *      diagnosis-reveal" half of the Sub-AC contract.
 *
 *   6. **Parent screenOptions — header off.** The Stack's
 *      `screenOptions.headerShown` is `false` so the diagnosis-reveal
 *      and the tabbed shell below it are visually flush with no
 *      native header bar.
 *
 * Mocking strategy:
 *   - `vi.mock('expo-router')` returns a spy `Stack` that records the
 *     `screenOptions` prop, captures the children registry by recording
 *     every `Stack.Screen` `name` + `options` mounted under it, plus a
 *     spy `Redirect` that records its `href` prop. `usePathname` is a
 *     mutable function so individual cases can rewrite the active path
 *     between renders.
 *   - The mock factory mirrors the conventions in `root-layout.test.tsx`
 *     (same module-scope recorder pattern, same `vi.importActual('react')`
 *     pin so the spy components share a React copy with the layout
 *     under test).
 *
 * Why these mocks instead of running through a real router:
 *   The Expo Router runtime requires a full navigation tree + native
 *   modules. We exercise the layout in isolation under the vitest Node
 *   runner via the same `tests/__stubs__/setup-rn-stub.ts` cache stub
 *   the sibling tests use; the wiring contract under test is purely a
 *   matter of which JSX shape the layout returns under each pathname,
 *   which is observable through the spy components without spinning up
 *   the router.
 */
import * as React from 'react';
import { render } from '@testing-library/react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Module-scope recorders.
//
// Live outside the mock factory so individual tests can read them after
// `render()` returns. The mock factory closes over them by reference.
// ---------------------------------------------------------------------------
const redirectHrefRecorder: string[] = [];
const stackScreenOptionsRecorder: Array<unknown> = [];
const stackChildrenRecorder: Array<{ name: string; options: unknown }> = [];
let mockPathname: string = '/';

// ---------------------------------------------------------------------------
// Mock — expo-router
//
// `Stack` is a spy component that records its `screenOptions` prop and
// recursively walks its children so every `Stack.Screen` mounted under it
// is captured in `stackChildrenRecorder` (the registry-shape assertion). We
// walk children explicitly rather than relying on `Stack.Screen` to render
// itself because the spy `Screen` is a noop — its sole purpose is to be
// counted at JSX-construction time, which the parent walker handles via
// the React element tree directly.
// ---------------------------------------------------------------------------
vi.mock('expo-router', async () => {
  const reactActual: any = await vi.importActual('react');

  function StackSpy(props: any) {
    stackScreenOptionsRecorder.push(props.screenOptions);
    // React.Children handles a single element, an array, and undefined
    // uniformly — the post-payment layout passes two `Stack.Screen`
    // children, which arrive as an array.
    reactActual.Children.forEach(props.children, (child: any) => {
      if (child && child.props && typeof child.props.name === 'string') {
        stackChildrenRecorder.push({
          name: child.props.name,
          options: child.props.options ?? null,
        });
      }
    });
    return reactActual.createElement(reactActual.Fragment, null);
  }
  (StackSpy as any).Screen = function MockScreen() {
    return null;
  };

  function MockRedirect(props: { href: string }) {
    redirectHrefRecorder.push(props.href);
    return null;
  }

  function mockUsePathname(): string {
    return mockPathname;
  }

  return {
    Stack: StackSpy,
    Redirect: MockRedirect,
    usePathname: mockUsePathname,
  };
});

// ---------------------------------------------------------------------------
// Lazy module loader.
//
// Re-imports the layout after `vi.resetModules()` so each test observes a
// freshly-initialised module-scope state (the `useState` placeholder for
// `diagnosisRevealSeen` starts at its `false` default on every mount).
// ---------------------------------------------------------------------------
async function loadPostPaymentLayout() {
  const mod: any = await import('../app/(post-payment)/_layout');
  return mod.default;
}

describe('(post-payment) _layout — first-touch diagnosis-reveal gate', () => {
  beforeEach(() => {
    vi.resetModules();
    redirectHrefRecorder.length = 0;
    stackScreenOptionsRecorder.length = 0;
    stackChildrenRecorder.length = 0;
    mockPathname = '/';
  });

  it('default-exports a React component (function)', async () => {
    const PostPaymentLayout = await loadPostPaymentLayout();
    expect(typeof PostPaymentLayout).toBe('function');
  });

  it('on first entry (pathname != diagnosis-reveal) renders a Redirect to /(post-payment)/diagnosis-reveal', async () => {
    // Default pathname `'/'` represents a fresh navigation into the
    // group (e.g. via `router.push('/(post-payment)')`). The layout
    // must short-circuit to the reveal route.
    mockPathname = '/';
    const PostPaymentLayout = await loadPostPaymentLayout();
    render(React.createElement(PostPaymentLayout));

    // Exactly one redirect to the reveal URL.
    expect(redirectHrefRecorder).toEqual(['/(post-payment)/diagnosis-reveal']);
    // No Stack mounted — the layout returned the Redirect directly.
    expect(stackScreenOptionsRecorder).toHaveLength(0);
    expect(stackChildrenRecorder).toHaveLength(0);
  });

  it('also redirects when pathname has trailing segments other than diagnosis-reveal (e.g. tabs index)', async () => {
    // A user landing in the implicit `(tabs)` group on first entry has
    // a pathname whose last segment is one of the tab routes (e.g.
    // `edit`). The redirect must still fire — the layout's first-entry
    // gate is whether the user is ALREADY on the reveal route, not
    // whether they are on the group root.
    mockPathname = '/(post-payment)/(tabs)/edit';
    const PostPaymentLayout = await loadPostPaymentLayout();
    render(React.createElement(PostPaymentLayout));

    expect(redirectHrefRecorder).toEqual(['/(post-payment)/diagnosis-reveal']);
    expect(stackScreenOptionsRecorder).toHaveLength(0);
  });

  it('does NOT redirect when already on the diagnosis-reveal route (loop suppression)', async () => {
    // Without this short-circuit the layout would loop: Redirect →
    // reveal mounts → layout re-renders → Redirect again. The
    // pathname-based guard breaks the loop by letting the Stack render
    // so the reveal screen can finish mounting inside it.
    mockPathname = '/(post-payment)/diagnosis-reveal';
    const PostPaymentLayout = await loadPostPaymentLayout();
    render(React.createElement(PostPaymentLayout));

    expect(redirectHrefRecorder).toHaveLength(0);
    expect(stackScreenOptionsRecorder).toHaveLength(1);
  });

  it('Stack has headerShown: false in its screenOptions (parent default)', async () => {
    // When the Stack renders, headerShown must be false so the
    // diagnosis-reveal and the tabbed shell below it are visually flush
    // with no native header bar (the full-screen-modal presentation
    // depends on the absence of the parent header).
    mockPathname = '/(post-payment)/diagnosis-reveal';
    const PostPaymentLayout = await loadPostPaymentLayout();
    render(React.createElement(PostPaymentLayout));

    expect(stackScreenOptionsRecorder).toHaveLength(1);
    expect(stackScreenOptionsRecorder[0]).toEqual({ headerShown: false });
  });

  it('declares exactly two Stack.Screen children: diagnosis-reveal + (tabs)', async () => {
    // The registry shape IS the contract. Two children, no more no
    // less — a regression that drops `(tabs)` would leave the content
    // surface un-mounted; a regression that drops `diagnosis-reveal`
    // would break the first-touch experience.
    mockPathname = '/(post-payment)/diagnosis-reveal';
    const PostPaymentLayout = await loadPostPaymentLayout();
    render(React.createElement(PostPaymentLayout));

    const names = stackChildrenRecorder.map((c) => c.name).sort();
    expect(names).toEqual(['(tabs)', 'diagnosis-reveal']);
    expect(stackChildrenRecorder).toHaveLength(2);
  });

  it('diagnosis-reveal screen is declared as a full-screen modal with gestureEnabled: false', async () => {
    // These are the knobs that operationalise "first-touch full-screen
    // diagnosis-reveal (no tab bar)" from the Sub-AC contract.
    mockPathname = '/(post-payment)/diagnosis-reveal';
    const PostPaymentLayout = await loadPostPaymentLayout();
    render(React.createElement(PostPaymentLayout));

    const reveal = stackChildrenRecorder.find(
      (c) => c.name === 'diagnosis-reveal',
    );
    expect(reveal).toBeDefined();
    expect(reveal?.options).toEqual({
      presentation: 'fullScreenModal',
      gestureEnabled: false,
    });
  });

  it('(tabs) child is declared with no overriding options (inherits parent screenOptions)', async () => {
    // The (tabs) child group owns its own _layout.tsx — the parent
    // Stack just needs to know the group exists. Any per-screen
    // options would leak into the tab-bar configuration, which is
    // explicitly NOT this layout's responsibility.
    mockPathname = '/(post-payment)/diagnosis-reveal';
    const PostPaymentLayout = await loadPostPaymentLayout();
    render(React.createElement(PostPaymentLayout));

    const tabs = stackChildrenRecorder.find((c) => c.name === '(tabs)');
    expect(tabs).toBeDefined();
    expect(tabs?.options).toBeNull();
  });
});
