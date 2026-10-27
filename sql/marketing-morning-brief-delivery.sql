-- Morning Brief daily delivery idempotency (one broadcast claim per local calendar day).

CREATE TABLE IF NOT EXISTS marketing_morning_brief_delivery_claims (
  dedupe_key TEXT PRIMARY KEY,
  timezone TEXT NOT NULL,
  local_date TEXT NOT NULL,
  status TEXT NOT NULL,
  notification_id UUID REFERENCES marketing_admin_notifications (id) ON DELETE SET NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT marketing_morning_brief_delivery_claims_status_check
    CHECK (status IN ('claimed', 'delivered', 'failed', 'ambiguous'))
);

CREATE INDEX IF NOT EXISTS marketing_morning_brief_delivery_claims_local_date_idx
  ON marketing_morning_brief_delivery_claims (timezone, local_date DESC);
