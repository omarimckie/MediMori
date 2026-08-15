-- Permanent eBook ownership (Phase 1).
-- magic_link_tokens is in sql/magic-link-tokens.sql (Phase 2).

CREATE TABLE IF NOT EXISTS purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  book_id TEXT NOT NULL,
  stripe_checkout_session_id TEXT NOT NULL UNIQUE,
  stripe_payment_intent_id TEXT NULL,
  purchased_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS entitlements (
  email TEXT NOT NULL,
  book_id TEXT NOT NULL,
  first_purchase_id UUID NOT NULL REFERENCES purchases (id),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (email, book_id)
);
