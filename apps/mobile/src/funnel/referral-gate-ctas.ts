/**
 * `referral-gate-ctas.ts` — frozen Korean CTA text constants for the
 * step-10 `referral_gate` screen (Phase 2.4, KR variant).
 *
 * Why this module exists (Sub-AC 26):
 *   Per the Seed constraint "Hardcoded constants isolated in dedicated
 *   selector/options files", the Korean copy that the `referral_gate`
 *   screen renders on its three soft-gate controls (Kakao share, copy
 *   link, skip) must NOT be inlined as string literals inside the screen
 *   component. Isolating them here gives the codebase a single import
 *   site for:
 *
 *     1. Drift-free Phase 2.5 swap. When the real Kakao SDK lands and the
 *        copy is reviewed by the localisation team, the change is a one-
 *        line edit here — every screen + every test picks it up
 *        automatically via the named export.
 *     2. Compile-time exhaustiveness. The Kakao / copy-link split is
 *        keyed by {@link ReferralShareMethod} (sourced from
 *        `src/analytics/track-referral-shared.ts`), so a future widening
 *        of the share-method domain becomes a TypeScript error here until
 *        the corresponding Korean label is added — exactly the kind of
 *        coupling we want between analytics + presentation.
 *     3. Test-without-React-Native. The constants module is pure data
 *        (no `react-native` imports), so its tests run in vitest's node
 *        environment without the `setup-rn-stub` shim. Mirrors the same
 *        ergonomics the `scan-options.ts` selector enabled for step 6.
 *
 * What this module is NOT:
 *   - Not a navigation handler. The CTAs here are *labels only*; the
 *     `router.replace` / `router.push` wiring lives in the route file
 *     (`app/(funnel)/referral-gate.tsx`).
 *   - Not a PostHog event emitter. The `referral_shared` /
 *     `referral_skipped` placeholder logs live in
 *     `src/analytics/track-referral-*.ts`.
 *   - Not an SDK adapter. No Kakao SDK reference appears here — every
 *     external SDK touch is a `console.log` + `TODO(phase-2.5)`
 *     placeholder per Seed contract.
 *
 * Source-of-truth alignment:
 *   `FUNNEL_SCREENS.referral_gate.ctas[0]` carries the canonical
 *   "공유하고 계속" label from the v0.2 funnel spec, which is the
 *   single-button primary-CTA representation. Phase 2.4 splits that
 *   single button into three controls (Kakao + copy link + skip) per
 *   the UI shell goal. The Korean labels here therefore extend (rather
 *   than override) the v0.2 copy — they are the Phase-2.4-specific
 *   surface the headline / subhead from `FUNNEL_SCREENS.referral_gate`
 *   sit above.
 */
import type { ReferralShareMethod } from '../analytics/track-referral-shared';

/**
 * Frozen map from share method → Korean CTA label rendered on the
 * matching share-action button.
 *
 *   - `kakao`     → "카카오톡으로 공유" (primary share path; surfaces the
 *     KakaoTalk share-sheet placeholder in Phase 2.4).
 *   - `copy_link` → "링크 복사" (secondary share path; surfaces the
 *     clipboard copy-link placeholder).
 *
 * Keyed on {@link ReferralShareMethod} so a future widening of the
 * share-method domain (e.g. SMS, native share-sheet) becomes a
 * TypeScript error on this map until the corresponding label is added.
 *
 * Frozen so a test that accidentally tries to mutate it fails loudly
 * rather than silently corrupting other tests via the shared reference —
 * same defensive stance as `INITIAL_FUNNEL_REFERRAL` /
 * `INITIAL_FUNNEL_PAYMENT` in `src/contracts/funnel-state.ts`.
 */
export const REFERRAL_GATE_SHARE_CTA_LABELS: Readonly<
  Record<ReferralShareMethod, string>
> = Object.freeze({
  kakao: '카카오톡으로 공유',
  copy_link: '링크 복사',
});

/**
 * Korean label rendered on the soft-gate skip control. The control is
 * intentionally subdued ("나중에 할게요" rather than "건너뛰기") so it
 * reads as opt-out, not a competing action — mirroring the iOS rating
 * dialog "나중에" copy already used at step 4 (`rating_gate`).
 *
 * Constraint: every screen in Phase 2.4 is a soft gate, so the skip
 * label MUST stay present in every CTA constants file.
 */
export const REFERRAL_GATE_SKIP_CTA_LABEL = '나중에 할게요' as const;
