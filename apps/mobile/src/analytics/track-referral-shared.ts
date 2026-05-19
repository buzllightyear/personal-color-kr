/**
 * `trackReferralShared` — Phase 2.4 placeholder analytics helper for the
 * step-10 `referral_gate` share-completion event (Sub-AC 18.1).
 *
 * Responsibility:
 *   Surface a typed, snake_case-named entry point that callers (the
 *   referral_gate kakao-share and copy-link handlers, in subsequent
 *   sub-ACs) can invoke when the user successfully completes a share
 *   action. In Phase 2.4 the helper is a NO-OP wrapper around
 *   `console.log` — the real `posthog.capture('referral_shared', payload)`
 *   wiring lands in Phase 2.5 once the analytics surface is approved.
 *
 * Why a placeholder rather than the real PostHog call:
 *   - Seed constraint: "All external SDK interactions are noop placeholders
 *     with TODO comments" — Phase 2.4 ships UI shells only.
 *   - Seed constraint: "console.log placeholder + TODO comment pattern for
 *     unimplemented SDK integrations" — codifies exactly this wrapper.
 *   - The placeholder is shaped so the Phase 2.5 swap is a one-line edit:
 *     replace the `console.log(...)` body with
 *     `posthog.capture(REFERRAL_SHARED_EVENT_NAME, payload)` (and inject
 *     the client). The exported event-name constant prevents drift between
 *     the placeholder log and the future capture call.
 *
 * Why snake_case + verb form (`referral_shared`):
 *   Seed constraint: "PostHog event names use snake_case + verb form for
 *   Phase 2.5 reuse". Matches the precedent set by the root-layout
 *   auto-capture (`funnel_step_entered` — see
 *   `tests/funnel-step-entered-capture.test.tsx`) so the analytics surface
 *   stays internally consistent.
 *
 * Why the payload is a structured object (not a flat method string):
 *   PostHog's `capture(name, properties)` takes an object, so shaping the
 *   placeholder around an object now keeps the call-site identical when
 *   the real client is wired. Today `method` is the only field; future
 *   extension (e.g. `share_source: 'gate' | 'social_evolution'`) requires
 *   no caller-site change — only an additive widening of
 *   `TrackReferralSharedPayload`.
 *
 * Why no PostHog dependency import:
 *   Phase 2.4 deliberately keeps this module dependency-free so it is
 *   trivially testable in vitest's node environment without mocking
 *   `posthog-react-native`. The Phase 2.5 swap will introduce a thin
 *   wrapper that accepts the client via DI rather than module-level
 *   coupling, mirroring the singleton-via-hook pattern already used in
 *   `src/providers/PostHogProvider.tsx`.
 */

/**
 * Share method that produced the `referral_shared` event on
 * `referral_gate` (step 10).
 *
 *   - `kakao`     — KakaoTalk share-sheet placeholder
 *     (Sub-AC 18.x — TODO(phase-2.5): real Kakao SDK).
 *   - `copy_link` — clipboard copy-link placeholder.
 *
 * No `other` / free-text branch by design — PostHog property values are
 * easier to query when the domain is closed.
 */
export type ReferralShareMethod = 'kakao' | 'copy_link';

/**
 * Structured payload accompanying every `referral_shared` placeholder
 * event. Shaped to match a future
 * `posthog.capture('referral_shared', payload)` call signature 1-to-1.
 *
 * `readonly` end-to-end so a downstream consumer cannot mutate the object
 * after handing it to `trackReferralShared` — matches the immutability
 * stance enforced across the rest of the funnel contracts (e.g.
 * `FunnelStateValue` in `src/contracts/funnel-state.ts`).
 */
export interface TrackReferralSharedPayload {
  readonly method: ReferralShareMethod;
}

/**
 * Snake_case event-name literal used both by the Phase 2.4 placeholder
 * `console.log` and (in Phase 2.5) by the real `posthog.capture(...)`
 * call. Exported so unit tests can assert against the constant rather
 * than a duplicated string literal — drift between the placeholder and
 * the future capture call becomes a compile-time failure once a single
 * import-site catches the rename.
 */
export const REFERRAL_SHARED_EVENT_NAME = 'referral_shared' as const;

/**
 * Phase 2.4 placeholder for the PostHog `referral_shared` capture.
 *
 * Logs the event name + payload to the console and returns nothing. In
 * Phase 2.5 the body becomes
 * `posthog.capture(REFERRAL_SHARED_EVENT_NAME, payload)`; the public
 * signature stays identical so no call-site change is required.
 *
 * @param payload - structured event properties; see
 *   {@link TrackReferralSharedPayload}.
 */
export function trackReferralShared(payload: TrackReferralSharedPayload): void {
  // TODO(phase-2.5): Replace this console.log with the real PostHog call:
  //   const posthog = usePostHog(); // or DI'd client
  //   posthog?.capture(REFERRAL_SHARED_EVENT_NAME, payload);
  // The placeholder prefix `[analytics:placeholder]` makes the no-op
  // visible in dev logs without polluting the structured event-name slot —
  // tests assert against `REFERRAL_SHARED_EVENT_NAME` and `payload`, not
  // the prefix, so it can be tweaked freely.
  // eslint-disable-next-line no-console
  console.log('[analytics:placeholder]', REFERRAL_SHARED_EVENT_NAME, payload);
}
