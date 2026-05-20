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

interface StubPlatform {
  readonly OS: 'ios';
  readonly select: <T>(specifics: {
    readonly ios?: T;
    readonly android?: T;
    readonly default?: T;
  }) => T | undefined;
}

interface StubReactNative {
  readonly View: StubComponent;
  readonly Text: StubComponent;
  readonly TextInput: StubComponent;
  readonly Image: StubComponent;
  readonly Switch: StubComponent;
  readonly ScrollView: StubComponent;
  readonly Modal: StubComponent;
  readonly Pressable: StubComponent;
  readonly TouchableOpacity: StubComponent;
  readonly Platform: StubPlatform;
  readonly StyleSheet: {
    readonly create: <T extends Record<string, unknown>>(s: T) => T;
    readonly flatten: (s: unknown) => unknown;
    readonly hairlineWidth: number;
    readonly absoluteFill: Record<string, number>;
    readonly absoluteFillObject: Record<string, number>;
  };
  readonly NativeModules: Readonly<Record<string, unknown>>;
  readonly NativeEventEmitter: new (...args: ReadonlyArray<unknown>) => {
    readonly addListener: () => { readonly remove: () => void };
    readonly removeAllListeners: () => void;
  };
  readonly AppState: {
    readonly currentState: 'active';
    readonly addEventListener: () => { readonly remove: () => void };
  };
  readonly Dimensions: {
    readonly get: () => { readonly width: number; readonly height: number };
    readonly addEventListener: () => { readonly remove: () => void };
  };
  readonly Linking: {
    readonly addEventListener: () => { readonly remove: () => void };
    readonly removeAllListeners: () => void;
    readonly getInitialURL: () => Promise<null>;
  };
  readonly Keyboard: {
    readonly addListener: () => { readonly remove: () => void };
    readonly removeAllListeners: () => void;
    readonly dismiss: () => void;
  };
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

  // Platform stub — required by `posthog-react-native`'s CJS dist files
  // (e.g. `dist/utils.js`'s `isMacOS()` reads `Platform.OS`). The route test
  // files already mock `Platform` at the ESM `vi.mock` layer, but
  // `posthog-react-native/dist/native-deps.js` does
  // `var _reactNative=require("react-native")` from inside `node_modules` —
  // a raw CJS path that vitest's mock registry does NOT intercept. The
  // require-cache stub IS the intercept mechanism for that path, so the
  // Platform shape must live here. `OS: 'ios'` is the same default the
  // route tests already pick.
  const platformStub: StubPlatform = {
    OS: 'ios',
    select: <T,>(specifics: {
      readonly ios?: T;
      readonly android?: T;
      readonly default?: T;
    }): T | undefined => specifics.ios ?? specifics.default,
  };
  // Minimal stand-ins for the additional surface `posthog-react-native`
  // touches at module-load time (NativeEventEmitter for queue lifecycle,
  // AppState / Linking for foreground/background hooks, Dimensions for the
  // device-type probe). Each returns inert listeners that no-op on
  // subscription. None of the tests under `apps/mobile/tests/` exercise
  // these surfaces — they exist solely so the PostHog CJS entry can finish
  // its module-load top-level statements without throwing.
  class StubNativeEventEmitter {
    addListener(): { readonly remove: () => void } {
      return { remove: () => undefined };
    }
    removeAllListeners(): void {
      return undefined;
    }
  }
  const appStateStub: StubReactNative['AppState'] = {
    currentState: 'active',
    addEventListener: (): { readonly remove: () => void } => ({
      remove: () => undefined,
    }),
  };
  const dimensionsStub: StubReactNative['Dimensions'] = {
    get: (): { readonly width: number; readonly height: number } => ({
      width: 390,
      height: 844,
    }),
    addEventListener: (): { readonly remove: () => void } => ({
      remove: () => undefined,
    }),
  };
  const linkingStub: StubReactNative['Linking'] = {
    addEventListener: (): { readonly remove: () => void } => ({
      remove: () => undefined,
    }),
    removeAllListeners: (): void => undefined,
    getInitialURL: (): Promise<null> => Promise.resolve(null),
  };
  const styleSheetStub: StubReactNative['StyleSheet'] = {
    create: <T extends Record<string, unknown>>(s: T): T => s,
    flatten: (s: unknown): unknown => s,
    hairlineWidth: 1,
    absoluteFill: {},
    absoluteFillObject: {},
  };
  const keyboardStub: StubReactNative['Keyboard'] = {
    addListener: (): { readonly remove: () => void } => ({
      remove: () => undefined,
    }),
    removeAllListeners: (): void => undefined,
    dismiss: (): void => undefined,
  };

  return {
    View: makeHostComponent('View'),
    Text: makeHostComponent('Text'),
    TextInput: makeHostComponent('TextInput'),
    Image: makeHostComponent('Image'),
    Switch: makeHostComponent('Switch'),
    ScrollView: makeHostComponent('ScrollView'),
    Modal: makeHostComponent('Modal'),
    Pressable: makeHostComponent('Pressable'),
    TouchableOpacity: makeHostComponent('TouchableOpacity'),
    Platform: platformStub,
    StyleSheet: styleSheetStub,
    NativeModules: {},
    NativeEventEmitter:
      StubNativeEventEmitter as unknown as StubReactNative['NativeEventEmitter'],
    AppState: appStateStub,
    Dimensions: dimensionsStub,
    Linking: linkingStub,
    Keyboard: keyboardStub,
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
