import { getSql } from "@/lib/db";
import type { PhysicalOrderRow } from "@/lib/physical-orders";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { parseOwnerOrderRoute } from "./order-detail";
import {
  escapeHtml,
  type ShippingConfirmationMessage,
} from "./shipping-carriers";

/**
 * Order id verified by the prior read-only production check for the paid
 * Children Diseases: Asthma paperback. This is the only order that can pass.
 */
export const APPROVED_SHIPPING_TEST_ORDER_ID = "bd2a25d4-6476-4c97-963e-7a03df3d75b7";

export const SHIPPING_TEST_EMAIL_SUBJECT =
  "TEST: Twilight Feather shipping notice — no package was shipped";

const TEST_PURPOSE = "asthma-shipping-test";

/**
 * Code activation for a live Resend call. The feature flag is not this switch.
 * Leave false until the claim table is applied and a later change arms the send.
 */
export const SHIPPING_TEST_EMAIL_SEND_ARMED: boolean = false;

/**
 * Provider acceptance is not inbox delivery. `accepted` means Resend accepted
 * the API request. A row left `claimed` is terminal and must not be sent again.
 */
export const SHIPPING_TEST_CLAIM_INSERT = `
INSERT INTO shipping_test_email_claims (order_id, purpose, status)
SELECT id, 'asthma-shipping-test', 'claimed'
FROM physical_orders
WHERE id = $1::uuid
  AND id = '${APPROVED_SHIPPING_TEST_ORDER_ID}'::uuid
  AND book_id = 'book-three'
  AND quantity = 1
  AND payment_status = 'paid'
  AND fulfillment_status = 'unfulfilled'
  AND COALESCE(btrim(carrier), '') = ''
  AND COALESCE(btrim(tracking_number), '') = ''
ON CONFLICT (order_id) DO NOTHING
RETURNING order_id
`;

export const SHIPPING_TEST_CLAIM_STATUS = `
SELECT status
FROM shipping_test_email_claims
WHERE order_id = $1::uuid
`;

export const SHIPPING_TEST_CLAIM_COMPLETE = `
UPDATE shipping_test_email_claims
SET status = $2, completed_at = now()
WHERE order_id = $1::uuid
  AND status = 'claimed'
  AND $2 IN ('accepted', 'ambiguous')
RETURNING order_id
`;

export type ShippingTestClaimStatus = "claimed" | "accepted" | "ambiguous";

export type ShippingTestClaimResult =
  | { outcome: "claimed" }
  | { outcome: "already_attempted"; status: ShippingTestClaimStatus }
  | { outcome: "not_eligible" };

export type ShippingTestClaimStore = {
  tryClaim(orderId: string): Promise<ShippingTestClaimResult>;
  complete(orderId: string, status: Exclude<ShippingTestClaimStatus, "claimed">): Promise<void>;
};

export type ShippingTestOutcome =
  | "accepted"
  | "already_attempted"
  | "ambiguous"
  | "rejected"
  | "disabled"
  | "unavailable";

export type ShippingTestHttpResult = {
  status: number;
  body: {
    outcome: ShippingTestOutcome;
    error?: string;
    claimStatus?: ShippingTestClaimStatus;
  };
};

type ClaimRow = {
  status: ShippingTestClaimStatus;
  claimedAt: number;
};

export function isShippingTestEmailEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SHIPPING_TEST_EMAIL_ENABLED === "true";
}

export function isShippingTestEmailSendArmed(): boolean {
  return SHIPPING_TEST_EMAIL_SEND_ARMED === true;
}

export function isApprovedShippingTestOrder(orderId: string): boolean {
  return orderId.trim().toLowerCase() === APPROVED_SHIPPING_TEST_ORDER_ID;
}

export function shippingTestEligibilityError(order: PhysicalOrderRow): string | null {
  if (!isApprovedShippingTestOrder(order.id)) {
    return "This order is not approved for the test email.";
  }
  if (order.bookId !== "book-three") {
    return "This order is not the Asthma paperback.";
  }
  if (order.quantity !== 1) {
    return "This order is not quantity one.";
  }
  if (order.paymentStatus !== "paid") {
    return "This order is not an unchanged paid order.";
  }
  if (order.fulfillmentStatus !== "unfulfilled") {
    return "This order is not awaiting shipment.";
  }
  if (order.carrier?.trim() || order.trackingNumber?.trim()) {
    return "This order already has shipment details.";
  }
  if (!order.customerEmail.trim()) {
    return "This order has no checkout email.";
  }
  return null;
}

export function buildShippingTestNotice(input: {
  to: string;
  customerName: string;
  orderId: string;
}): ShippingConfirmationMessage {
  const safeName = escapeHtml(input.customerName);
  const text = [
    "This is a test email for the owner's existing paperback order.",
    "No package was shipped.",
    "No carrier accepted a shipment.",
    "No tracking number was created.",
    "Product: Children Diseases: Asthma.",
    "Quantity: 1.",
    "",
    `Prepared for ${input.customerName}.`,
  ].join("\n");
  const html = `
    <div style="font-family: system-ui, -apple-system, Segoe UI, sans-serif; max-width: 560px; margin: 0 auto; color: #1a2b4b; line-height: 1.5;">
      <h1 style="font-size: 22px; margin-bottom: 12px;">TEST: no package was shipped</h1>
      <p>This is a test email for the owner's existing paperback order.</p>
      <p>No package was shipped.</p>
      <p>No carrier accepted a shipment.</p>
      <p>No tracking number was created.</p>
      <p><strong>Product:</strong> Children Diseases: Asthma.</p>
      <p><strong>Quantity:</strong> 1.</p>
      <p>Prepared for ${safeName}.</p>
    </div>
  `;
  return {
    to: input.to,
    subject: SHIPPING_TEST_EMAIL_SUBJECT,
    html,
    text,
    idempotencyKey: `physical-shipping-test:${input.orderId}:${TEST_PURPOSE}:v1`,
  };
}

export function createMemoryShippingTestClaimStore(): ShippingTestClaimStore & {
  backdate(orderId: string, ageMs: number): void;
  claimedAt(orderId: string): number | null;
} {
  const rows = new Map<string, ClaimRow>();
  return {
    async tryClaim(orderId) {
      await Promise.resolve();
      const existing = rows.get(orderId);
      if (existing) {
        return { outcome: "already_attempted", status: existing.status };
      }
      rows.set(orderId, { status: "claimed", claimedAt: Date.now() });
      return { outcome: "claimed" };
    },
    async complete(orderId, status) {
      const row = rows.get(orderId);
      if (!row || row.status !== "claimed") return;
      row.status = status;
    },
    backdate(orderId, ageMs) {
      const row = rows.get(orderId);
      if (!row) return;
      row.claimedAt -= ageMs;
    },
    claimedAt(orderId) {
      return rows.get(orderId)?.claimedAt ?? null;
    },
  };
}

type DurableClaimRow = {
  status: ShippingTestClaimStatus;
  claimedAt: number;
  completedAt: number | null;
};

export type SharedDurableClaimState = {
  rows: Map<string, DurableClaimRow>;
};

export function createSharedDurableClaimState(): SharedDurableClaimState {
  return { rows: new Map() };
}

function parseClaimStatus(value: unknown): ShippingTestClaimStatus | null {
  if (value === "claimed" || value === "accepted" || value === "ambiguous") return value;
  return null;
}

/** Maps one insert result and a follow-up status read. Does not send email. */
export function interpretShippingTestClaimInsert(input: {
  insertedOrderId: unknown;
  existingStatus: unknown;
}): ShippingTestClaimResult {
  if (typeof input.insertedOrderId === "string" && input.insertedOrderId.trim()) {
    return { outcome: "claimed" };
  }
  const status = parseClaimStatus(input.existingStatus);
  if (status) return { outcome: "already_attempted", status };
  return { outcome: "not_eligible" };
}

function databaseFailed(code: string): Error {
  return Object.assign(new Error(code), { code });
}

/**
 * One auto-committed INSERT ... ON CONFLICT, then a later auto-committed UPDATE.
 * The Neon HTTP client has no interactive transaction, so Resend cannot run inside it.
 */
export function createPostgresShippingTestClaimStore(
  sql?: NeonQueryFunction<false, false>,
): ShippingTestClaimStore {
  const resolve = () => sql ?? getSql();
  return {
    async tryClaim(orderId) {
      const db = resolve();
      let inserted: Record<string, unknown>[];
      try {
        inserted = (await db.query(SHIPPING_TEST_CLAIM_INSERT, [orderId])) as Record<string, unknown>[];
      } catch {
        throw databaseFailed("claim_database_failed");
      }
      const insertedId = inserted[0]?.order_id;
      if (typeof insertedId === "string" && insertedId.trim()) {
        return { outcome: "claimed" };
      }
      let existing: Record<string, unknown>[];
      try {
        existing = (await db.query(SHIPPING_TEST_CLAIM_STATUS, [orderId])) as Record<string, unknown>[];
      } catch {
        throw databaseFailed("claim_database_failed");
      }
      return interpretShippingTestClaimInsert({
        insertedOrderId: null,
        existingStatus: existing[0]?.status,
      });
    },
    async complete(orderId, status) {
      const db = resolve();
      let rows: Record<string, unknown>[];
      try {
        rows = (await db.query(SHIPPING_TEST_CLAIM_COMPLETE, [orderId, status])) as Record<
          string,
          unknown
        >[];
      } catch {
        throw databaseFailed("claim_outcome_failed");
      }
      if (!rows[0]?.order_id) {
        throw databaseFailed("claim_outcome_not_recorded");
      }
    },
  };
}

export function createDurableFakeClaimStore(
  state: SharedDurableClaimState,
  options?: { failClaim?: boolean; commitClaimThenFail?: boolean; failComplete?: boolean },
): ShippingTestClaimStore & {
  backdate(orderId: string, ageMs: number): void;
} {
  return {
    async tryClaim(orderId) {
      await Promise.resolve();
      if (options?.commitClaimThenFail) {
        if (!state.rows.has(orderId)) {
          state.rows.set(orderId, { status: "claimed", claimedAt: Date.now(), completedAt: null });
        }
        throw databaseFailed("claim_database_failed");
      }
      if (options?.failClaim) {
        throw databaseFailed("claim_database_failed");
      }
      const existing = state.rows.get(orderId);
      if (existing) return { outcome: "already_attempted", status: existing.status };
      state.rows.set(orderId, { status: "claimed", claimedAt: Date.now(), completedAt: null });
      return { outcome: "claimed" };
    },
    async complete(orderId, status) {
      if (options?.failComplete) {
        throw databaseFailed("claim_outcome_failed");
      }
      const row = state.rows.get(orderId);
      if (!row || row.status !== "claimed") {
        throw databaseFailed("claim_outcome_not_recorded");
      }
      row.status = status;
      row.completedAt = Date.now();
    },
    backdate(orderId, ageMs) {
      const row = state.rows.get(orderId);
      if (!row) return;
      row.claimedAt -= ageMs;
    },
  };
}

export function unavailableShippingTestClaimStore(): ShippingTestClaimStore {
  const unavailable = () =>
    Object.assign(new Error("durable_store_unavailable"), {
      code: "durable_store_unavailable",
    });
  return {
    async tryClaim() {
      throw unavailable();
    },
    async complete() {
      throw unavailable();
    },
  };
}

function isUnavailable(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "durable_store_unavailable"
  );
}

export async function handleShippingTestEmail(input: {
  isAdmin: boolean;
  featureEnabled: boolean;
  sendArmed: boolean;
  kind: string;
  orderId: string;
  requestedRecipient?: string | null;
  getOrder: (orderId: string) => Promise<PhysicalOrderRow | null>;
  claims: ShippingTestClaimStore;
  send: (message: ShippingConfirmationMessage) => Promise<void>;
}): Promise<ShippingTestHttpResult> {
  void input.requestedRecipient;
  if (!input.isAdmin) {
    return { status: 401, body: { outcome: "rejected", error: "Unauthorized." } };
  }
  if (!input.featureEnabled) {
    return { status: 403, body: { outcome: "disabled", error: "The test email is turned off." } };
  }
  if (!input.sendArmed) {
    return {
      status: 503,
      body: { outcome: "unavailable", error: "Live send is not activated." },
    };
  }
  const route = parseOwnerOrderRoute(input.kind, input.orderId);
  if (!route || route.kind !== "physical" || !isApprovedShippingTestOrder(route.orderId)) {
    return { status: 404, body: { outcome: "rejected", error: "Order not found." } };
  }

  const order = await input.getOrder(route.orderId);
  if (!order) {
    return { status: 404, body: { outcome: "rejected", error: "Order not found." } };
  }
  const eligibilityError = shippingTestEligibilityError(order);
  if (eligibilityError) {
    return { status: 409, body: { outcome: "rejected", error: eligibilityError } };
  }

  let claim: ShippingTestClaimResult;
  try {
    claim = await input.claims.tryClaim(order.id);
  } catch (error) {
    if (isUnavailable(error)) {
      return {
        status: 503,
        body: { outcome: "unavailable", error: "The one-send record is not available." },
      };
    }
    return {
      status: 503,
      body: { outcome: "unavailable", error: "The one-send record is not available." },
    };
  }
  if (claim.outcome === "not_eligible") {
    return { status: 409, body: { outcome: "rejected", error: "This order is not eligible for the test email." } };
  }
  if (claim.outcome === "already_attempted") {
    return {
      status: 200,
      body: { outcome: "already_attempted", claimStatus: claim.status },
    };
  }

  const message = buildShippingTestNotice({
    to: order.customerEmail.trim(),
    customerName: order.customerName,
    orderId: order.id,
  });
  try {
    await input.send(message);
  } catch {
    try {
      await input.claims.complete(order.id, "ambiguous");
    } catch {
      // The claim stays in place, so a later request still cannot send.
    }
    return {
      status: 202,
      body: { outcome: "ambiguous", error: "The test email outcome is uncertain." },
    };
  }

  try {
    await input.claims.complete(order.id, "accepted");
  } catch {
    return {
      status: 202,
      body: { outcome: "ambiguous", error: "The test email outcome is uncertain." },
    };
  }
  return { status: 200, body: { outcome: "accepted" } };
}
