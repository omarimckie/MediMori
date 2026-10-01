-- One successful newsletter promotion redemption per normalized customer email.
-- Applied via scripts/apply-newsletter-promotion-redemptions-schema.mjs

CREATE TABLE IF NOT EXISTS newsletter_promotion_redemptions (
  email TEXT PRIMARY KEY,
  stripe_checkout_session_id TEXT NOT NULL UNIQUE,
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
