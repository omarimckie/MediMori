import { readFileSync } from "node:fs";
import { evaluatePaidCheckout } from "../src/lib/checkout-ownership";
import type Stripe from "stripe";

function loadEnvLocal() {
  try {
    const env = readFileSync(".env.local", "utf8");
    for (const line of env.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq);
      const value = trimmed.slice(eq + 1).replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // .env.local is optional for evaluation-only tests
  }
}

loadEnvLocal();

type Check = { name: string; pass: boolean; detail?: string };

const checks: Check[] = [];

function assert(name: string, pass: boolean, detail?: string) {
  checks.push({ name, pass, detail });
  const mark = pass ? "PASS" : "FAIL";
  console.log(`${mark}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function session(overrides: Partial<Stripe.Checkout.Session> & {
  line_items?: Stripe.Checkout.Session["line_items"];
}): Stripe.Checkout.Session {
  return {
    id: "cs_test_base",
    object: "checkout.session",
    payment_status: "paid",
    customer_email: "Buyer@Example.com",
    metadata: { bookId: "book-one" },
    payment_intent: "pi_test_base",
    line_items: {
      object: "list",
      data: [
        {
          id: "li_1",
          object: "item",
          price: { id: "price_1TMhTEGmFetwj9NcJnvrh1e2" },
        } as Stripe.LineItem,
      ],
      has_more: false,
      url: "",
    },
    ...overrides,
  } as Stripe.Checkout.Session;
}

const sickle = evaluatePaidCheckout(session({ id: "cs_test_sickle" }));
assert(
  "1. Valid paid Sickle Cell session evaluates to book-one",
  sickle.ok && sickle.ok && sickle.purchase.bookId === "book-one" && sickle.purchase.email === "buyer@example.com",
  sickle.ok ? sickle.purchase.bookId : sickle.error,
);

const asthma = evaluatePaidCheckout(
  session({
    id: "cs_test_asthma",
    metadata: { bookId: "book-three" },
    line_items: {
      object: "list",
      data: [
        {
          id: "li_3",
          object: "item",
          price: { id: "price_1TnXUiGmFetwj9NcnkKQyGDq" },
        } as Stripe.LineItem,
      ],
      has_more: false,
      url: "",
    },
  }),
);
assert(
  "2. Valid paid Asthma session evaluates to book-three",
  asthma.ok && asthma.purchase.bookId === "book-three",
  asthma.ok ? asthma.purchase.bookId : asthma.error,
);

const wordSearch = evaluatePaidCheckout(
  session({
    id: "cs_test_word",
    metadata: { bookId: "book-two" },
    line_items: {
      object: "list",
      data: [
        {
          id: "li_2",
          object: "item",
          price: { id: "price_1TnXdqGmFetwj9NctPBwIL9R" },
        } as Stripe.LineItem,
      ],
      has_more: false,
      url: "",
    },
  }),
);
assert(
  "3. Valid paid Word Search session evaluates to book-two",
  wordSearch.ok && wordSearch.purchase.bookId === "book-two",
  wordSearch.ok ? wordSearch.purchase.bookId : wordSearch.error,
);

const unpaid = evaluatePaidCheckout(session({ payment_status: "unpaid" }));
assert("8. Unpaid session is rejected", !unpaid.ok && unpaid.status === 402, unpaid.ok ? "accepted" : unpaid.error);

const unknownBook = evaluatePaidCheckout(
  session({ metadata: { bookId: "book-nine" } }),
);
assert(
  "9. Unknown bookId is rejected",
  !unknownBook.ok,
  unknownBook.ok ? "accepted" : unknownBook.error,
);

const mismatch = evaluatePaidCheckout(
  session({
    metadata: { bookId: "book-one" },
    line_items: {
      object: "list",
      data: [
        {
          id: "li_x",
          object: "item",
          price: { id: "price_1TnXUiGmFetwj9NcnkKQyGDq" },
        } as Stripe.LineItem,
      ],
      has_more: false,
      url: "",
    },
  }),
);
assert(
  "10. Price mismatch is rejected",
  !mismatch.ok,
  mismatch.ok ? "accepted" : mismatch.error,
);

const missingEmail = evaluatePaidCheckout(
  session({
    customer_email: null,
    customer_details: null,
    metadata: { bookId: "book-one" },
  }),
);
assert(
  "11. Missing customer email is rejected",
  !missingEmail.ok,
  missingEmail.ok ? "accepted" : missingEmail.error,
);

assert(
  "12. Evaluator does not read or return card fields",
  sickle.ok &&
    !("card" in sickle.purchase) &&
    !("payment_method" in sickle.purchase) &&
    Object.keys(sickle.purchase).sort().join(",") ===
      "amountCents,bookId,currency,email,stripeChargeId,stripeCheckoutSessionId,stripePaymentIntentId",
);

async function runAsyncChecks() {
  const Stripe = (await import("stripe")).default;
  const stripe = new Stripe("sk_test_phase1_unused");
  const payload = JSON.stringify({
    id: "evt_test",
    object: "event",
    type: "checkout.session.completed",
    data: { object: { id: "cs_test_sig" } },
  });
  const secret = "whsec_test_phase1";
  const validHeader = (
    stripe.webhooks.generateTestHeaderString as (opts: {
      payload: string;
      secret: string;
    }) => string
  )({
    payload,
    secret,
  });
  try {
    stripe.webhooks.constructEvent(payload, validHeader, secret);
    assert("7a. Valid Stripe signature is accepted", true);
  } catch (error) {
    assert("7a. Valid Stripe signature is accepted", false, String(error));
  }
  try {
    stripe.webhooks.constructEvent(payload, "t=1,v1=deadbeef", secret);
    assert("7. Invalid Stripe signature is rejected", false, "constructEvent succeeded");
  } catch {
    assert("7. Invalid Stripe signature is rejected", true);
  }

  if (!process.env.DATABASE_URL?.trim()) {
    console.log("SKIP  DB tests 1b–6, 12b (DATABASE_URL not configured)");
    return;
  }

  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(process.env.DATABASE_URL.trim());
  await sql`
    CREATE TABLE IF NOT EXISTS purchases (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT NOT NULL,
      book_id TEXT NOT NULL,
      stripe_checkout_session_id TEXT NOT NULL UNIQUE,
      stripe_payment_intent_id TEXT NULL,
      purchased_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS entitlements (
      email TEXT NOT NULL,
      book_id TEXT NOT NULL,
      first_purchase_id UUID NOT NULL REFERENCES purchases (id),
      granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (email, book_id)
    )
  `;

  const { recordPurchaseAndEntitlement, countPurchasesForEmailAndBook, hasEntitlement } =
    await import("../src/lib/purchases");

  const stamp = Date.now();
  const emailA = `phase1.a.${stamp}@example.com`;
  const emailB = `phase1.b.${stamp}@example.com`;

  const sickle1 = await recordPurchaseAndEntitlement({
    email: emailA,
    bookId: "book-one",
    stripeCheckoutSessionId: `cs_test_phase1_sickle_${stamp}`,
    stripePaymentIntentId: `pi_test_phase1_sickle_${stamp}`,
  });
  assert(
    "1b. Sickle Cell purchase + entitlement written",
    sickle1.created && (await hasEntitlement(emailA, "book-one")),
  );

  const asthma1 = await recordPurchaseAndEntitlement({
    email: emailB,
    bookId: "book-three",
    stripeCheckoutSessionId: `cs_test_phase1_asthma_${stamp}`,
    stripePaymentIntentId: `pi_test_phase1_asthma_${stamp}`,
  });
  assert(
    "2b. Asthma purchase + entitlement written",
    asthma1.created && (await hasEntitlement(emailB, "book-three")),
  );

  const word1 = await recordPurchaseAndEntitlement({
    email: emailB,
    bookId: "book-two",
    stripeCheckoutSessionId: `cs_test_phase1_word_${stamp}`,
    stripePaymentIntentId: `pi_test_phase1_word_${stamp}`,
  });
  assert(
    "3b. Word Search purchase + entitlement written",
    word1.created && (await hasEntitlement(emailB, "book-two")),
  );

  const duplicate = await recordPurchaseAndEntitlement({
    email: emailA,
    bookId: "book-one",
    stripeCheckoutSessionId: `cs_test_phase1_sickle_${stamp}`,
    stripePaymentIntentId: `pi_test_phase1_sickle_${stamp}`,
  });
  const sickleCountAfterDup = await countPurchasesForEmailAndBook(emailA, "book-one");
  assert(
    "4. Duplicate checkout session does not create a second purchase",
    !duplicate.created && sickleCountAfterDup === 1,
    `created=${duplicate.created} count=${sickleCountAfterDup}`,
  );

  const sickleAgain = await recordPurchaseAndEntitlement({
    email: emailA,
    bookId: "book-one",
    stripeCheckoutSessionId: `cs_test_phase1_sickle_b_${stamp}`,
    stripePaymentIntentId: `pi_test_phase1_sickle_b_${stamp}`,
  });
  const sickleCount = await countPurchasesForEmailAndBook(emailA, "book-one");
  assert(
    "5. Second Sickle Cell transaction: two purchases, one entitlement",
    sickleAgain.created &&
      sickleCount === 2 &&
      (await hasEntitlement(emailA, "book-one")),
    `purchases=${sickleCount}`,
  );

  await recordPurchaseAndEntitlement({
    email: emailA,
    bookId: "book-three",
    stripeCheckoutSessionId: `cs_test_phase1_asthma_a_${stamp}`,
    stripePaymentIntentId: `pi_test_phase1_asthma_a_${stamp}`,
  });
  assert(
    "6. Same customer Sickle Cell + Asthma: two entitlements",
    (await hasEntitlement(emailA, "book-one")) &&
      (await hasEntitlement(emailA, "book-three")),
  );

  const cols = await sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('purchases', 'entitlements')
    ORDER BY table_name, column_name
  `;
  const names = cols.map((row) => String(row.column_name));
  const forbidden = names.filter((name) =>
    /card|cvc|cvv|pan|billing|address|password|token/i.test(name),
  );
  assert(
    "12b. Schema has no card/billing/auth-token columns",
    forbidden.length === 0,
    forbidden.join(",") || names.join(","),
  );
}

runAsyncChecks()
  .then(() => {
    const failed = checks.filter((c) => !c.pass);
    console.log(`\n${checks.length - failed.length}/${checks.length} checks passed.`);
    if (failed.length) process.exitCode = 1;
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });

