import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL?.trim()) {
    return process.env.DATABASE_URL.trim();
  }

  try {
    const env = readFileSync(".env.local", "utf8");
    const match = env.match(/^DATABASE_URL=(.*)$/m);
    if (!match) return "";
    return match[1].trim().replace(/^["']|["']$/g, "");
  } catch {
    return "";
  }
}

const url = loadDatabaseUrl();
if (!url) {
  console.error("DATABASE_URL is not set. Add it to the environment or .env.local.");
  process.exit(1);
}

const sql = neon(url);

await sql`
  ALTER TABLE purchases
    ADD COLUMN IF NOT EXISTS amount_cents INTEGER NULL
`;
await sql`
  ALTER TABLE purchases
    ADD COLUMN IF NOT EXISTS currency TEXT NULL
`;
await sql`
  ALTER TABLE purchases
    ADD COLUMN IF NOT EXISTS stripe_charge_id TEXT NULL
`;
await sql`
  ALTER TABLE purchases
    ADD COLUMN IF NOT EXISTS refund_status TEXT NOT NULL DEFAULT 'paid'
`;
await sql`
  ALTER TABLE purchases
    ADD COLUMN IF NOT EXISTS fully_refunded_at TIMESTAMPTZ NULL
`;

await sql`
  CREATE INDEX IF NOT EXISTS purchases_payment_intent_idx
    ON purchases (stripe_payment_intent_id)
`;
await sql`
  CREATE INDEX IF NOT EXISTS purchases_email_book_idx
    ON purchases (email, book_id)
`;

await sql`
  CREATE TABLE IF NOT EXISTS purchase_refunds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_id UUID NOT NULL REFERENCES purchases (id),
    stripe_refund_id TEXT UNIQUE NOT NULL,
    amount_cents INTEGER NOT NULL,
    currency TEXT NOT NULL,
    status TEXT NOT NULL,
    stripe_charge_id TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ NULL,
    reason TEXT NULL
  )
`;
await sql`
  CREATE INDEX IF NOT EXISTS purchase_refunds_purchase_id_idx
    ON purchase_refunds (purchase_id)
`;

console.log("Applied additive purchase refund schema.");
