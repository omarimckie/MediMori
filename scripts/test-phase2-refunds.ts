import { readFileSync } from "node:fs";
import { isReaderBookId } from "../src/lib/reader-catalog";

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
    // optional
  }
}

loadEnvLocal();

type Check = { name: string; pass: boolean; detail?: string };
const checks: Check[] = [];

function assert(name: string, pass: boolean, detail?: string) {
  checks.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function run() {
const {
  isPurchaseValidForEntitlement,
  refundStatusFromAmounts,
} = await import("../src/lib/purchase-refunds");

assert(
  "J. Discounted $10 purchase is fully refunded only at $10 succeeded",
  refundStatusFromAmounts(1000, 200) === "partially_refunded" &&
    isPurchaseValidForEntitlement(1000, 200) &&
    refundStatusFromAmounts(1000, 1000) === "fully_refunded" &&
    !isPurchaseValidForEntitlement(1000, 1000),
);

assert(
  "Unknown amount is never guessed as fully refunded",
  refundStatusFromAmounts(null, 500) === "partially_refunded" &&
    isPurchaseValidForEntitlement(null, 500),
);

if (!process.env.DATABASE_URL?.trim()) {
  console.log("SKIP  database refund tests (DATABASE_URL not configured)");
} else {
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(process.env.DATABASE_URL.trim());
  const { recordPurchaseAndEntitlement, hasEntitlement, getPurchaseById, getEntitlement } =
    await import("../src/lib/purchases");
  const { recordStripeRefundAndRecompute } = await import("../src/lib/purchase-refunds");

  const stamp = Date.now();
  const email = `refund.phase2.${stamp}@example.com`;

  async function cleanup() {
    await sql`DELETE FROM entitlements WHERE email = ${email}`;
    await sql`
      DELETE FROM purchase_refunds
      WHERE purchase_id IN (SELECT id FROM purchases WHERE email = ${email})
    `;
    await sql`DELETE FROM purchases WHERE email = ${email}`;
  }

  await cleanup();

  try {
    const paid = await recordPurchaseAndEntitlement({
      email,
      bookId: "book-one",
      stripeCheckoutSessionId: `cs_test_rf_a_${stamp}`,
      stripePaymentIntentId: `pi_test_rf_a_${stamp}`,
      amountCents: 1000,
      currency: "usd",
      stripeChargeId: `ch_test_rf_a_${stamp}`,
    });
    assert(
      "A. One paid purchase → entitlement exists",
      paid.created && (await hasEntitlement(email, "book-one")),
    );

    await recordStripeRefundAndRecompute({
      stripeRefundId: `re_test_partial_${stamp}`,
      amountCents: 200,
      currency: "usd",
      status: "succeeded",
      stripeChargeId: `ch_test_rf_a_${stamp}`,
      stripePaymentIntentId: `pi_test_rf_a_${stamp}`,
      reason: "requested_by_customer",
      processedAt: new Date(),
    });
    const afterPartial = await getPurchaseById(paid.purchase.id);
    assert(
      "B. Partial refund → partially_refunded and entitlement remains",
      afterPartial?.refundStatus === "partially_refunded" &&
        (await hasEntitlement(email, "book-one")),
      afterPartial?.refundStatus,
    );

    await recordStripeRefundAndRecompute({
      stripeRefundId: `re_test_rest_${stamp}`,
      amountCents: 800,
      currency: "usd",
      status: "succeeded",
      stripeChargeId: `ch_test_rf_a_${stamp}`,
      stripePaymentIntentId: `pi_test_rf_a_${stamp}`,
      reason: "requested_by_customer",
      processedAt: new Date(),
    });
    const afterFull = await getPurchaseById(paid.purchase.id);
    assert(
      "C. Full refund → fully_refunded and entitlement removed",
      afterFull?.refundStatus === "fully_refunded" &&
        !(await hasEntitlement(email, "book-one")),
      afterFull?.refundStatus,
    );

    const emailDup = `refund.phase2.dup.${stamp}@example.com`;
    const a = await recordPurchaseAndEntitlement({
      email: emailDup,
      bookId: "book-one",
      stripeCheckoutSessionId: `cs_test_rf_dup_a_${stamp}`,
      stripePaymentIntentId: `pi_test_rf_dup_a_${stamp}`,
      amountCents: 700,
      currency: "usd",
      stripeChargeId: `ch_test_rf_dup_a_${stamp}`,
    });
    const b = await recordPurchaseAndEntitlement({
      email: emailDup,
      bookId: "book-one",
      stripeCheckoutSessionId: `cs_test_rf_dup_b_${stamp}`,
      stripePaymentIntentId: `pi_test_rf_dup_b_${stamp}`,
      amountCents: 700,
      currency: "usd",
      stripeChargeId: `ch_test_rf_dup_b_${stamp}`,
    });
    await recordStripeRefundAndRecompute({
      stripeRefundId: `re_test_dup_a_${stamp}`,
      amountCents: 700,
      currency: "usd",
      status: "succeeded",
      stripeChargeId: `ch_test_rf_dup_a_${stamp}`,
      stripePaymentIntentId: `pi_test_rf_dup_a_${stamp}`,
      reason: null,
      processedAt: new Date(),
    });
    const entitlementAfterFirstRefund = await getEntitlement(emailDup, "book-one");
    assert(
      "D. Two paid purchases, refund first → entitlement remains",
      (await hasEntitlement(emailDup, "book-one")) &&
        entitlementAfterFirstRefund?.firstPurchaseId === b.purchase.id,
      entitlementAfterFirstRefund?.firstPurchaseId,
    );

    await recordStripeRefundAndRecompute({
      stripeRefundId: `re_test_dup_b_${stamp}`,
      amountCents: 700,
      currency: "usd",
      status: "succeeded",
      stripeChargeId: `ch_test_rf_dup_b_${stamp}`,
      stripePaymentIntentId: `pi_test_rf_dup_b_${stamp}`,
      reason: null,
      processedAt: new Date(),
    });
    assert(
      "E. Two paid purchases, refund both → entitlement removed",
      !(await hasEntitlement(emailDup, "book-one")),
    );

    const beforeDup = await sql`
      SELECT COUNT(*)::int AS n FROM purchase_refunds
      WHERE stripe_refund_id = ${`re_test_dup_b_${stamp}`}
    `;
    await recordStripeRefundAndRecompute({
      stripeRefundId: `re_test_dup_b_${stamp}`,
      amountCents: 700,
      currency: "usd",
      status: "succeeded",
      stripeChargeId: `ch_test_rf_dup_b_${stamp}`,
      stripePaymentIntentId: `pi_test_rf_dup_b_${stamp}`,
      reason: null,
      processedAt: new Date(),
    });
    const afterDup = await sql`
      SELECT COUNT(*)::int AS n FROM purchase_refunds
      WHERE stripe_refund_id = ${`re_test_dup_b_${stamp}`}
    `;
    assert(
      "F. Duplicate refund webhook → one row, no double-count",
      Number(beforeDup[0]?.n) === 1 && Number(afterDup[0]?.n) === 1,
    );

    const emailHold = `refund.phase2.hold.${stamp}@example.com`;
    const hold = await recordPurchaseAndEntitlement({
      email: emailHold,
      bookId: "book-two",
      stripeCheckoutSessionId: `cs_test_rf_hold_${stamp}`,
      stripePaymentIntentId: `pi_test_rf_hold_${stamp}`,
      amountCents: 700,
      currency: "usd",
      stripeChargeId: `ch_test_rf_hold_${stamp}`,
    });
    for (const [label, status, letter] of [
      ["G. Pending refund → entitlement remains", "pending", "G"],
      ["H. Failed refund → entitlement remains", "failed", "H"],
      ["I. Canceled refund → entitlement remains", "canceled", "I"],
    ] as const) {
      await recordStripeRefundAndRecompute({
        stripeRefundId: `re_test_${status}_${stamp}`,
        amountCents: 700,
        currency: "usd",
        status,
        stripeChargeId: `ch_test_rf_hold_${stamp}`,
        stripePaymentIntentId: `pi_test_rf_hold_${stamp}`,
        reason: null,
        processedAt: null,
      });
      const row = await getPurchaseById(hold.purchase.id);
      assert(
        label,
        row?.refundStatus === "paid" && (await hasEntitlement(emailHold, "book-two")),
        row?.refundStatus,
      );
    }

    const emailNew = `refund.phase2.new.${stamp}@example.com`;
    const original = await recordPurchaseAndEntitlement({
      email: emailNew,
      bookId: "book-three",
      stripeCheckoutSessionId: `cs_test_rf_orig_${stamp}`,
      stripePaymentIntentId: `pi_test_rf_orig_${stamp}`,
      amountCents: 700,
      currency: "usd",
      stripeChargeId: `ch_test_rf_orig_${stamp}`,
    });
    await recordStripeRefundAndRecompute({
      stripeRefundId: `re_test_orig_${stamp}`,
      amountCents: 700,
      currency: "usd",
      status: "succeeded",
      stripeChargeId: `ch_test_rf_orig_${stamp}`,
      stripePaymentIntentId: `pi_test_rf_orig_${stamp}`,
      reason: null,
      processedAt: new Date(),
    });
    await recordPurchaseAndEntitlement({
      email: emailNew,
      bookId: "book-three",
      stripeCheckoutSessionId: `cs_test_rf_new_${stamp}`,
      stripePaymentIntentId: `pi_test_rf_new_${stamp}`,
      amountCents: 700,
      currency: "usd",
      stripeChargeId: `ch_test_rf_new_${stamp}`,
    });
    assert(
      "K. Fully refunded original + new valid purchase → entitlement exists",
      (await hasEntitlement(emailNew, "book-three")),
    );

    await recordPurchaseAndEntitlement({
      email: emailNew,
      bookId: "book-three",
      stripeCheckoutSessionId: `cs_test_rf_orig_${stamp}`,
      stripePaymentIntentId: `pi_test_rf_orig_${stamp}`,
      amountCents: 700,
      currency: "usd",
      stripeChargeId: `ch_test_rf_orig_${stamp}`,
    });
    const origAfterReplay = await getPurchaseById(original.purchase.id);
    assert(
      "L. Replayed checkout.session.completed for fully refunded purchase does not restore that purchase",
      origAfterReplay?.refundStatus === "fully_refunded" &&
        (await hasEntitlement(emailNew, "book-three")),
      origAfterReplay?.refundStatus,
    );

    const emailReader = `refund.phase2.reader.${stamp}@example.com`;
    const sickle = await recordPurchaseAndEntitlement({
      email: emailReader,
      bookId: "book-one",
      stripeCheckoutSessionId: `cs_test_rf_sc_${stamp}`,
      stripePaymentIntentId: `pi_test_rf_sc_${stamp}`,
      amountCents: 700,
      currency: "usd",
      stripeChargeId: `ch_test_rf_sc_${stamp}`,
    });
    const asthma = await recordPurchaseAndEntitlement({
      email: emailReader,
      bookId: "book-three",
      stripeCheckoutSessionId: `cs_test_rf_as_${stamp}`,
      stripePaymentIntentId: `pi_test_rf_as_${stamp}`,
      amountCents: 700,
      currency: "usd",
      stripeChargeId: `ch_test_rf_as_${stamp}`,
    });
    const word = await recordPurchaseAndEntitlement({
      email: emailReader,
      bookId: "book-two",
      stripeCheckoutSessionId: `cs_test_rf_ws_${stamp}`,
      stripePaymentIntentId: `pi_test_rf_ws_${stamp}`,
      amountCents: 700,
      currency: "usd",
      stripeChargeId: `ch_test_rf_ws_${stamp}`,
    });
    await recordStripeRefundAndRecompute({
      stripeRefundId: `re_test_sc_${stamp}`,
      amountCents: 700,
      currency: "usd",
      status: "succeeded",
      stripeChargeId: `ch_test_rf_sc_${stamp}`,
      stripePaymentIntentId: `pi_test_rf_sc_${stamp}`,
      reason: null,
      processedAt: new Date(),
    });
    await recordStripeRefundAndRecompute({
      stripeRefundId: `re_test_as_${stamp}`,
      amountCents: 700,
      currency: "usd",
      status: "succeeded",
      stripeChargeId: `ch_test_rf_as_${stamp}`,
      stripePaymentIntentId: `pi_test_rf_as_${stamp}`,
      reason: null,
      processedAt: new Date(),
    });
    await recordStripeRefundAndRecompute({
      stripeRefundId: `re_test_ws_${stamp}`,
      amountCents: 700,
      currency: "usd",
      status: "succeeded",
      stripeChargeId: `ch_test_rf_ws_${stamp}`,
      stripePaymentIntentId: `pi_test_rf_ws_${stamp}`,
      reason: null,
      processedAt: new Date(),
    });

    const readerWouldReject = async (bookId: "book-one" | "book-three") =>
      isReaderBookId(bookId) && !(await hasEntitlement(emailReader, bookId));
    const libraryDownloadWouldReject = !(await hasEntitlement(emailReader, "book-two"));

    assert(
      "M. Sickle Cell entitlement revocation → reader hasEntitlement is false",
      await readerWouldReject("book-one"),
    );
    assert(
      "N. Asthma entitlement revocation → reader hasEntitlement is false",
      await readerWouldReject("book-three"),
    );
    assert(
      "O. Word Search entitlement revocation → library download hasEntitlement is false",
      libraryDownloadWouldReject,
    );

    void sickle;
    void asthma;
    void word;

    await sql`DELETE FROM entitlements WHERE email LIKE ${`refund.phase2.${stamp}%`} OR email LIKE ${`refund.phase2.%.${stamp}@example.com`}`;
    await sql`
      DELETE FROM purchase_refunds
      WHERE purchase_id IN (
        SELECT id FROM purchases WHERE email LIKE ${`refund.phase2%${stamp}%`}
      )
    `;
    await sql`DELETE FROM purchases WHERE email LIKE ${`refund.phase2%${stamp}%`}`;
  } catch (error) {
    await cleanup();
    throw error;
  }
}

}

run()
  .then(() => {
    const failed = checks.filter((c) => !c.pass);
    console.log(`\n${checks.length - failed.length}/${checks.length} checks passed.`);
    if (failed.length) process.exitCode = 1;
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
