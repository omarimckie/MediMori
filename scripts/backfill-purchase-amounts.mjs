import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import Stripe from "stripe";

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

const databaseUrl = process.env.DATABASE_URL?.trim();
const stripeSecret = process.env.STRIPE_SECRET_KEY?.trim();
if (!databaseUrl) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
if (!stripeSecret) {
  console.error("STRIPE_SECRET_KEY is not set.");
  process.exit(1);
}

const sql = neon(databaseUrl);
const stripe = new Stripe(stripeSecret);

function paymentIntentId(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  return value.id ?? null;
}

function chargeIdFromPaymentIntent(paymentIntent) {
  const charge = paymentIntent?.latest_charge;
  if (!charge) return null;
  if (typeof charge === "string") return charge;
  return charge.id ?? null;
}

const purchases = await sql`
  SELECT id, stripe_checkout_session_id, stripe_payment_intent_id,
         amount_cents, currency, stripe_charge_id, refund_status
  FROM purchases
  ORDER BY purchased_at ASC
`;

const unmatched = [];
const refundsObserved = [];
let updated = 0;
let skipped = 0;

for (const row of purchases) {
  const id = String(row.id);
  const sessionId = String(row.stripe_checkout_session_id);
  const alreadyComplete =
    row.amount_cents != null &&
    row.currency &&
    row.stripe_charge_id &&
    row.refund_status;

  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["payment_intent.latest_charge"],
    });
  } catch {
    unmatched.push({
      purchaseId: id,
      sessionId,
      reason: "checkout_session_not_retrievable",
    });
    continue;
  }

  const amountCents =
    typeof session.amount_total === "number" ? session.amount_total : null;
  const currency = session.currency ?? null;
  let piId =
    paymentIntentId(session.payment_intent) ||
    (row.stripe_payment_intent_id
      ? String(row.stripe_payment_intent_id)
      : null);
  let stripeChargeId = chargeIdFromPaymentIntent(
    typeof session.payment_intent === "object" ? session.payment_intent : null,
  );

  if (!stripeChargeId && piId) {
    try {
      const pi = await stripe.paymentIntents.retrieve(piId, {
        expand: ["latest_charge"],
      });
      stripeChargeId = chargeIdFromPaymentIntent(pi);
      piId = pi.id;
    } catch {
      unmatched.push({
        purchaseId: id,
        sessionId,
        reason: "payment_intent_not_retrievable",
      });
      continue;
    }
  }

  if (amountCents == null || !currency) {
    unmatched.push({
      purchaseId: id,
      sessionId,
      reason: "missing_amount_or_currency",
    });
    continue;
  }

  if (!stripeChargeId) {
    unmatched.push({
      purchaseId: id,
      sessionId,
      reason: "missing_charge_id",
    });
    continue;
  }

  if (
    alreadyComplete &&
    Number(row.amount_cents) === amountCents &&
    String(row.currency) === currency &&
    String(row.stripe_charge_id) === stripeChargeId
  ) {
    skipped += 1;
    continue;
  }

  await sql`
    UPDATE purchases
    SET
      amount_cents = ${amountCents},
      currency = ${currency},
      stripe_charge_id = ${stripeChargeId},
      stripe_payment_intent_id = COALESCE(${piId}, stripe_payment_intent_id)
    WHERE id = ${id}::uuid
  `;
  updated += 1;

  let paymentIntent = typeof session.payment_intent === "object"
    ? session.payment_intent
    : null;
  if (!paymentIntent && piId) {
    try {
      paymentIntent = await stripe.paymentIntents.retrieve(piId, {
        expand: ["latest_charge"],
      });
    } catch {
      paymentIntent = null;
    }
  }
  const charge =
    paymentIntent &&
    typeof paymentIntent.latest_charge === "object" &&
    paymentIntent.latest_charge
      ? paymentIntent.latest_charge
      : null;
  if (charge && typeof charge.amount_refunded === "number" && charge.amount_refunded > 0) {
    const listed = await stripe.refunds.list({ charge: charge.id, limit: 100 });
    for (const refund of listed.data) {
      await sql`
        INSERT INTO purchase_refunds (
          purchase_id, stripe_refund_id, amount_cents, currency, status,
          stripe_charge_id, processed_at, reason
        )
        VALUES (
          ${id}::uuid,
          ${refund.id},
          ${refund.amount},
          ${refund.currency},
          ${refund.status ?? "pending"},
          ${typeof refund.charge === "string" ? refund.charge : charge.id},
          ${refund.status === "succeeded" ? new Date().toISOString() : null}::timestamptz,
          ${refund.reason ?? null}
        )
        ON CONFLICT (stripe_refund_id) DO NOTHING
      `;
    }
    refundsObserved.push({
      purchaseId: id,
      sessionId,
      reason: "stripe_has_refunds_recorded_without_changing_entitlements",
      amountRefunded: charge.amount_refunded,
    });
  }
}

console.log(
  JSON.stringify(
    {
      total: purchases.length,
      updated,
      skippedUnchanged: skipped,
      unmatched,
      refundsObserved,
    },
    null,
    2,
  ),
);
