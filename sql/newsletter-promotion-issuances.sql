-- Customer-specific TWILIGHTFEATHER10 Stripe promotion code issued per subscriber email.
-- Redemption after paid checkout remains in newsletter_promotion_redemptions.
-- Applied via scripts/apply-newsletter-promotion-issuances-schema.mjs

CREATE TABLE IF NOT EXISTS newsletter_promotion_issuances (
  email TEXT PRIMARY KEY,
  stripe_customer_id TEXT NOT NULL,
  stripe_promotion_code_id TEXT NOT NULL UNIQUE,
  stripe_coupon_id TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  issuance_source TEXT NOT NULL CHECK (
    issuance_source IN ('signup', 'migration', 'checkout_backfill')
  ),
  last_error TEXT NULL,
  migration_run_id TEXT NULL
);

CREATE INDEX IF NOT EXISTS newsletter_promotion_issuances_stripe_customer_id_idx
  ON newsletter_promotion_issuances (stripe_customer_id);
