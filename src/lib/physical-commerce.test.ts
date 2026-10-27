import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluatePaidCheckout } from "./checkout-ownership";
import { formatShippingAddressForEmail } from "./email";
import { previewInventoryDecrement } from "./physical-inventory";
import {
  PHYSICAL_SHIPPING_PRICE_CENTS,
  PHYSICAL_UNIT_PRICE_CENTS,
  isPhysicalDirectBookId,
  physicalOrderTotalCents,
} from "./physical-books";
import {
  evaluatePaidPhysicalCheckout,
  shippingAddressFromSession,
} from "./physical-checkout-ownership";
import { buildPhysicalCheckoutSessionCreateParams } from "./physical-checkout-session";
import {
  getPhysicalStripePriceId,
  isAllowedPhysicalBookPrice,
} from "./stripe-physical-prices";
import type Stripe from "stripe";

const TEST_PHYSICAL_ONE = "price_test_physical_book_one";
const TEST_PHYSICAL_THREE = "price_test_physical_book_three";

function physicalSession(overrides: Partial<Stripe.Checkout.Session> = {}): Stripe.Checkout.Session {
  const quantity = 2;
  const total = physicalOrderTotalCents(quantity);
  return {
    id: "cs_test_physical",
    object: "checkout.session",
    payment_status: "paid",
    amount_total: total,
    currency: "usd",
    metadata: {
      purchaseType: "physical",
      bookId: "book-one",
      quantity: String(quantity),
    },
    customer_details: {
      email: "buyer@example.com",
      name: "Buyer Name",
    },
    collected_information: {
      business_name: null,
      individual_name: null,
      shipping_details: {
        name: "Buyer Name",
        address: {
          line1: "123 Main St",
          line2: null,
          city: "Miami",
          state: "FL",
          postal_code: "33101",
          country: "US",
        },
      },
    },
    line_items: {
      object: "list",
      data: [
        {
          id: "li_test",
          object: "item",
          quantity,
          price: { id: TEST_PHYSICAL_ONE, object: "price" },
        } as Stripe.LineItem,
      ],
      has_more: false,
      url: "",
    },
    total_details: {
      amount_shipping: PHYSICAL_SHIPPING_PRICE_CENTS,
    },
    payment_intent: "pi_test_physical",
    ...overrides,
  } as Stripe.Checkout.Session;
}

test("physical pricing is $10 per book and $4.99 shipping per order", () => {
  assert.equal(PHYSICAL_UNIT_PRICE_CENTS, 1000);
  assert.equal(PHYSICAL_SHIPPING_PRICE_CENTS, 499);
  assert.equal(physicalOrderTotalCents(1), 1499);
  assert.equal(physicalOrderTotalCents(2), 2499);
  assert.equal(physicalOrderTotalCents(3), 3499);
});

test("only sickle cell and asthma are physical direct titles", () => {
  assert.equal(isPhysicalDirectBookId("book-one"), true);
  assert.equal(isPhysicalDirectBookId("book-three"), true);
  assert.equal(isPhysicalDirectBookId("book-two"), false);
});

test("physical checkout session uses catalog price, shipping, and US address collection", () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_local";
  process.env.STRIPE_TEST_PRICE_PHYSICAL_BOOK_ONE = TEST_PHYSICAL_ONE;

  const params = buildPhysicalCheckoutSessionCreateParams({
    bookId: "book-one",
    quantity: 2,
    priceId: TEST_PHYSICAL_ONE,
    successUrl: "https://example.com/success",
    cancelUrl: "https://example.com/cancel",
    customerEmail: "buyer@example.com",
  });

  assert.equal(params.line_items?.[0]?.price, TEST_PHYSICAL_ONE);
  assert.equal(params.line_items?.[0]?.quantity, 2);
  assert.equal(params.allow_promotion_codes, true);
  assert.deepEqual(params.shipping_address_collection?.allowed_countries, ["US"]);
  assert.equal(
    params.shipping_options?.[0]?.shipping_rate_data?.fixed_amount?.amount,
    499,
  );
  assert.equal(params.metadata?.purchaseType, "physical");
  assert.equal(params.metadata?.bookId, "book-one");
  assert.equal(params.metadata?.quantity, "2");
});

test("physical checkout cannot use word search catalog", () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_local";
  assert.throws(
    () =>
      buildPhysicalCheckoutSessionCreateParams({
        bookId: "book-two",
        quantity: 1,
        priceId: "price_any",
        successUrl: "https://example.com/success",
        cancelUrl: "https://example.com/cancel",
        customerEmail: "buyer@example.com",
      }),
    /Unsupported physical book/,
  );
});

test("client cannot pass an arbitrary physical price id", () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_local";
  process.env.STRIPE_TEST_PRICE_PHYSICAL_BOOK_ONE = TEST_PHYSICAL_ONE;

  assert.throws(
    () =>
      buildPhysicalCheckoutSessionCreateParams({
        bookId: "book-one",
        quantity: 1,
        priceId: "price_wrong",
        successUrl: "https://example.com/success",
        cancelUrl: "https://example.com/cancel",
        customerEmail: "buyer@example.com",
      }),
    /does not match catalog/,
  );
});

test("evaluatePaidPhysicalCheckout validates amount and blocks wrong totals", () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_local";
  process.env.STRIPE_TEST_PRICE_PHYSICAL_BOOK_ONE = TEST_PHYSICAL_ONE;

  const ok = evaluatePaidPhysicalCheckout(physicalSession());
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.order.quantity, 2);
    assert.equal(ok.order.amountCents, 2499);
    assert.equal(ok.order.unitPriceCents, 1000);
    assert.equal(ok.order.shippingPriceCents, 499);
  }

  const badTotal = evaluatePaidPhysicalCheckout(
    physicalSession({ amount_total: 100 }),
  );
  assert.equal(badTotal.ok, false);
});

test("evaluatePaidCheckout rejects physical sessions (no ebook entitlement path)", () => {
  const ebookPath = evaluatePaidCheckout(physicalSession());
  assert.equal(ebookPath.ok, false);
  if (!ebookPath.ok) {
    assert.match(ebookPath.error, /physical purchase/i);
  }
});

test("shipping address is extracted for order snapshot", () => {
  const address = shippingAddressFromSession(physicalSession());
  assert.ok(address);
  assert.equal(address?.line1, "123 Main St");
  assert.equal(address?.country, "US");
});

test("physical stripe price helpers use test env in sk_test mode", () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_local";
  process.env.STRIPE_TEST_PRICE_PHYSICAL_BOOK_ONE = TEST_PHYSICAL_ONE;
  process.env.STRIPE_TEST_PRICE_PHYSICAL_BOOK_THREE = TEST_PHYSICAL_THREE;

  assert.equal(
    getPhysicalStripePriceId({ id: "book-one", stripePriceIdPhysical: "price_live_one" }),
    TEST_PHYSICAL_ONE,
  );
  assert.equal(
    isAllowedPhysicalBookPrice(
      { id: "book-one", stripePriceIdPhysical: "price_live_one" },
      TEST_PHYSICAL_ONE,
    ),
    true,
  );
  assert.equal(
    isAllowedPhysicalBookPrice(
      { id: "book-three", stripePriceIdPhysical: "price_live_three" },
      TEST_PHYSICAL_ONE,
    ),
    false,
  );
});

test("shipping snapshot formatter includes address lines for emails", () => {
  const formatted = formatShippingAddressForEmail({
    name: "Buyer Name",
    line1: "123 Main St",
    line2: "Apt 4",
    city: "Miami",
    state: "FL",
    postalCode: "33101",
    country: "US",
  });
  assert.match(formatted, /123 Main St/);
  assert.match(formatted, /Miami, FL, 33101/);
});

test("previewInventoryDecrement matches authoritative decrement rules", () => {
  assert.equal(previewInventoryDecrement(20, 1), 19);
  assert.equal(previewInventoryDecrement(1, 1), 0);
  assert.equal(previewInventoryDecrement(0, 1), null);
  assert.equal(previewInventoryDecrement(1, 2), null);
});

test("when stock is 1, only one unit decrement succeeds (inventory layer)", () => {
  let onHand = 1;
  const claimUnit = (): boolean => {
    const next = previewInventoryDecrement(onHand, 1);
    if (next === null) return false;
    onHand = next;
    return true;
  };

  assert.equal(claimUnit(), true);
  assert.equal(claimUnit(), false);
  assert.equal(onHand, 0);
  assert.equal(previewInventoryDecrement(onHand, 1), null);
});

test(
  "Postgres inventory decrement (optional; PHYSICAL_COMMERCE_TEST_DATABASE_URL only)",
  { skip: !process.env.PHYSICAL_COMMERCE_TEST_DATABASE_URL?.trim() },
  async () => {
    const { neon } = await import("@neondatabase/serverless");
    const connectionString = process.env.PHYSICAL_COMMERCE_TEST_DATABASE_URL!.trim();
    const sql = neon(connectionString);
    const bookId = "book-one";
    const decrementOne = async (): Promise<number | null> => {
      const rows = await sql`
        UPDATE physical_inventory
        SET
          quantity_on_hand = quantity_on_hand - ${1},
          updated_at = NOW()
        WHERE book_id = ${bookId}
          AND quantity_on_hand >= ${1}
        RETURNING quantity_on_hand
      `;
      if (!rows.length) return null;
      return Number(rows[0]?.quantity_on_hand ?? 0);
    };
    const first = await decrementOne();
    const second = await decrementOne();
    assert.ok(
      first === null || second === null,
      "at most one decrement may succeed for the last unit",
    );
  },
);
