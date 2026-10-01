import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isValidCheckoutSessionId,
  resolveCheckoutSessionSummary,
  CheckoutSessionSummaryError,
} from "./checkout-session-summary";
import { physicalOrderTotalCents } from "./physical-books";
import type Stripe from "stripe";

function physicalSession(
  overrides: Partial<Stripe.Checkout.Session> = {},
): Stripe.Checkout.Session {
  const quantity = 1;
  const total = physicalOrderTotalCents(quantity);
  return {
    id: "cs_test_physical_summary",
    object: "checkout.session",
    payment_status: "paid",
    status: "complete",
    amount_total: total,
    currency: "usd",
    metadata: {
      purchaseType: "physical",
      bookId: "book-one",
      quantity: String(quantity),
    },
    total_details: {
      amount_shipping: 499,
    },
    ...overrides,
  } as Stripe.Checkout.Session;
}

function ebookSession(
  overrides: Partial<Stripe.Checkout.Session> = {},
): Stripe.Checkout.Session {
  return {
    id: "cs_test_ebook_summary",
    object: "checkout.session",
    payment_status: "paid",
    status: "complete",
    amount_total: 700,
    metadata: {
      bookId: "book-one",
      customerName: "Buyer",
      customerEmail: "buyer@example.com",
    },
    ...overrides,
  } as Stripe.Checkout.Session;
}

test("isValidCheckoutSessionId accepts Stripe checkout session ids", () => {
  assert.equal(isValidCheckoutSessionId("cs_test_abc123"), true);
  assert.equal(isValidCheckoutSessionId("not-a-session"), false);
  assert.equal(isValidCheckoutSessionId(""), false);
});

test("resolveCheckoutSessionSummary returns physical summary for paid physical session", () => {
  const summary = resolveCheckoutSessionSummary(physicalSession(), true);
  assert.equal(summary.purchaseType, "physical");
  if (summary.purchaseType !== "physical") return;
  assert.equal(summary.bookId, "book-one");
  assert.match(summary.bookTitle, /Sickle Cell/i);
  assert.equal(summary.quantity, 1);
  assert.equal(summary.amountTotalCents, 1499);
  assert.equal(summary.shippingCents, 499);
  assert.equal(summary.orderRecorded, true);
});

test("resolveCheckoutSessionSummary rejects unpaid physical session", () => {
  assert.throws(
    () =>
      resolveCheckoutSessionSummary(
        physicalSession({ payment_status: "unpaid" }),
        false,
      ),
    (error: unknown) => {
      assert.ok(error instanceof CheckoutSessionSummaryError);
      assert.equal(error.status, 402);
      return true;
    },
  );
});

test("resolveCheckoutSessionSummary rejects incomplete physical session", () => {
  assert.throws(
    () =>
      resolveCheckoutSessionSummary(
        physicalSession({ status: "open" }),
        false,
      ),
    (error: unknown) => {
      assert.ok(error instanceof CheckoutSessionSummaryError);
      assert.equal(error.status, 402);
      return true;
    },
  );
});

test("resolveCheckoutSessionSummary returns ebook for paid non-physical session", () => {
  const summary = resolveCheckoutSessionSummary(ebookSession(), false);
  assert.deepEqual(summary, { purchaseType: "ebook" });
});

test("resolveCheckoutSessionSummary accepts newsletter-discounted physical total with $4.99 shipping", () => {
  const summary = resolveCheckoutSessionSummary(
    physicalSession({ amount_total: 1399 }),
    false,
  );
  assert.equal(summary.purchaseType, "physical");
  if (summary.purchaseType !== "physical") return;
  assert.equal(summary.amountTotalCents, 1399);
  assert.equal(summary.shippingCents, 499);
});

test("resolveCheckoutSessionSummary rejects physical session with non-catalog shipping", () => {
  assert.throws(
    () =>
      resolveCheckoutSessionSummary(
        physicalSession({
          total_details: { amount_shipping: 449 } as NonNullable<
            Stripe.Checkout.Session["total_details"]
          >,
        }),
        false,
      ),
    (error: unknown) => {
      assert.ok(error instanceof CheckoutSessionSummaryError);
      assert.equal(error.status, 400);
      return true;
    },
  );
});

test("resolveCheckoutSessionSummary rejects ebook session without book metadata", () => {
  assert.throws(
    () =>
      resolveCheckoutSessionSummary(
        ebookSession({ metadata: {} }),
        false,
      ),
    (error: unknown) => {
      assert.ok(error instanceof CheckoutSessionSummaryError);
      assert.equal(error.status, 400);
      return true;
    },
  );
});
