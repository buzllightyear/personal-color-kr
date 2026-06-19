/**
 * React 19 global `JSX` namespace shim.
 *
 * React 19 (`@types/react@^19`) removed the ambient **global** `JSX` namespace
 * that older versions declared, moving it under `React.JSX` to avoid collisions
 * between multiple JSX-producing libraries in one program. JSX *expressions*
 * still type-check (the compiler resolves intrinsics via the configured JSX
 * factory), but bare type annotations written as `JSX.Element` — the convention
 * used throughout this app's function components — now fail with
 * `TS2503: Cannot find namespace 'JSX'`.
 *
 * This single ambient declaration re-establishes the global `JSX` namespace as a
 * thin alias of `React.JSX`. It is the documented React 19 migration escape
 * hatch for projects that want to keep the `JSX.*` spelling without rewriting
 * every annotation to `React.JSX.*`. Safe here because this React Native app has
 * exactly one JSX runtime (React), so there is nothing for the global to collide
 * with.
 */
import type * as React from 'react';

declare global {
  namespace JSX {
    type ElementType = React.JSX.ElementType;
    type Element = React.JSX.Element;
    type ElementClass = React.JSX.ElementClass;
    type ElementAttributesProperty = React.JSX.ElementAttributesProperty;
    type ElementChildrenAttribute = React.JSX.ElementChildrenAttribute;
    type LibraryManagedAttributes<C, P> = React.JSX.LibraryManagedAttributes<C, P>;
    type IntrinsicAttributes = React.JSX.IntrinsicAttributes;
    type IntrinsicClassAttributes<T> = React.JSX.IntrinsicClassAttributes<T>;
    type IntrinsicElements = React.JSX.IntrinsicElements;
  }
}
