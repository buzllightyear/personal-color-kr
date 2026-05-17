/**
 * Vitest setup file — installs a stub for `react-native` in Node's CJS
 * require cache so that any transitively-loaded helper module of
 * `@testing-library/react-native` that does `require('react-native')` at the
 * top of the file resolves to a parseable object.
 *
 * Why a require-cache stub instead of `vi.mock` or `resolve.alias`:
 *   - `vi.mock('react-native')` only intercepts modules vitest loads via its
 *     own transformer. The testing library's helper files (e.g.
 *     `build/helpers/host-component-names.js`) are CommonJS files under
 *     `node_modules/` and their `require('react-native')` calls go through
 *     Node's CJS loader directly, bypassing vitest's mock registry.
 *   - `resolve.alias` for `react-native` likewise only applies to imports
 *     vitest itself resolves — the same CJS-from-node_modules path skips it.
 *   - Pre-populating `require.cache` is the canonical way to swap a CJS
 *     dependency before any caller can require it. This setup file runs
 *     before any test file is evaluated, guaranteeing the stub is in place
 *     by the time `@testing-library/react-native` is first imported.
 *
 * Why we need this at all:
 *   `react-native/index.js` ships with Flow's `import typeof` syntax which
 *   Node cannot parse natively (Metro normally strips it at build time).
 *   The testing library's render() path uses `react-test-renderer` and
 *   never actually exercises a native component — but its helper modules
 *   `require('react-native')` purely to read type-only enums and prop
 *   shapes. An empty object satisfies their access patterns without
 *   crashing Node's parser on the Flow syntax.
 *
 * Scope:
 *   This stub only affects the vitest runtime (the file is referenced via
 *   `test.setupFiles` in `vitest.config.ts`). The Expo Metro bundler and
 *   the typescript build are unaffected.
 */
import Module from 'node:module';
import * as path from 'node:path';

const reactNativeId: string = 'react-native';

/**
 * Resolve the canonical filesystem path Node would use for
 * `require('react-native')` so we can park our stub under the same key in
 * `require.cache`. Resolving from the workspace root mirrors how the testing
 * library's helper modules (also living in `node_modules/`) will resolve it.
 */
function resolveReactNativeEntry(): string {
  const req = Module.createRequire(path.resolve(__dirname, '../../'));
  return req.resolve(reactNativeId);
}

/**
 * Minimal stub exports for the host components `@testing-library/react-native`
 * inspects when it auto-detects host component names. The library renders
 * `<View>`, `<Text testID="text">`, `<TextInput />`, `<Image />`, `<Switch />`,
 * `<ScrollView />`, `<Modal />` and reads back each node's `.type` from the
 * react-test-renderer tree. To survive that probe we expose each name as a
 * *host* component — a function whose `React.createElement` call returns a
 * string-typed element, which react-test-renderer treats as a host node and
 * exposes via `.type`. The string label doubles as the host-component-name
 * the testing library memoises in its internal config.
 */
type StubComponent = (props: Record<string, unknown>) => unknown;

interface StubReactNative {
  readonly View: StubComponent;
  readonly Text: StubComponent;
  readonly TextInput: StubComponent;
  readonly Image: StubComponent;
  readonly Switch: StubComponent;
  readonly ScrollView: StubComponent;
  readonly Modal: StubComponent;
}

function makeStubExports(): StubReactNative {
  // We require React from the same workspace `node_modules/react` so the
  // element factory returns the same `react` instance the testing library
  // walks. The vitest `resolve.alias` block pins this for ESM imports, but
  // setup files run before that alias is applied — Node's require resolution
  // from the apps/mobile root reaches the same physical file, which is
  // enough for the host-component probe.
  const reactRoot = path.resolve(__dirname, '../../');
  const reactRequire = Module.createRequire(path.join(reactRoot, 'package.json'));
  const React = reactRequire('react') as {
    readonly createElement: (
      type: string,
      props: Record<string, unknown> | null,
      ...children: unknown[]
    ) => unknown;
  };

  function makeHostComponent(label: string): StubComponent {
    return function HostComponent(props: Record<string, unknown>) {
      // Forward `testID` (the testing library probe queries by it) and any
      // children. Rendering the host as a string type makes
      // react-test-renderer surface it as a host node — that's the contract
      // `detectHostComponentNames` relies on.
      return React.createElement(label, props, (props as { children?: unknown }).children);
    };
  }

  return {
    View: makeHostComponent('View'),
    Text: makeHostComponent('Text'),
    TextInput: makeHostComponent('TextInput'),
    Image: makeHostComponent('Image'),
    Switch: makeHostComponent('Switch'),
    ScrollView: makeHostComponent('ScrollView'),
    Modal: makeHostComponent('Modal'),
  };
}

/**
 * Build a minimal `Module` instance whose `exports` contains the host
 * component stubs and install it under the canonical cache key. The next
 * `require('react-native')` inside any CJS dependency hits the cache and
 * skips evaluating the real `react-native/index.js` (the file Node cannot
 * parse).
 */
function installReactNativeStub(): void {
  const entry: string = resolveReactNativeEntry();
  // `new Module(filename, parent?)` accepts `undefined` for a top-level
  // module; passing `null` matches the historical CJS implementation but is
  // not in the `@types/node` signature. We use `undefined` to satisfy the
  // type-checker; the runtime semantics are identical.
  const stub = new Module(entry, undefined);
  stub.filename = entry;
  stub.loaded = true;
  stub.exports = makeStubExports();
  require.cache[entry] = stub;
}

installReactNativeStub();
