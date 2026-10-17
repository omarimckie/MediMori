-- Owner purchase notifications for paid Twilight Feather orders.
-- Apply with: node scripts/apply-order-notifications-schema.mjs
-- Existing physical orders default inventory_state to applied so this migration
-- does not decrement stock for orders already recorded.

ALTER TABLE physical_orders
  ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'paid';

ALTER TABLE physical_orders
  ADD COLUMN IF NOT EXISTS inventory_state TEXT NOT NULL DEFAULT 'applied';

ALTER TABLE physical_orders
  ADD COLUMN IF NOT EXISTS shipping_address_missing BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE physical_orders
  ADD COLUMN IF NOT EXISTS attention_flags JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS digital_purchase_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id UUID NOT NULL REFERENCES purchases (id),
  book_id TEXT NOT NULL,
  title TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_amount_cents INTEGER NULL,
  line_amount_cents INTEGER NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (purchase_id, book_id)
);

CREATE TABLE IF NOT EXISTS order_notification_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key TEXT NOT NULL UNIQUE,
  order_kind TEXT NOT NULL,
  order_id UUID NOT NULL,
  stripe_event_id TEXT NULL,
  stripe_checkout_session_id TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  destination TEXT NOT NULL,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS order_notification_jobs_retry_idx
  ON order_notification_jobs (next_attempt_at)
  WHERE status = 'failed';

CREATE TABLE IF NOT EXISTS order_attention (
  order_kind TEXT NOT NULL,
  order_id UUID NOT NULL,
  attention_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  acknowledged_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (order_kind, order_id)
);

CREATE INDEX IF NOT EXISTS order_attention_unacknowledged_idx
  ON order_attention (created_at)
  WHERE acknowledged_at IS NULL;

ALTER TABLE order_notification_jobs
  ADD COLUMN IF NOT EXISTS claim_token UUID NULL;

-- status remains unconstrained text and may be queued, sending, sent, failed, or exhausted.

CREATE TABLE IF NOT EXISTS order_notification_backfill_runs (
  id UUID PRIMARY KEY,
  source TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  operator_identity TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE order_notification_jobs
  ADD COLUMN IF NOT EXISTS backfill_run_id UUID NULL REFERENCES order_notification_backfill_runs (id);

ALTER TABLE order_notification_jobs
  ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 8;

CREATE TABLE IF NOT EXISTS order_notification_job_recoveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES order_notification_jobs (id),
  admin_username TEXT NOT NULL,
  prior_status TEXT NOT NULL,
  prior_attempt_count INTEGER NOT NULL,
  prior_last_error TEXT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
