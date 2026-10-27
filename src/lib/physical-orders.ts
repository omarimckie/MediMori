import { getSql } from "./db";
import { normalizeEmail } from "./checkout-ownership";
import { INVENTORY_DISCREPANCY_ACKNOWLEDGED } from "./order-notifications/inventory-resolution";
import {
  shippingFingerprint,
  type ShipmentDetails,
  type ShippingClaimResult,
  type ShippingCorrectionResult,
  type ShippingNoticeErrorCode,
  type ShippingSaveResult,
} from "./order-notifications/shipping-carriers";

export type PhysicalFulfillmentStatus =
  | "unfulfilled"
  | "shipped"
  | "cancelled"
  | "refunded";

export type PhysicalInventoryState = "pending" | "processing" | "applied" | "failed";

export type ShippingAddressSnapshot = {
  name: string | null;
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
};

export type PhysicalOrderRow = {
  id: string;
  stripeCheckoutSessionId: string;
  stripePaymentIntentId: string | null;
  bookId: string;
  quantity: number;
  unitPriceCents: number;
  shippingPriceCents: number;
  totalAmountCents: number;
  customerName: string;
  customerEmail: string;
  shippingAddress: ShippingAddressSnapshot;
  shippingAddressMissing: boolean;
  paymentStatus: string;
  inventoryState: PhysicalInventoryState;
  attentionFlags: string[];
  fulfillmentStatus: PhysicalFulfillmentStatus;
  trackingNumber: string | null;
  carrier: string | null;
  shippingNoticeStatus: "pending" | "sending" | "sent" | "failed" | null;
  shippingNoticeSentFingerprint: string | null;
  shippingNoticeError: ShippingNoticeErrorCode | null;
  shippingNoticeSentAt: Date | null;
  purchasedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type RecordPhysicalOrderInput = {
  stripeCheckoutSessionId: string;
  stripePaymentIntentId: string | null;
  bookId: string;
  quantity: number;
  unitPriceCents: number;
  shippingPriceCents: number;
  totalAmountCents: number;
  customerName: string;
  customerEmail: string;
  shippingAddress: ShippingAddressSnapshot;
  shippingAddressMissing?: boolean;
  attentionFlags?: string[];
  fulfillmentStatus: PhysicalFulfillmentStatus;
};

function asDate(value: unknown): Date {
  if (value instanceof Date) return value;
  return new Date(String(value));
}

function parseFlags(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      return [];
    }
  }
  return [];
}

function mapInventoryState(value: unknown): PhysicalInventoryState {
  if (
    value === "pending" ||
    value === "processing" ||
    value === "applied" ||
    value === "failed"
  ) {
    return value;
  }
  return "applied";
}

function mapFulfillmentStatus(value: unknown): PhysicalFulfillmentStatus {
  if (
    value === "unfulfilled" ||
    value === "shipped" ||
    value === "cancelled" ||
    value === "refunded"
  ) {
    return value;
  }
  return "unfulfilled";
}

function parseShippingAddress(value: unknown): ShippingAddressSnapshot {
  if (!value || typeof value !== "object") {
    return {
      name: null,
      line1: null,
      line2: null,
      city: null,
      state: null,
      postalCode: null,
      country: null,
    };
  }
  const row = value as Record<string, unknown>;
  return {
    name: row.name == null ? null : String(row.name),
    line1: row.line1 == null ? null : String(row.line1),
    line2: row.line2 == null ? null : String(row.line2),
    city: row.city == null ? null : String(row.city),
    state: row.state == null ? null : String(row.state),
    postalCode: row.postalCode == null ? null : String(row.postalCode),
    country: row.country == null ? null : String(row.country),
  };
}

function mapPhysicalOrder(row: Record<string, unknown>): PhysicalOrderRow {
  const shipping =
    typeof row.shipping_address === "string"
      ? parseShippingAddress(JSON.parse(row.shipping_address))
      : parseShippingAddress(row.shipping_address);

  return {
    id: String(row.id),
    stripeCheckoutSessionId: String(row.stripe_checkout_session_id),
    stripePaymentIntentId:
      row.stripe_payment_intent_id == null
        ? null
        : String(row.stripe_payment_intent_id),
    bookId: String(row.book_id),
    quantity: Number(row.quantity),
    unitPriceCents: Number(row.unit_price_cents),
    shippingPriceCents: Number(row.shipping_price_cents),
    totalAmountCents: Number(row.total_amount_cents),
    customerName: String(row.customer_name),
    customerEmail: String(row.customer_email),
    shippingAddress: shipping,
    shippingAddressMissing: row.shipping_address_missing === true,
    paymentStatus:
      row.payment_status == null ? "paid" : String(row.payment_status),
    inventoryState: mapInventoryState(row.inventory_state),
    attentionFlags: parseFlags(row.attention_flags),
    fulfillmentStatus: mapFulfillmentStatus(row.fulfillment_status),
    trackingNumber:
      row.tracking_number == null ? null : String(row.tracking_number),
    carrier: row.carrier == null ? null : String(row.carrier),
    shippingNoticeStatus: mapShippingNoticeStatus(row.shipping_notice_status),
    shippingNoticeSentFingerprint:
      row.shipping_notice_sent_fingerprint == null
        ? null
        : String(row.shipping_notice_sent_fingerprint),
    shippingNoticeError: mapShippingNoticeError(row.shipping_notice_error),
    shippingNoticeSentAt:
      row.shipping_notice_sent_at == null ? null : asDate(row.shipping_notice_sent_at),
    purchasedAt: asDate(row.purchased_at),
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  };
}

export async function getPhysicalOrderByCheckoutSessionId(
  stripeCheckoutSessionId: string,
): Promise<PhysicalOrderRow | null> {
  const sql = getSql();
  const rows = await sql`
    SELECT *
    FROM physical_orders
    WHERE stripe_checkout_session_id = ${stripeCheckoutSessionId}
    LIMIT 1
  `;
  const row = rows[0];
  return row ? mapPhysicalOrder(row as Record<string, unknown>) : null;
}

export async function insertPhysicalOrder(
  input: RecordPhysicalOrderInput,
): Promise<{ created: boolean; order: PhysicalOrderRow }> {
  const sql = getSql();
  const orderId = crypto.randomUUID();
  const email = normalizeEmail(input.customerEmail);
  const attentionFlags = input.attentionFlags ?? [];
  const shippingAddressMissing = input.shippingAddressMissing === true;

  try {
    await sql`
      INSERT INTO physical_orders (
        id,
        stripe_checkout_session_id,
        stripe_payment_intent_id,
        book_id,
        quantity,
        unit_price_cents,
        shipping_price_cents,
        total_amount_cents,
        customer_name,
        customer_email,
        shipping_address,
        shipping_address_missing,
        payment_status,
        inventory_state,
        attention_flags,
        fulfillment_status
      )
      VALUES (
        ${orderId}::uuid,
        ${input.stripeCheckoutSessionId},
        ${input.stripePaymentIntentId},
        ${input.bookId},
        ${input.quantity},
        ${input.unitPriceCents},
        ${input.shippingPriceCents},
        ${input.totalAmountCents},
        ${input.customerName},
        ${email},
        ${JSON.stringify(input.shippingAddress)}::jsonb,
        ${shippingAddressMissing},
        'paid',
        'pending',
        ${JSON.stringify(attentionFlags)}::jsonb,
        ${input.fulfillmentStatus}
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

  const order = await getPhysicalOrderByCheckoutSessionId(
    input.stripeCheckoutSessionId,
  );
  if (!order) {
    throw new Error("Physical order was not recorded.");
  }

  return { created: order.id === orderId, order };
}

export async function getPhysicalOrderById(
  orderId: string,
): Promise<PhysicalOrderRow | null> {
  const sql = getSql();
  const rows = await sql`
    SELECT *
    FROM physical_orders
    WHERE id = ${orderId}::uuid
    LIMIT 1
  `;
  const row = rows[0];
  return row ? mapPhysicalOrder(row as Record<string, unknown>) : null;
}

export async function claimPhysicalInventoryProcessing(
  stripeCheckoutSessionId: string,
): Promise<"claimed" | "settled"> {
  const sql = getSql();
  const rows = await sql`
    UPDATE physical_orders
    SET inventory_state = 'processing', updated_at = NOW()
    WHERE stripe_checkout_session_id = ${stripeCheckoutSessionId}
      AND inventory_state = 'pending'
    RETURNING id
  `;
  return rows.length ? "claimed" : "settled";
}

export async function markPhysicalInventoryApplied(orderId: string): Promise<void> {
  const sql = getSql();
  await sql`
    UPDATE physical_orders
    SET inventory_state = 'applied', updated_at = NOW()
    WHERE id = ${orderId}::uuid
      AND inventory_state = 'processing'
  `;
}

export async function markPhysicalInventoryFailed(orderId: string): Promise<void> {
  const order = await getPhysicalOrderById(orderId);
  const flags = new Set(order?.attentionFlags ?? []);
  flags.add("inventory_processing_failed");
  const sql = getSql();
  await sql`
    UPDATE physical_orders
    SET
      inventory_state = 'failed',
      attention_flags = ${JSON.stringify([...flags])}::jsonb,
      updated_at = NOW()
    WHERE id = ${orderId}::uuid
  `;
}

export async function acknowledgePhysicalInventoryDiscrepancy(
  orderId: string,
): Promise<"acknowledged" | "not_uncertain" | "missing"> {
  const sql = getSql();
  const flag = JSON.stringify([INVENTORY_DISCREPANCY_ACKNOWLEDGED]);
  const rows = await sql`
    UPDATE physical_orders
    SET
      attention_flags = CASE
        WHEN attention_flags @> ${flag}::jsonb THEN attention_flags
        ELSE attention_flags || ${flag}::jsonb
      END,
      updated_at = NOW()
    WHERE id = ${orderId}::uuid
      AND inventory_state = 'processing'
    RETURNING id
  `;
  if (rows.length) return "acknowledged";
  const existing = await getPhysicalOrderById(orderId);
  if (!existing) return "missing";
  return "not_uncertain";
}

function mapShippingNoticeStatus(
  value: unknown,
): PhysicalOrderRow["shippingNoticeStatus"] {
  if (
    value === "pending" ||
    value === "sending" ||
    value === "sent" ||
    value === "failed"
  ) {
    return value;
  }
  return null;
}

function mapShippingNoticeError(value: unknown): ShippingNoticeErrorCode | null {
  if (value === "resend_not_configured" || value === "send_failed") return value;
  if (value == null || value === "") return null;
  return "send_failed";
}

export async function markPhysicalOrderShipped(
  orderId: string,
  shipment: ShipmentDetails,
): Promise<ShippingSaveResult> {
  const sql = getSql();
  const acknowledged = JSON.stringify([INVENTORY_DISCREPANCY_ACKNOWLEDGED]);
  const rows = await sql`
    UPDATE physical_orders
    SET
      fulfillment_status = 'shipped',
      carrier = ${shipment.carrier},
      tracking_number = ${shipment.trackingNumber},
      shipping_notice_status = 'pending',
      shipping_notice_error = NULL,
      updated_at = NOW()
    WHERE id = ${orderId}::uuid
      AND fulfillment_status = 'unfulfilled'
      AND payment_status = 'paid'
      AND (
        inventory_state <> 'processing'
        OR attention_flags @> ${acknowledged}::jsonb
      )
    RETURNING id
  `;
  if (rows.length) return "saved";
  const existing = await getPhysicalOrderById(orderId);
  if (!existing) return "missing";
  if (existing.paymentStatus !== "paid") return "payment_ineligible";
  if (
    existing.fulfillmentStatus === "unfulfilled" &&
    existing.inventoryState === "processing" &&
    !existing.attentionFlags.includes(INVENTORY_DISCREPANCY_ACKNOWLEDGED)
  ) {
    return "inventory_unresolved";
  }
  return "not_awaiting";
}

export async function correctPhysicalShipment(
  orderId: string,
  shipment: ShipmentDetails,
): Promise<ShippingCorrectionResult> {
  const sql = getSql();
  const fingerprint = shippingFingerprint(shipment);
  const rows = await sql`
    UPDATE physical_orders
    SET
      carrier = ${shipment.carrier},
      tracking_number = ${shipment.trackingNumber},
      shipping_notice_status = CASE
        WHEN shipping_notice_sent_fingerprint = ${fingerprint} THEN 'sent'
        ELSE 'pending'
      END,
      shipping_notice_error = NULL,
      updated_at = NOW()
    WHERE id = ${orderId}::uuid
      AND fulfillment_status = 'shipped'
      AND payment_status = 'paid'
      AND (
        shipping_notice_status IS DISTINCT FROM 'sending'
        OR updated_at < NOW() - INTERVAL '2 minutes'
      )
    RETURNING shipping_notice_status
  `;
  const status = rows[0]?.shipping_notice_status;
  if (status === "sent") return "already_sent";
  if (status === "pending") return "pending";
  const existing = await getPhysicalOrderById(orderId);
  if (!existing) return "missing";
  if (existing.paymentStatus !== "paid") return "payment_ineligible";
  if (existing.fulfillmentStatus !== "shipped") return "not_shipped";
  if (existing.shippingNoticeStatus === "sending") return "in_progress";
  return "not_shipped";
}

export async function claimPhysicalShippingNotice(
  orderId: string,
  shipment: ShipmentDetails,
): Promise<ShippingClaimResult> {
  const sql = getSql();
  const fingerprint = shippingFingerprint(shipment);
  const rows = await sql`
    UPDATE physical_orders
    SET shipping_notice_status = 'sending', updated_at = NOW()
    WHERE id = ${orderId}::uuid
      AND fulfillment_status = 'shipped'
      AND payment_status = 'paid'
      AND carrier = ${shipment.carrier}
      AND tracking_number = ${shipment.trackingNumber}
      AND shipping_notice_sent_fingerprint IS DISTINCT FROM ${fingerprint}
      AND (
        shipping_notice_status IN ('pending', 'failed')
        OR (
          shipping_notice_status = 'sending'
          AND updated_at < NOW() - INTERVAL '2 minutes'
        )
      )
    RETURNING id
  `;
  if (rows.length) return "claimed";
  const existing = await getPhysicalOrderById(orderId);
  if (!existing) return "not_eligible";
  if (existing.shippingNoticeSentFingerprint === fingerprint) return "already_sent";
  if (existing.shippingNoticeStatus === "sending") return "in_progress";
  return "not_eligible";
}

export async function markPhysicalShippingNoticeSent(
  orderId: string,
  shipment: ShipmentDetails,
): Promise<void> {
  const sql = getSql();
  const fingerprint = shippingFingerprint(shipment);
  await sql`
    UPDATE physical_orders
    SET
      shipping_notice_status = 'sent',
      shipping_notice_sent_fingerprint = ${fingerprint},
      shipping_notice_error = NULL,
      shipping_notice_sent_at = NOW(),
      updated_at = NOW()
    WHERE id = ${orderId}::uuid
      AND shipping_notice_status = 'sending'
      AND carrier = ${shipment.carrier}
      AND tracking_number = ${shipment.trackingNumber}
  `;
}

export async function markPhysicalShippingNoticeFailed(
  orderId: string,
  code: ShippingNoticeErrorCode,
): Promise<void> {
  const sql = getSql();
  await sql`
    UPDATE physical_orders
    SET
      shipping_notice_status = 'failed',
      shipping_notice_error = ${code},
      updated_at = NOW()
    WHERE id = ${orderId}::uuid
      AND shipping_notice_status = 'sending'
  `;
}
