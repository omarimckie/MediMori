-- Permanent eBook ownership.
-- Refund columns and purchase_refunds: sql/purchase-refunds.sql.

CREATE TABLE IF NOT EXISTS purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  book_id TEXT NOT NULL,
  stripe_checkout_session_id TEXT NOT NULL UNIQUE,
  stripe_payment_intent_id TEXT NULL,
  amount_cents INTEGER NULL,
  currency TEXT NULL,
  stripe_charge_id TEXT NULL,
  refund_status TEXT NOT NULL DEFAULT 'paid',
  fully_refunded_at TIMESTAMPTZ NULL,
  purchased_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS entitlements (
  email TEXT NOT NULL,
  book_id TEXT NOT NULL,
  first_purchase_id UUID NOT NULL REFERENCES purchases (id),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (email, book_id)
);
