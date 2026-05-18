/**
 * Funnel placeholder — payment_model (Phase 2.1, step 12 of 12, KR variant)
 *
 * Internal-only terminal step. The placeholder omits `onNext` because
 * the real screen transitions to the post-payment area (`/(post-payment)/diagnosis`)
 * only after a successful Superwall + StoreKit charge, which lands in
 * Phase 2.5.
 */
import { FunnelPlaceholder } from '../../src/funnel-placeholder';

export default function PaymentModelScreen(): JSX.Element {
  return <FunnelPlaceholder stepId="payment_model" />;
}
