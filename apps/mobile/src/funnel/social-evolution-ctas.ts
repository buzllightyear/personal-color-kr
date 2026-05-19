/**
 * `social-evolution-ctas.ts` — frozen Korean CTA text constants for the
 * step-11 `social_evolution` screen (Phase 2.4, KR variant).
 *
 * Why this module exists (Sub-AC 26):
 *   Per the Seed constraint "Hardcoded constants isolated in dedicated
 *   selector/options files", the Korean copy rendered on
 *   `social_evolution`'s two-branch UI (shared=true empty-state +
 *   shared=false upsell-to-share) must NOT live as string literals
 *   inside the screen component. Isolating them here gives the codebase:
 *
 *     1. Branch-safe symmetry. `shared=true` (the user already shared at
 *        `referral_gate`) renders a single "다음으로" forward CTA. The
 *        `shared=false` branch (user skipped at `referral_gate`) renders
 *        a soft-gate pair — a "친구에게 공유하기" CTA that routes BACK
 *        to `referral_gate` (per Seed: "shared=false social_evolution
 *        links back to referral_gate for sharing — no duplicate share
 *        functionality on social_evolution") plus a quiet skip CTA so
 *        the screen still honours the soft-gate invariant. Keeping all
 *        four labels named and exported separately lets the screen
 *        branch ergonomically without re-grepping for the right
 *        literal at every render.
 *     2. Drift-free copy review. When the Phase 2.5 localisation pass
 *        rewrites the upsell line, the change is a one-line edit here.
 *
 * What this module is NOT:
 *   - Not a navigation handler. The labels here are *strings only*; the
 *     route file (`app/(funnel)/social-evolution.tsx`) decides whether
 *     a press fires `router.push('/(funnel)/referral-gate')` (back to
 *     share) or `router.push('/(funnel)/payment-model')` (forward).
 *   - Not a share-action emitter. `social_evolution` MUST NOT contain
 *     Kakao share / copy-link surfaces — the only path back to a share
 *     action is the "친구에게 공유하기" CTA which navigates to
 *     `referral_gate`.
 *
 * Source-of-truth alignment:
 *   `FUNNEL_SCREENS.social_evolution.ctas[0]` carries the canonical
 *   "계속" primary label from the v0.2 funnel spec for the
 *   `advance` action. Phase 2.4 keeps the spirit (forward-progress CTA
 *   in the shared=true branch) but elongates the copy slightly to
 *   "다음으로" so the post-result-engagement rhythm reads less abrupt.
 *   The `FUNNEL_SCREENS.social_evolution` headline / subhead still
 *   drive the screen's heading area — these CTA constants only govern
 *   the button row.
 */

/**
 * Korean label rendered on the forward CTA when the user has already
 * shared at `referral_gate` (i.e. `funnelState.referral.shared === true`).
 *
 * The route handler advances to `payment-model` via `router.push` —
 * push (not replace) so the user can back-swipe to revisit the social
 * proof if they hesitate.
 */
export const SOCIAL_EVOLUTION_CONTINUE_CTA_LABEL = '다음으로' as const;

/**
 * Korean label rendered on the upsell CTA when the user skipped at
 * `referral_gate` (i.e. `funnelState.referral.shared === false`).
 *
 * The route handler routes BACK to `referral_gate` via `router.push`
 * so the user lands on the canonical share surface. We deliberately
 * avoid duplicating the share buttons on `social_evolution` —
 * `referral_gate` remains the single source of truth for share
 * functionality (per Seed: "no duplicate share functionality on
 * social_evolution").
 */
export const SOCIAL_EVOLUTION_SHARE_AGAIN_CTA_LABEL = '친구에게 공유하기' as const;

/**
 * Korean label rendered on the quiet skip CTA in the `shared=false`
 * branch. The screen is a soft gate — every gate in Phase 2.4 honours
 * the "no hard gating blocks progression" invariant — so even the
 * "user skipped share" branch MUST offer a forward path that bypasses
 * the upsell.
 *
 * Phrased identically to the `referral_gate` skip label ("나중에 할게요")
 * so the soft-gate rhythm reads consistent across steps 10 / 11 / 12.
 */
export const SOCIAL_EVOLUTION_SKIP_CTA_LABEL = '나중에 할게요' as const;
