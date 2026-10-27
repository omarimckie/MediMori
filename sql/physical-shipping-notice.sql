-- Customer shipping-confirmation state for paperback orders.
-- carrier and tracking_number already exist on physical_orders.
-- Apply only after owner approval. Do not run automatically.

ALTER TABLE physical_orders
  ADD COLUMN IF NOT EXISTS shipping_notice_status TEXT NULL,
  ADD COLUMN IF NOT EXISTS shipping_notice_sent_fingerprint TEXT NULL,
  ADD COLUMN IF NOT EXISTS shipping_notice_error TEXT NULL,
  ADD COLUMN IF NOT EXISTS shipping_notice_sent_at TIMESTAMPTZ NULL;

DO $$
BEGIN
  ALTER TABLE physical_orders
    ADD CONSTRAINT physical_orders_shipping_notice_status_chk
    CHECK (
      shipping_notice_status IS NULL
      OR shipping_notice_status IN ('pending', 'sending', 'sent', 'failed')
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
