import { normalizeEmail } from "./checkout-ownership";
import { getSql } from "./db";
import {
  getPurchaseByChargeId,
  getPurchaseById,
  getPurchaseByPaymentIntentId,
  type PurchaseRow,
} from "./purchases";

export const SUCCEEDED_REFUND_STATUS = "succeeded";

export type RefundStatus = "paid" | "partially_refunded" | "fully_refunded";

export type StripeRefundRecordInput = {
  stripeRefundId: string;
  amountCents: number;
  currency: string;
  status: string;
  stripeChargeId: string | null;
  stripePaymentIntentId: string | null;
  reason: string | null;
  processedAt: Date | null;
};

export function refundStatusFromAmounts(
  amountCents: number | null,
  succeededRefundCents: number,
): RefundStatus {
  if (amountCents == null || amountCents <= 0) {
    return succeededRefundCents > 0 ? "partially_refunded" : "paid";
  }
  if (succeededRefundCents <= 0) return "paid";
  if (succeededRefundCents >= amountCents) return "fully_refunded";
  return "partially_refunded";
}

export function isPurchaseValidForEntitlement(
  amountCents: number | null,
  succeededRefundCents: number,
): boolean {
  return refundStatusFromAmounts(amountCents, succeededRefundCents) !== "fully_refunded";
}

export async function recomputeEntitlement(
  email: string,
  bookId: string,
): Promise<{ validPurchaseCount: number; entitled: boolean }> {
  const sql = getSql();
  const normalized = normalizeEmail(email);
  const rows = await sql`
    WITH purchase_refund_totals AS (
      SELECT
        p.id,
        p.email,
        p.book_id,
        p.amount_cents,
        p.purchased_at,
        COALESCE((
          SELECT SUM(pr.amount_cents)
          FROM purchase_refunds pr
          WHERE pr.purchase_id = p.id
            AND pr.status = ${SUCCEEDED_REFUND_STATUS}
        ), 0)::int AS succeeded_refund_cents
      FROM purchases p
      WHERE p.email = ${normalized} AND p.book_id = ${bookId}
    ),
    status_updated AS (
      UPDATE purchases p
      SET
        refund_status = CASE
          WHEN t.amount_cents IS NULL OR t.amount_cents <= 0 THEN
            CASE WHEN t.succeeded_refund_cents > 0 THEN 'partially_refunded' ELSE 'paid' END
          WHEN t.succeeded_refund_cents <= 0 THEN 'paid'
          WHEN t.succeeded_refund_cents >= t.amount_cents THEN 'fully_refunded'
          ELSE 'partially_refunded'
        END,
        fully_refunded_at = CASE
          WHEN t.amount_cents IS NOT NULL
            AND t.amount_cents > 0
            AND t.succeeded_refund_cents >= t.amount_cents
          THEN COALESCE(p.fully_refunded_at, NOW())
          ELSE NULL
        END
      FROM purchase_refund_totals t
      WHERE p.id = t.id
      RETURNING p.id, p.email, p.book_id, p.refund_status, p.purchased_at
    ),
    valid AS (
      SELECT id, email, book_id, purchased_at
      FROM status_updated
      WHERE refund_status IS DISTINCT FROM 'fully_refunded'
      ORDER BY purchased_at ASC, id ASC
    ),
    chosen AS (
      SELECT * FROM valid
      LIMIT 1
    ),
    deleted AS (
      DELETE FROM entitlements e
      WHERE e.email = ${normalized}
        AND e.book_id = ${bookId}
        AND NOT EXISTS (SELECT 1 FROM chosen)
      RETURNING e.email
    ),
    upserted AS (
      INSERT INTO entitlements (email, book_id, first_purchase_id)
      SELECT email, book_id, id FROM chosen
      ON CONFLICT (email, book_id) DO UPDATE
        SET first_purchase_id = EXCLUDED.first_purchase_id
      RETURNING email
    )
    SELECT
      (SELECT COUNT(*)::int FROM valid) AS valid_count,
      (SELECT COUNT(*)::int FROM deleted) AS deleted_count,
      (SELECT COUNT(*)::int FROM upserted) AS upserted_count
  `;

  const validPurchaseCount = Number(rows[0]?.valid_count ?? 0);
  return {
    validPurchaseCount,
    entitled: validPurchaseCount > 0,
  };
}

async function findPurchaseForRefund(
  input: StripeRefundRecordInput,
): Promise<PurchaseRow | null> {
  if (input.stripePaymentIntentId) {
    const byPi = await getPurchaseByPaymentIntentId(input.stripePaymentIntentId);
    if (byPi) return byPi;
  }
  if (input.stripeChargeId) {
    const byCharge = await getPurchaseByChargeId(input.stripeChargeId);
    if (byCharge) return byCharge;
  }
  return null;
}

/**
 * Idempotently records a Stripe refund and recomputes purchase status + entitlement.
 * Does not call Stripe. Does not create refunds.
 */
export async function recordStripeRefundAndRecompute(
  input: StripeRefundRecordInput,
): Promise<{ purchase: PurchaseRow | null; unmatched: boolean }> {
  const purchase = await findPurchaseForRefund(input);
  if (!purchase) {
    return { purchase: null, unmatched: true };
  }

  const sql = getSql();
  const processedAt = input.processedAt?.toISOString() ?? null;

  await sql`
    INSERT INTO purchase_refunds (
      purchase_id,
      stripe_refund_id,
      amount_cents,
      currency,
      status,
      stripe_charge_id,
      processed_at,
      reason
    )
    VALUES (
      ${purchase.id}::uuid,
      ${input.stripeRefundId},
      ${input.amountCents},
      ${input.currency},
      ${input.status},
      ${input.stripeChargeId},
      ${processedAt}::timestamptz,
      ${input.reason}
    )
    ON CONFLICT (stripe_refund_id) DO UPDATE SET
      amount_cents = EXCLUDED.amount_cents,
      currency = EXCLUDED.currency,
      status = EXCLUDED.status,
      stripe_charge_id = COALESCE(EXCLUDED.stripe_charge_id, purchase_refunds.stripe_charge_id),
      processed_at = EXCLUDED.processed_at,
      reason = EXCLUDED.reason
  `;

  await recomputeEntitlement(purchase.email, purchase.bookId);
  const refreshed = await getPurchaseById(purchase.id);
  return { purchase: refreshed ?? purchase, unmatched: false };
}
