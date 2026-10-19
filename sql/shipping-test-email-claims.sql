-- Idempotent claim ledger for the disarmed admin asthma shipping-test email.
-- Apply only after owner approval. Do not run automatically.
-- Requires physical_orders (order-notifications / physical order schema).

CREATE TABLE IF NOT EXISTS shipping_test_email_claims (
  order_id UUID NOT NULL REFERENCES physical_orders (id) ON DELETE RESTRICT,
  purpose TEXT NOT NULL,
  status TEXT NOT NULL,
  completed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (order_id),
  CONSTRAINT shipping_test_email_claims_purpose_chk
    CHECK (purpose = 'asthma-shipping-test'),
  CONSTRAINT shipping_test_email_claims_status_chk
    CHECK (status IN ('claimed', 'accepted', 'ambiguous'))
);

-- In-flight send attempts remain status = 'claimed' AND completed_at IS NULL
-- until the handler records accepted or ambiguous.
