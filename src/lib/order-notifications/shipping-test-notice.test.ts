import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { PhysicalOrderRow } from "../physical-orders";
import { handlePhysicalShipment, type ShippingConfirmationDeps } from "./shipping-confirmation";
import type { ShipmentDetails } from "./shipping-carriers";
import {
  APPROVED_SHIPPING_TEST_ORDER_ID,
  SHIPPING_TEST_CLAIM_COMPLETE,
  SHIPPING_TEST_CLAIM_INSERT,
  SHIPPING_TEST_CLAIM_STATUS,
  SHIPPING_TEST_EMAIL_SUBJECT,
  buildShippingTestNotice,
  createDurableFakeClaimStore,
  createMemoryShippingTestClaimStore,
  createPostgresShippingTestClaimStore,
  createSharedDurableClaimState,
  handleShippingTestEmail,
  interpretShippingTestClaimInsert,
  isShippingTestEmailSendArmed,
  SHIPPING_TEST_EMAIL_SEND_ARMED,
  unavailableShippingTestClaimStore,
  type ShippingTestClaimStatus,
  type ShippingTestClaimStore,
} from "./shipping-test-notice";
import type { NeonQueryFunction } from "@neondatabase/serverless";

const OTHER_ORDER_ID = "11111111-1111-4111-8111-111111111111";

function order(overrides: Partial<PhysicalOrderRow> = {}): PhysicalOrderRow {
  const now = new Date("2026-10-18T04:00:00.000Z");
  return {
    id: APPROVED_SHIPPING_TEST_ORDER_ID,
    stripeCheckoutSessionId: "cs_test",
    stripePaymentIntentId: "pi_test",
    bookId: "book-three",
    quantity: 1,
    unitPriceCents: 1000,
    shippingPriceCents: 499,
    totalAmountCents: 1499,
    customerName: "Buyer <Name>",
    customerEmail: "buyer@example.com",
    shippingAddress: {
      name: "Buyer Name",
      line1: "123 Secret St",
      line2: null,
      city: "Miami",
      state: "FL",
      postalCode: "33101",
      country: "US",
    },
    shippingAddressMissing: false,
    paymentStatus: "paid",
    inventoryState: "applied",
    attentionFlags: [],
    fulfillmentStatus: "unfulfilled",
    trackingNumber: null,
    carrier: null,
    shippingNoticeStatus: null,
    shippingNoticeSentFingerprint: null,
    shippingNoticeError: null,
    shippingNoticeSentAt: null,
    purchasedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function harness(overrides: Partial<PhysicalOrderRow> = {}) {
  const current = order(overrides);
  const claims = createMemoryShippingTestClaimStore();
  const sent: Array<{ to: string; subject: string; html: string; text: string }> = [];
  let shipments = 0;
  let inventoryWrites = 0;
  let paymentWrites = 0;
  const deps = {
    getOrder: async (orderId: string) => (current.id === orderId ? current : null),
    claims,
    send: async (message: { to: string; subject: string; html: string; text: string }) => {
      sent.push(message);
    },
    markShipped() {
      shipments += 1;
    },
    changeInventory() {
      inventoryWrites += 1;
    },
    changePayment() {
      paymentWrites += 1;
    },
  };
  return {
    current,
    claims,
    sent,
    counts: () => ({ shipments, inventoryWrites, paymentWrites }),
    deps,
  };
}

function run(
  store: ReturnType<typeof harness>,
  input: {
    isAdmin?: boolean;
    featureEnabled?: boolean;
    sendArmed?: boolean;
    kind?: string;
    orderId?: string;
    requestedRecipient?: string | null;
    claims?: ShippingTestClaimStore;
    send?: (message: { to: string; subject: string; html: string; text: string }) => Promise<void>;
  } = {},
) {
  return handleShippingTestEmail({
    isAdmin: input.isAdmin ?? true,
    featureEnabled: input.featureEnabled ?? true,
    sendArmed: input.sendArmed ?? true,
    kind: input.kind ?? "physical",
    orderId: input.orderId ?? store.current.id,
    requestedRecipient: input.requestedRecipient,
    getOrder: store.deps.getOrder,
    claims: input.claims ?? store.deps.claims,
    send: input.send ?? store.deps.send,
  });
}

test("test notice uses the required subject and test wording", () => {
  const message = buildShippingTestNotice({
    to: "buyer@example.com",
    customerName: "Buyer",
    orderId: APPROVED_SHIPPING_TEST_ORDER_ID,
  });
  assert.equal(message.subject, SHIPPING_TEST_EMAIL_SUBJECT);
  assert.match(message.subject, /^TEST:/);
  assert.match(message.html, /TEST: no package was shipped/);
  assert.match(message.text, /This is a test email for the owner's existing paperback order/);
  assert.match(message.text, /No package was shipped/);
  assert.match(message.text, /No carrier accepted a shipment/);
  assert.match(message.text, /No tracking number was created/);
  assert.match(message.text, /Product: Children Diseases: Asthma/);
  assert.match(message.text, /Quantity: 1/);
});

test("test notice does not claim a real shipment or include a carrier link", () => {
  const message = buildShippingTestNotice({
    to: "buyer@example.com",
    customerName: "Buyer",
    orderId: APPROVED_SHIPPING_TEST_ORDER_ID,
  });
  const visible = `${message.subject}\n${message.html}\n${message.text}`;
  assert.doesNotMatch(visible, /has shipped/i);
  assert.doesNotMatch(visible, /Track your package/i);
  assert.doesNotMatch(visible, /https?:\/\//i);
  assert.doesNotMatch(visible, /usps|ups|fedex|dhl/i);
  assert.doesNotMatch(visible, /123 Secret St/);
  assert.doesNotMatch(visible, /buyer@example.com/);
});

test("test notice escapes the customer name", () => {
  const message = buildShippingTestNotice({
    to: "buyer@example.com",
    customerName: `Buyer <Name> & "quoted"`,
    orderId: APPROVED_SHIPPING_TEST_ORDER_ID,
  });
  assert.match(message.html, /Buyer &lt;Name&gt; &amp; &quot;quoted&quot;/);
  assert.doesNotMatch(message.html, /<Name>/);
});

test("the approved paid Asthma order is accepted once", async () => {
  const store = harness();
  const result = await run(store);
  assert.equal(result.status, 200);
  assert.equal(result.body.outcome, "accepted");
  assert.equal(store.sent.length, 1);
  assert.equal(store.sent[0]?.to, "buyer@example.com");
  assert.equal(store.counts().shipments, 0);
  assert.equal(store.counts().inventoryWrites, 0);
  assert.equal(store.counts().paymentWrites, 0);
});

test("every other order is rejected", async () => {
  const store = harness();
  const result = await run(store, { orderId: OTHER_ORDER_ID });
  assert.equal(result.status, 404);
  assert.equal(result.body.outcome, "rejected");
  assert.equal(store.sent.length, 0);
});

test("another paid Asthma order is rejected", async () => {
  const store = harness({ id: OTHER_ORDER_ID, bookId: "book-three" });
  const result = await run(store, { orderId: OTHER_ORDER_ID });
  assert.equal(result.status, 404);
  assert.equal(store.sent.length, 0);
});

test("the wrong product is rejected", async () => {
  const store = harness({ bookId: "book-one" });
  const result = await run(store);
  assert.equal(result.status, 409);
  assert.match(result.body.error ?? "", /Asthma/);
  assert.equal(store.sent.length, 0);
});

test("unpaid, refunded, and partially refunded orders are rejected", async () => {
  for (const paymentStatus of ["unpaid", "refunded", "partially_refunded"]) {
    const store = harness({ paymentStatus });
    const result = await run(store);
    assert.equal(result.status, 409, paymentStatus);
    assert.equal(result.body.outcome, "rejected");
    assert.equal(store.sent.length, 0);
  }
});

test("an already shipped order is rejected", async () => {
  const store = harness({ fulfillmentStatus: "shipped", carrier: "usps", trackingNumber: "ABC123" });
  const result = await run(store);
  assert.equal(result.status, 409);
  assert.equal(store.sent.length, 0);
});

test("a missing admin session is rejected before the order is loaded", async () => {
  let loaded = 0;
  const store = harness();
  const result = await handleShippingTestEmail({
    isAdmin: false,
    featureEnabled: true,
    sendArmed: true,
    kind: "physical",
    orderId: APPROVED_SHIPPING_TEST_ORDER_ID,
    getOrder: async (orderId) => {
      loaded += 1;
      return store.deps.getOrder(orderId);
    },
    claims: store.claims,
    send: store.deps.send,
  });
  assert.equal(result.status, 401);
  assert.equal(loaded, 0);
  assert.equal(store.sent.length, 0);
});

test("an arbitrary recipient cannot replace the stored checkout email", async () => {
  const store = harness();
  const result = await run(store, { requestedRecipient: "other-person@example.com" });
  assert.equal(result.body.outcome, "accepted");
  assert.equal(store.sent[0]?.to, "buyer@example.com");
  assert.notEqual(store.sent[0]?.to, "other-person@example.com");
});

test("carrier or tracking already recorded is rejected", async () => {
  const withCarrier = harness({ carrier: "usps" });
  assert.equal((await run(withCarrier)).status, 409);
  const withTracking = harness({ trackingNumber: "ABC123" });
  assert.equal((await run(withTracking)).status, 409);
  assert.equal(withCarrier.sent.length, 0);
  assert.equal(withTracking.sent.length, 0);
});

test("one send attempt is made under concurrent requests", async () => {
  const store = harness();
  const [first, second] = await Promise.all([run(store), run(store)]);
  const outcomes = [first.body.outcome, second.body.outcome].sort();
  assert.deepEqual(outcomes, ["accepted", "already_attempted"]);
  assert.equal(store.sent.length, 1);
});

test("a repeated request is blocked after acceptance", async () => {
  const store = harness();
  assert.equal((await run(store)).body.outcome, "accepted");
  const repeat = await run(store);
  assert.equal(repeat.body.outcome, "already_attempted");
  assert.equal(repeat.body.claimStatus, "accepted");
  assert.equal(store.sent.length, 1);
});

test("a repeated request is blocked after an ambiguous delivery outcome", async () => {
  const store = harness();
  const ambiguous = await run(store, {
    send: async () => {
      throw new Error("timeout");
    },
  });
  assert.equal(ambiguous.status, 202);
  assert.equal(ambiguous.body.outcome, "ambiguous");
  const repeat = await run(store);
  assert.equal(repeat.body.outcome, "already_attempted");
  assert.equal(repeat.body.claimStatus, "ambiguous");
  assert.equal(store.sent.length, 0);
});

test("a repeated request stays blocked beyond 24 hours", async () => {
  const store = harness();
  assert.equal((await run(store)).body.outcome, "accepted");
  store.claims.backdate(APPROVED_SHIPPING_TEST_ORDER_ID, 48 * 60 * 60 * 1000);
  const claimedAt = store.claims.claimedAt(APPROVED_SHIPPING_TEST_ORDER_ID);
  assert.ok(claimedAt != null && Date.now() - claimedAt > 24 * 60 * 60 * 1000);
  const repeat = await run(store);
  assert.equal(repeat.body.outcome, "already_attempted");
  assert.equal(store.sent.length, 1);
});

test("a disabled feature rejects the request before claiming or sending", async () => {
  const store = harness();
  let claims = 0;
  const result = await run(store, {
    featureEnabled: false,
    claims: {
      async tryClaim(orderId) {
        claims += 1;
        return store.claims.tryClaim(orderId);
      },
      complete: (orderId, status) => store.claims.complete(orderId, status),
    },
  });
  assert.equal(result.status, 403);
  assert.equal(result.body.outcome, "disabled");
  assert.equal(claims, 0);
  assert.equal(store.sent.length, 0);
});

test("the live claim store refuses to send", async () => {
  const store = harness();
  const result = await run(store, { claims: unavailableShippingTestClaimStore() });
  assert.equal(result.status, 503);
  assert.equal(result.body.outcome, "unavailable");
  assert.equal(store.sent.length, 0);
});

test("the real mark-shipped handler still records a shipment", async () => {
  const shipment: ShipmentDetails = { carrier: "usps", trackingNumber: "940011189000000000" };
  let current = order({ id: OTHER_ORDER_ID, bookId: "book-one", quantity: 1 });
  let sends = 0;
  const deps: ShippingConfirmationDeps = {
    async getOrder(orderId) {
      return current.id === orderId ? current : null;
    },
    async saveInitial(orderId, next) {
      if (current.id !== orderId || current.fulfillmentStatus !== "unfulfilled") return "not_awaiting";
      current = {
        ...current,
        fulfillmentStatus: "shipped",
        carrier: next.carrier,
        trackingNumber: next.trackingNumber,
        shippingNoticeStatus: "pending",
      };
      return "saved";
    },
    async saveCorrection() {
      return "not_shipped";
    },
    async claim() {
      current = { ...current, shippingNoticeStatus: "sending" };
      return "claimed";
    },
    async markSent() {
      current = { ...current, shippingNoticeStatus: "sent" };
    },
    async markFailed() {
      current = { ...current, shippingNoticeStatus: "failed" };
    },
    async send() {
      sends += 1;
    },
  };
  const result = await handlePhysicalShipment({
    isAdmin: true,
    kind: "physical",
    orderId: OTHER_ORDER_ID,
    action: "ship",
    body: shipment,
    deps,
  });
  assert.equal(result.body.fulfillmentStatus, "Shipped");
  assert.equal(result.body.customerEmail, "delivered");
  assert.equal(current.fulfillmentStatus, "shipped");
  assert.equal(sends, 1);
});

test("test email route stays disarmed and does not mutate shipment state", () => {
  const handler = readFileSync(new URL("./shipping-test-notice.ts", import.meta.url), "utf8");
  const route = readFileSync(
    new URL("../../app/api/admin/orders/[kind]/[orderId]/shipping-test-notice/route.ts", import.meta.url),
    "utf8",
  );
  const realShipping = readFileSync(new URL("./shipping-carriers.ts", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../../../sql/shipping-test-email-claims.sql", import.meta.url), "utf8");
  assert.match(handler, /SHIPPING_TEST_EMAIL_SEND_ARMED: boolean = false/);
  assert.match(handler, /ON CONFLICT \(order_id\) DO NOTHING/);
  assert.match(handler, /AND status = 'claimed'/);
  assert.doesNotMatch(handler, /markPhysicalOrderShipped|physical_inventory|UPDATE physical_orders|order_notification_jobs|DELETE FROM shipping_test_email_claims/);
  assert.match(route, /isAdminAuthenticated/);
  assert.match(route, /isShippingTestEmailSendArmed/);
  assert.match(route, /createPostgresShippingTestClaimStore/);
  assert.match(route, /sendPhysicalShippingConfirmationEmail/);
  assert.doesNotMatch(route, /markPhysicalOrderShipped|SHIPPING_TEST_EMAIL_ENABLED\s*=\s*["']true["']/);
  assert.match(realShipping, /Your Twilight Feather paperback has shipped/);
  assert.doesNotMatch(realShipping, /SHIPPING_TEST_EMAIL_SUBJECT|no package was shipped/);
  assert.match(migration, /REFERENCES physical_orders \(id\) ON DELETE RESTRICT/);
  assert.match(migration, /purpose = 'asthma-shipping-test'/);
  assert.match(migration, /status = 'claimed' AND completed_at IS NULL/);
  assert.doesNotMatch(migration, /customer_email|DELETE FROM|expires|INTERVAL/i);
});

test("insert result interpretation distinguishes a new claim from an existing one", () => {
  assert.deepEqual(
    interpretShippingTestClaimInsert({ insertedOrderId: APPROVED_SHIPPING_TEST_ORDER_ID, existingStatus: null }),
    { outcome: "claimed" },
  );
  for (const status of ["claimed", "accepted", "ambiguous"] as const) {
    assert.deepEqual(
      interpretShippingTestClaimInsert({ insertedOrderId: null, existingStatus: status }),
      { outcome: "already_attempted", status },
    );
  }
  assert.deepEqual(
    interpretShippingTestClaimInsert({ insertedOrderId: null, existingStatus: null }),
    { outcome: "not_eligible" },
  );
});

test("two handler instances share one durable claim and only one sends", async () => {
  const state = createSharedDurableClaimState();
  const firstStore = harness();
  const secondStore = harness();
  const claimsA = createDurableFakeClaimStore(state);
  const claimsB = createDurableFakeClaimStore(state);
  const [first, second] = await Promise.all([
    run(firstStore, { claims: claimsA }),
    run(secondStore, { claims: claimsB }),
  ]);
  const outcomes = [first.body.outcome, second.body.outcome].sort();
  assert.deepEqual(outcomes, ["accepted", "already_attempted"]);
  assert.equal(firstStore.sent.length + secondStore.sent.length, 1);
});

test("an existing claimed, accepted, or ambiguous row blocks another send", async () => {
  for (const status of ["claimed", "accepted", "ambiguous"] as const) {
    const state = createSharedDurableClaimState();
    state.rows.set(APPROVED_SHIPPING_TEST_ORDER_ID, {
      status,
      claimedAt: Date.now() - 10 * 24 * 60 * 60 * 1000,
      completedAt: status === "claimed" ? null : Date.now(),
    });
    const store = harness();
    const result = await run(store, { claims: createDurableFakeClaimStore(state) });
    assert.equal(result.body.outcome, "already_attempted");
    assert.equal(result.body.claimStatus, status);
    assert.equal(store.sent.length, 0);
  }
});

test("a claim still blocks a send after more than one day", async () => {
  const state = createSharedDurableClaimState();
  const claims = createDurableFakeClaimStore(state);
  const store = harness();
  assert.equal((await run(store, { claims })).body.outcome, "accepted");
  claims.backdate(APPROVED_SHIPPING_TEST_ORDER_ID, 3 * 24 * 60 * 60 * 1000);
  const repeat = await run(store, { claims });
  assert.equal(repeat.body.outcome, "already_attempted");
  assert.equal(store.sent.length, 1);
});

test("a crash after the claim commits and before send does not send later", async () => {
  const state = createSharedDurableClaimState();
  const claims = createDurableFakeClaimStore(state);
  await claims.tryClaim(APPROVED_SHIPPING_TEST_ORDER_ID);
  const store = harness();
  const result = await run(store, { claims });
  assert.equal(result.body.outcome, "already_attempted");
  assert.equal(result.body.claimStatus, "claimed");
  assert.equal(store.sent.length, 0);
});

test("a crash after provider acceptance leaves the claim terminal", async () => {
  const state = createSharedDurableClaimState();
  const claims = createDurableFakeClaimStore(state);
  const store = harness();
  const crashed = await run(store, {
    claims: createDurableFakeClaimStore(state, { failComplete: true }),
  });
  assert.equal(crashed.status, 202);
  assert.equal(crashed.body.outcome, "ambiguous");
  assert.equal(state.rows.get(APPROVED_SHIPPING_TEST_ORDER_ID)?.status, "claimed");
  const repeat = await run(store, { claims });
  assert.equal(repeat.body.outcome, "already_attempted");
  assert.equal(store.sent.length, 1);
});

test("a database timeout during claim does not send", async () => {
  const store = harness();
  const result = await run(store, {
    claims: createDurableFakeClaimStore(createSharedDurableClaimState(), { failClaim: true }),
  });
  assert.equal(result.status, 503);
  assert.equal(result.body.outcome, "unavailable");
  assert.equal(store.sent.length, 0);
});

test("a claim timeout after the row commits still blocks a later send", async () => {
  const state = createSharedDurableClaimState();
  const store = harness();
  const timedOut = await run(store, {
    claims: createDurableFakeClaimStore(state, { commitClaimThenFail: true }),
  });
  assert.equal(timedOut.body.outcome, "unavailable");
  assert.equal(store.sent.length, 0);
  const repeat = await run(store, { claims: createDurableFakeClaimStore(state) });
  assert.equal(repeat.body.outcome, "already_attempted");
  assert.equal(store.sent.length, 0);
});

test("a database timeout while recording a successful send does not send again", async () => {
  const state = createSharedDurableClaimState();
  const store = harness();
  const result = await run(store, {
    claims: createDurableFakeClaimStore(state, { failComplete: true }),
  });
  assert.equal(result.body.outcome, "ambiguous");
  const repeat = await run(store, { claims: createDurableFakeClaimStore(state) });
  assert.equal(repeat.body.outcome, "already_attempted");
  assert.equal(store.sent.length, 1);
});

test("a definitive provider failure and a timeout are both terminal ambiguous results", async () => {
  for (const message of ["send_failed", "timeout"]) {
    const state = createSharedDurableClaimState();
    const store = harness();
    const result = await run(store, {
      claims: createDurableFakeClaimStore(state),
      send: async () => {
        throw Object.assign(new Error(message), { code: message });
      },
    });
    assert.equal(result.body.outcome, "ambiguous", message);
    assert.equal(state.rows.get(APPROVED_SHIPPING_TEST_ORDER_ID)?.status, "ambiguous");
    const repeat = await run(store, { claims: createDurableFakeClaimStore(state) });
    assert.equal(repeat.body.outcome, "already_attempted");
    assert.equal(store.sent.length, 0);
  }
});

test("the feature flag and the send arm are separate gates", async () => {
  const store = harness();
  let loaded = 0;
  const result = await handleShippingTestEmail({
    isAdmin: true,
    featureEnabled: true,
    sendArmed: false,
    kind: "physical",
    orderId: APPROVED_SHIPPING_TEST_ORDER_ID,
    getOrder: async () => {
      loaded += 1;
      return store.current;
    },
    claims: store.claims,
    send: store.deps.send,
  });
  assert.equal(result.status, 503);
  assert.match(result.body.error ?? "", /not activated/);
  assert.equal(loaded, 0);
  assert.equal(store.sent.length, 0);
  assert.equal(SHIPPING_TEST_EMAIL_SEND_ARMED, false);
  assert.equal(isShippingTestEmailSendArmed(), false);
});

test("an ebook route is rejected", async () => {
  const store = harness();
  const result = await run(store, { kind: "digital" });
  assert.equal(result.status, 404);
  assert.equal(store.sent.length, 0);
});

type CatalogOrder = {
  bookId: string;
  quantity: number;
  paymentStatus: string;
  fulfillmentStatus: string;
  carrier: string | null;
  trackingNumber: string | null;
};

function eligibleAsthma(): CatalogOrder {
  return {
    bookId: "book-three",
    quantity: 1,
    paymentStatus: "paid",
    fulfillmentStatus: "unfulfilled",
    carrier: null,
    trackingNumber: null,
  };
}

function createBoundClaimDatabase(catalog: Map<string, CatalogOrder>) {
  const claims = new Map<string, ShippingTestClaimStatus>();
  const calls: Array<{ text: string; params: unknown[] }> = [];
  const sql = {
    async query(text: string, params: unknown[] = []) {
      calls.push({ text, params: [...params] });
      if (text === SHIPPING_TEST_CLAIM_INSERT) {
        const requested = String(params[0] ?? "");
        const restrictsToParameter = /WHERE\s+id\s*=\s*\$1::uuid/i.test(text);
        const restrictsToApprovedOrder = text.includes(
          `AND id = '${APPROVED_SHIPPING_TEST_ORDER_ID}'::uuid`,
        );
        if (!restrictsToParameter || !restrictsToApprovedOrder) {
          throw new Error("claim insert is missing an exact-order SQL predicate");
        }
        if (requested !== APPROVED_SHIPPING_TEST_ORDER_ID) return [];
        const row = catalog.get(requested);
        const carrier = row?.carrier?.trim() ?? "";
        const tracking = row?.trackingNumber?.trim() ?? "";
        const eligible =
          row?.bookId === "book-three" &&
          row.quantity === 1 &&
          row.paymentStatus === "paid" &&
          row.fulfillmentStatus === "unfulfilled" &&
          carrier === "" &&
          tracking === "";
        if (!eligible || claims.has(requested)) return [];
        claims.set(requested, "claimed");
        return [{ order_id: requested }];
      }
      if (text === SHIPPING_TEST_CLAIM_STATUS) {
        const status = claims.get(String(params[0] ?? ""));
        return status ? [{ status }] : [];
      }
      if (text === SHIPPING_TEST_CLAIM_COMPLETE) {
        const orderId = String(params[0] ?? "");
        const next = params[1];
        if (next !== "accepted" && next !== "ambiguous") return [];
        if (claims.get(orderId) !== "claimed") return [];
        claims.set(orderId, next);
        return [{ order_id: orderId }];
      }
      throw new Error("unexpected claim SQL");
    },
  };
  return {
    calls,
    claims,
    store: createPostgresShippingTestClaimStore(sql as unknown as NeonQueryFunction<false, false>),
  };
}

test("the executed claim SQL binds the requested id and the approved order", async () => {
  const catalog = new Map<string, CatalogOrder>([
    [APPROVED_SHIPPING_TEST_ORDER_ID, eligibleAsthma()],
    [OTHER_ORDER_ID, eligibleAsthma()],
  ]);
  const db = createBoundClaimDatabase(catalog);
  const acquired = await db.store.tryClaim(APPROVED_SHIPPING_TEST_ORDER_ID);
  assert.equal(acquired.outcome, "claimed");
  assert.equal(db.calls[0]?.text, SHIPPING_TEST_CLAIM_INSERT);
  assert.deepEqual(db.calls[0]?.params, [APPROVED_SHIPPING_TEST_ORDER_ID]);
  assert.match(db.calls[0]?.text ?? "", /WHERE\s+id\s*=\s*\$1::uuid/i);
  assert.match(db.calls[0]?.text ?? "", new RegExp(`AND id = '${APPROVED_SHIPPING_TEST_ORDER_ID}'::uuid`));
});

test("a different eligible Asthma order cannot acquire a claim through the SQL store", async () => {
  const catalog = new Map<string, CatalogOrder>([
    [APPROVED_SHIPPING_TEST_ORDER_ID, eligibleAsthma()],
    [OTHER_ORDER_ID, eligibleAsthma()],
  ]);
  const db = createBoundClaimDatabase(catalog);
  const rejected = await db.store.tryClaim(OTHER_ORDER_ID);
  assert.equal(rejected.outcome, "not_eligible");
  assert.deepEqual(db.calls[0]?.params, [OTHER_ORDER_ID]);
  assert.equal(db.claims.size, 0);
  const acquired = await db.store.tryClaim(APPROVED_SHIPPING_TEST_ORDER_ID);
  assert.equal(acquired.outcome, "claimed");
  assert.equal(db.claims.size, 1);
});

test("bypassing the handler allowlist still cannot claim another order", async () => {
  const db = createBoundClaimDatabase(
    new Map([[OTHER_ORDER_ID, eligibleAsthma()]]),
  );
  const result = await db.store.tryClaim(OTHER_ORDER_ID);
  assert.equal(result.outcome, "not_eligible");
  assert.equal(db.claims.has(OTHER_ORDER_ID), false);
});

test("an existing terminal claim row does not send again", async () => {
  for (const status of ["claimed", "accepted", "ambiguous"] as const) {
    const db = createBoundClaimDatabase(
      new Map([[APPROVED_SHIPPING_TEST_ORDER_ID, eligibleAsthma()]]),
    );
    db.claims.set(APPROVED_SHIPPING_TEST_ORDER_ID, status);
    const store = harness();
    let sends = 0;
    const result = await handleShippingTestEmail({
      isAdmin: true,
      featureEnabled: true,
      sendArmed: true,
      kind: "physical",
      orderId: APPROVED_SHIPPING_TEST_ORDER_ID,
      getOrder: async () => store.current,
      claims: db.store,
      send: async () => {
        sends += 1;
      },
    });
    assert.equal(result.body.outcome, "already_attempted");
    assert.equal(result.body.claimStatus, status);
    assert.equal(sends, 0);
  }
});

test("a disarmed request does not query the claim table or send", async () => {
  const db = createBoundClaimDatabase(
    new Map([[APPROVED_SHIPPING_TEST_ORDER_ID, eligibleAsthma()]]),
  );
  const store = harness();
  const result = await handleShippingTestEmail({
    isAdmin: true,
    featureEnabled: true,
    sendArmed: isShippingTestEmailSendArmed(),
    kind: "physical",
    orderId: APPROVED_SHIPPING_TEST_ORDER_ID,
    getOrder: async () => store.current,
    claims: db.store,
    send: store.deps.send,
  });
  assert.equal(SHIPPING_TEST_EMAIL_SEND_ARMED, false);
  assert.equal(result.status, 503);
  assert.equal(db.calls.length, 0);
  assert.equal(db.claims.size, 0);
  assert.equal(store.sent.length, 0);
});
