-- Additive refund infrastructure. Do not drop purchases or entitlements.

ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS amount_cents INTEGER NULL,
  ADD COLUMN IF NOT EXISTS currency TEXT NULL,
  ADD COLUMN IF NOT EXISTS stripe_charge_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS refund_status TEXT NOT NULL DEFAULT 'paid',
  ADD COLUMN IF NOT EXISTS fully_refunded_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS purchases_payment_intent_idx
  ON purchases (stripe_payment_intent_id);

CREATE INDEX IF NOT EXISTS purchases_email_book_idx
  ON purchases (email, book_id);

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
);

CREATE INDEX IF NOT EXISTS purchase_refunds_purchase_id_idx
  ON purchase_refunds (purchase_id);
