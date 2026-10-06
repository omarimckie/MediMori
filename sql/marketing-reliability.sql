-- Marketing publication reliability (Phase 1): dispatcher heartbeats + notification dedupe.

CREATE TABLE IF NOT EXISTS marketing_dispatcher_heartbeats (
  source TEXT PRIMARY KEY,
  last_seen_at TIMESTAMPTZ NOT NULL,
  last_published_count INTEGER,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS marketing_reliability_dedup (
  dedupe_key TEXT PRIMARY KEY,
  notification_id UUID REFERENCES marketing_admin_notifications (id) ON DELETE SET NULL,
  publication_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketing_reliability_dedup_publication_idx
  ON marketing_reliability_dedup (publication_id);
