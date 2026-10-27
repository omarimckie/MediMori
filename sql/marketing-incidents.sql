-- Marketing incidents (Phase I foundation): canonical operational incidents + append-only events.

CREATE TABLE IF NOT EXISTS marketing_incidents (
  id UUID PRIMARY KEY,
  schema_version SMALLINT NOT NULL DEFAULT 1,
  incident_version INTEGER NOT NULL DEFAULT 1,
  incident_type TEXT NOT NULL,
  status TEXT NOT NULL,
  severity TEXT NOT NULL,
  source_system TEXT NOT NULL DEFAULT 'marketing_autopilot',
  source_operation TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL,
  content_id UUID,
  publication_id UUID,
  platform TEXT,
  provider TEXT,
  batch_id TEXT,
  finalize_key TEXT,
  dedupe_key TEXT NOT NULL UNIQUE,
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  error_class TEXT NOT NULL,
  sanitized_error TEXT NOT NULL,
  retry_safety TEXT NOT NULL,
  permitted_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  human_approval_required BOOLEAN NOT NULL DEFAULT false,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolution_type TEXT,
  resolution_summary TEXT,
  resolved_at TIMESTAMPTZ,
  agent_work_correlation_id UUID NOT NULL,
  agent_work_last_submitted_at TIMESTAMPTZ,
  agent_work_last_submit_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT marketing_incidents_status_check CHECK (
    status IN ('open', 'investigating', 'action_required', 'blocked', 'resolved')
  ),
  CONSTRAINT marketing_incidents_severity_check CHECK (
    severity IN ('info', 'warning', 'error')
  ),
  CONSTRAINT marketing_incidents_retry_safety_check CHECK (
    retry_safety IN (
      'safe_automatic',
      'safe_manual',
      'unsafe_duplicate_risk',
      'unknown_requires_verification',
      'not_applicable'
    )
  ),
  CONSTRAINT marketing_incidents_occurrence_count_check CHECK (occurrence_count >= 1),
  CONSTRAINT marketing_incidents_type_check CHECK (
    incident_type IN (
      'publication_failed',
      'partial_publication_failure',
      'publication_ambiguous',
      'publication_overdue',
      'publication_stuck_processing',
      'publication_recovery_required',
      'credential_warning',
      'dispatcher_warning',
      'smart_upload_caption_failed',
      'smart_upload_finalize_failed',
      'smart_upload_operational_failed'
    )
  ),
  CONSTRAINT marketing_incidents_resolution_type_check CHECK (
    resolution_type IS NULL OR resolution_type IN (
      'auto_recovered',
      'owner_resolved',
      'superseded',
      'false_positive'
    )
  )
);

CREATE INDEX IF NOT EXISTS marketing_incidents_unresolved_status_idx
  ON marketing_incidents (status)
  WHERE status <> 'resolved';

CREATE INDEX IF NOT EXISTS marketing_incidents_publication_id_idx
  ON marketing_incidents (publication_id)
  WHERE publication_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS marketing_incidents_content_id_idx
  ON marketing_incidents (content_id)
  WHERE content_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS marketing_incident_events (
  id UUID PRIMARY KEY,
  incident_id UUID NOT NULL REFERENCES marketing_incidents (id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'system',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT marketing_incident_events_type_check CHECK (
    event_type IN (
      'incident_created',
      'occurrence_recorded',
      'status_changed',
      'incident_resolved',
      'incident_reopened'
    )
  )
);

CREATE INDEX IF NOT EXISTS marketing_incident_events_incident_id_created_idx
  ON marketing_incident_events (incident_id, created_at);
