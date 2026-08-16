import { normalizeEmail } from "./checkout-ownership";
import { getSql } from "./db";
import { recomputeEntitlement } from "./purchase-refunds";

export { normalizeEmail };

export type RefundStatus = "paid" | "partially_refunded" | "fully_refunded";

export type PurchaseRow = {
  id: string;
  email: string;
  bookId: string;
  stripeCheckoutSessionId: string;
  stripePaymentIntentId: string | null;
  amountCents: number | null;
  currency: string | null;
  stripeChargeId: string | null;
  refundStatus: RefundStatus;
  fullyRefundedAt: Date | null;
  purchasedAt: Date;
};

export type EntitlementRow = {
  email: string;
  bookId: string;
  firstPurchaseId: string;
  grantedAt: Date;
};

export type RecordPurchaseInput = {
  email: string;
  bookId: string;
  stripeCheckoutSessionId: string;
  stripePaymentIntentId: string | null;
  amountCents?: number | null;
  currency?: string | null;
  stripeChargeId?: string | null;
};

function asDate(value: unknown): Date {
  if (value instanceof Date) return value;
  return new Date(String(value));
}

function mapRefundStatus(value: unknown): RefundStatus {
  if (
    value === "paid" ||
    value === "partially_refunded" ||
    value === "fully_refunded"
  ) {
    return value;
  }
  return "paid";
}

function mapPurchase(row: Record<string, unknown>): PurchaseRow {
  return {
    id: String(row.id),
    email: String(row.email),
    bookId: String(row.book_id),
    stripeCheckoutSessionId: String(row.stripe_checkout_session_id),
    stripePaymentIntentId:
      row.stripe_payment_intent_id == null
        ? null
        : String(row.stripe_payment_intent_id),
    amountCents:
      row.amount_cents == null ? null : Number(row.amount_cents),
    currency: row.currency == null ? null : String(row.currency),
    stripeChargeId:
      row.stripe_charge_id == null ? null : String(row.stripe_charge_id),
    refundStatus: mapRefundStatus(row.refund_status),
    fullyRefundedAt:
      row.fully_refunded_at == null ? null : asDate(row.fully_refunded_at),
    purchasedAt: asDate(row.purchased_at),
  };
}

function mapEntitlement(row: Record<string, unknown>): EntitlementRow {
  return {
    email: String(row.email),
    bookId: String(row.book_id),
    firstPurchaseId: String(row.first_purchase_id),
    grantedAt: asDate(row.granted_at),
  };
}

export async function getPurchaseByCheckoutSessionId(
  stripeCheckoutSessionId: string,
): Promise<PurchaseRow | null> {
  const sql = getSql();
  const rows = await sql`
    SELECT id, email, book_id, stripe_checkout_session_id,
           stripe_payment_intent_id, amount_cents, currency, stripe_charge_id,
           refund_status, fully_refunded_at, purchased_at
    FROM purchases
    WHERE stripe_checkout_session_id = ${stripeCheckoutSessionId}
    LIMIT 1
  `;
  const row = rows[0];
  return row ? mapPurchase(row as Record<string, unknown>) : null;
}

export async function getPurchaseById(id: string): Promise<PurchaseRow | null> {
  const sql = getSql();
  const rows = await sql`
    SELECT id, email, book_id, stripe_checkout_session_id,
           stripe_payment_intent_id, amount_cents, currency, stripe_charge_id,
           refund_status, fully_refunded_at, purchased_at
    FROM purchases
    WHERE id = ${id}::uuid
    LIMIT 1
  `;
  const row = rows[0];
  return row ? mapPurchase(row as Record<string, unknown>) : null;
}

export async function getPurchaseByPaymentIntentId(
  stripePaymentIntentId: string,
): Promise<PurchaseRow | null> {
  const sql = getSql();
  const rows = await sql`
    SELECT id, email, book_id, stripe_checkout_session_id,
           stripe_payment_intent_id, amount_cents, currency, stripe_charge_id,
           refund_status, fully_refunded_at, purchased_at
    FROM purchases
    WHERE stripe_payment_intent_id = ${stripePaymentIntentId}
    LIMIT 1
  `;
  const row = rows[0];
  return row ? mapPurchase(row as Record<string, unknown>) : null;
}

export async function getPurchaseByChargeId(
  stripeChargeId: string,
): Promise<PurchaseRow | null> {
  const sql = getSql();
  const rows = await sql`
    SELECT id, email, book_id, stripe_checkout_session_id,
           stripe_payment_intent_id, amount_cents, currency, stripe_charge_id,
           refund_status, fully_refunded_at, purchased_at
    FROM purchases
    WHERE stripe_charge_id = ${stripeChargeId}
    LIMIT 1
  `;
  const row = rows[0];
  return row ? mapPurchase(row as Record<string, unknown>) : null;
}

export async function hasEntitlement(
  email: string,
  bookId: string,
): Promise<boolean> {
  const sql = getSql();
  const normalized = normalizeEmail(email);
  const rows = await sql`
    SELECT 1
    FROM entitlements
    WHERE email = ${normalized} AND book_id = ${bookId}
    LIMIT 1
  `;
  return rows.length > 0;
}

export async function getEntitlement(
  email: string,
  bookId: string,
): Promise<EntitlementRow | null> {
  const sql = getSql();
  const normalized = normalizeEmail(email);
  const rows = await sql`
    SELECT email, book_id, first_purchase_id, granted_at
    FROM entitlements
    WHERE email = ${normalized} AND book_id = ${bookId}
    LIMIT 1
  `;
  const row = rows[0];
  return row ? mapEntitlement(row as Record<string, unknown>) : null;
}

/**
 * Inserts a purchase and recomputes entitlement from currently valid purchases.
 * Duplicate Stripe checkout sessions are treated as success (idempotent).
 * A fully refunded purchase will not restore access on replay.
 */
export async function recordPurchaseAndEntitlement(
  input: RecordPurchaseInput,
): Promise<{ created: boolean; purchase: PurchaseRow }> {
  const sql = getSql();
  const email = normalizeEmail(input.email);
  const purchaseId = crypto.randomUUID();
  const amountCents = input.amountCents ?? null;
  const currency = input.currency?.trim() || null;
  const stripeChargeId = input.stripeChargeId?.trim() || null;

  try {
    await sql`
      INSERT INTO purchases (
        id,
        email,
        book_id,
        stripe_checkout_session_id,
        stripe_payment_intent_id,
        amount_cents,
        currency,
        stripe_charge_id,
        refund_status
      )
      VALUES (
        ${purchaseId}::uuid,
        ${email},
        ${input.bookId},
        ${input.stripeCheckoutSessionId},
        ${input.stripePaymentIntentId},
        ${amountCents},
        ${currency},
        ${stripeChargeId},
        'paid'
      )
      ON CONFLICT (stripe_checkout_session_id) DO NOTHING
    `;
  } catch (error) {
    const code =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof (error as { code: unknown }).code === "string"
        ? (error as { code: string }).code
        : "";
    if (code !== "23505") {
      throw error;
    }
  }

  const purchase = await getPurchaseByCheckoutSessionId(
    input.stripeCheckoutSessionId,
  );
  if (!purchase) {
    throw new Error("Purchase was not recorded.");
  }

  await recomputeEntitlement(purchase.email, purchase.bookId);

  return {
    created: purchase.id === purchaseId,
    purchase,
  };
}

export async function countPurchasesForEmailAndBook(
  email: string,
  bookId: string,
): Promise<number> {
  const sql = getSql();
  const normalized = normalizeEmail(email);
  const rows = await sql`
    SELECT COUNT(*)::int AS count
    FROM purchases
    WHERE email = ${normalized} AND book_id = ${bookId}
  `;
  return Number(rows[0]?.count ?? 0);
}

export async function listEntitlementsForEmail(
  email: string,
): Promise<EntitlementRow[]> {
  const sql = getSql();
  const normalized = normalizeEmail(email);
  const rows = await sql`
    SELECT email, book_id, first_purchase_id, granted_at
    FROM entitlements
    WHERE email = ${normalized}
    ORDER BY granted_at ASC
  `;
  return rows.map((row) => mapEntitlement(row as Record<string, unknown>));
}
