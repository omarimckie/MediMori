-- Marketing dispatcher watchdog (Reliability Milestone IV P0): state, observations, incident notifications, maintenance.

CREATE TABLE IF NOT EXISTS marketing_dispatcher_watchdog_state (
  id TEXT PRIMARY KEY DEFAULT 'primary',
  primary_qstash_activated_at TIMESTAMPTZ,
  consecutive_stale_observations INTEGER NOT NULL DEFAULT 0,
  last_primary_last_seen_at TIMESTAMPTZ,
  last_committed_observation_slot_id BIGINT NOT NULL DEFAULT -1,
  last_observation_was_stale BOOLEAN NOT NULL DEFAULT false,
  active_incident_id UUID REFERENCES marketing_incidents (id) ON DELETE SET NULL,
  deferred_outage_push BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT marketing_dispatcher_watchdog_consecutive_check
    CHECK (consecutive_stale_observations >= 0)
);

CREATE TABLE IF NOT EXISTS marketing_dispatcher_watchdog_observations (
  observation_slot_id BIGINT PRIMARY KEY,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  github_run_id TEXT,
  github_run_attempt TEXT,
  primary_last_seen_at TIMESTAMPTZ,
  stale BOOLEAN NOT NULL,
  activation_pending BOOLEAN NOT NULL DEFAULT false,
  outcome TEXT NOT NULL,
  CONSTRAINT marketing_dispatcher_watchdog_observations_outcome_check
    CHECK (outcome IN (
      'committed',
      'duplicate_slot',
      'ignored_late_slot',
      'ignored_not_activated'
    ))
);

CREATE TABLE IF NOT EXISTS marketing_dispatcher_watchdog_incident_notifications (
  incident_id UUID PRIMARY KEY
    REFERENCES marketing_incidents (id) ON DELETE CASCADE,
  outage_push_claim_status TEXT NOT NULL DEFAULT 'none',
  recovery_push_claim_status TEXT NOT NULL DEFAULT 'none',
  outage_push_sent_at TIMESTAMPTZ,
  outage_push_claim_nonce UUID,
  outage_push_attempt_started_at TIMESTAMPTZ,
  outage_push_admin_notification_id UUID,
  recovery_push_claim_nonce UUID,
  recovery_push_attempt_started_at TIMESTAMPTZ,
  recovery_push_admin_notification_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT marketing_dispatcher_watchdog_outage_claim_check
    CHECK (outage_push_claim_status IN (
      'none', 'claimed', 'delivered', 'ambiguous', 'failed'
    )),
  CONSTRAINT marketing_dispatcher_watchdog_recovery_claim_check
    CHECK (recovery_push_claim_status IN (
      'none', 'claimed', 'delivered', 'ambiguous', 'failed'
    ))
);

CREATE TABLE IF NOT EXISTS marketing_dispatcher_maintenance_windows (
  id UUID PRIMARY KEY,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT marketing_dispatcher_maintenance_window_range_check
    CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS marketing_dispatcher_maintenance_ends_at_idx
  ON marketing_dispatcher_maintenance_windows (ends_at);

CREATE INDEX IF NOT EXISTS marketing_dispatcher_maintenance_starts_at_idx
  ON marketing_dispatcher_maintenance_windows (starts_at);

ALTER TABLE marketing_dispatcher_watchdog_incident_notifications
  ADD COLUMN IF NOT EXISTS outage_push_claim_nonce UUID,
  ADD COLUMN IF NOT EXISTS outage_push_attempt_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS outage_push_admin_notification_id UUID,
  ADD COLUMN IF NOT EXISTS recovery_push_claim_nonce UUID,
  ADD COLUMN IF NOT EXISTS recovery_push_attempt_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recovery_push_admin_notification_id UUID;
