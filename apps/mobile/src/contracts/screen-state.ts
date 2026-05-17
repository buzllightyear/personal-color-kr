/**
 * ScreenState — async boundary contract for Python-dependent screens.
 *
 * This union represents the three observable phases a screen can be in while
 * resolving data from an async source (currently the dummy data hook in the
 * shell, eventually the Python bridge introduced in Phase 3/4).
 *
 * Consumers (screens, hooks, layouts) MUST exhaustively handle every member of
 * the union so the navigation shell never renders against partial state.
 *
 *   'loading' — the data hook is in flight; render a skeleton / spinner.
 *   'ready'   — data has resolved successfully; safe to render the screen.
 *   'error'   — the data hook failed; render an error boundary / retry CTA.
 *
 * This contract is intentionally minimal. It pairs with the `DataHook<T>`
 * shape so that `useDummy<T>()` (shell) and the future `usePython<T>()`
 * (Phase 3/4) are interchangeable at call sites.
 */
export type ScreenState = 'loading' | 'ready' | 'error';
