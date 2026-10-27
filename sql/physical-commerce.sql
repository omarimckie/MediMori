-- Direct paperback sales (Twilight Feather inventory).
-- Apply with: node scripts/apply-physical-commerce-schema.mjs

CREATE TABLE IF NOT EXISTS physical_inventory (
  book_id TEXT PRIMARY KEY,
  quantity_on_hand INTEGER NOT NULL CHECK (quantity_on_hand >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS physical_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_checkout_session_id TEXT NOT NULL UNIQUE,
  stripe_payment_intent_id TEXT NULL,
  book_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL,
  shipping_price_cents INTEGER NOT NULL,
  total_amount_cents INTEGER NOT NULL,
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  shipping_address JSONB NOT NULL,
  fulfillment_status TEXT NOT NULL DEFAULT 'unfulfilled',
  tracking_number TEXT NULL,
  carrier TEXT NULL,
  purchased_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS physical_orders_book_id_idx
  ON physical_orders (book_id);

CREATE INDEX IF NOT EXISTS physical_orders_fulfillment_status_idx
  ON physical_orders (fulfillment_status);

-- Idempotent seed: only insert when the book row is missing.
INSERT INTO physical_inventory (book_id, quantity_on_hand)
VALUES ('book-one', 20)
ON CONFLICT (book_id) DO NOTHING;

INSERT INTO physical_inventory (book_id, quantity_on_hand)
VALUES ('book-three', 20)
ON CONFLICT (book_id) DO NOTHING;
