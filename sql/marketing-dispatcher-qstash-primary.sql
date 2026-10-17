-- Verified QStash primary dispatcher heartbeat (Milestone IV Stage 1).
-- Phase 1 marketing_dispatcher_heartbeats remains unchanged.

CREATE TABLE IF NOT EXISTS marketing_dispatcher_qstash_primary (
  id TEXT PRIMARY KEY DEFAULT 'primary',
  last_seen_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS marketing_dispatcher_qstash_verified_deliveries (
  jti TEXT PRIMARY KEY,
  seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  untrusted_message_id TEXT
);

CREATE INDEX IF NOT EXISTS marketing_dispatcher_qstash_verified_deliveries_seen_at_idx
  ON marketing_dispatcher_qstash_verified_deliveries (seen_at);
