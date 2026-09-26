import { getSql } from "./db";
import { normalizeEmail } from "./checkout-ownership";

export type PhysicalFulfillmentStatus =
  | "unfulfilled"
  | "shipped"
  | "cancelled"
  | "refunded";

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
  fulfillmentStatus: PhysicalFulfillmentStatus;
  trackingNumber: string | null;
  carrier: string | null;
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
  fulfillmentStatus: PhysicalFulfillmentStatus;
};

function asDate(value: unknown): Date {
  if (value instanceof Date) return value;
  return new Date(String(value));
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
    fulfillmentStatus: mapFulfillmentStatus(row.fulfillment_status),
    trackingNumber:
      row.tracking_number == null ? null : String(row.tracking_number),
    carrier: row.carrier == null ? null : String(row.carrier),
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
