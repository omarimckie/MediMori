-- Central Agent Manager orchestration queue (NOT APPLIED — owner-operated migration only)
-- Stores versioned JSON payloads matching orchestration/contracts-v1.ts

CREATE SCHEMA IF NOT EXISTS central_agent_manager;

CREATE TABLE IF NOT EXISTS central_agent_manager.orchestration_jobs (
  id TEXT PRIMARY KEY,
  payload_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS central_agent_manager.orchestration_assignments (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES central_agent_manager.orchestration_jobs (id) ON DELETE CASCADE,
  payload_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS central_agent_manager.orchestration_agents (
  id TEXT PRIMARY KEY,
  payload_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS orchestration_assignments_job_id_idx
  ON central_agent_manager.orchestration_assignments (job_id);

CREATE INDEX IF NOT EXISTS orchestration_jobs_updated_at_idx
  ON central_agent_manager.orchestration_jobs (updated_at);

CREATE TABLE IF NOT EXISTS central_agent_manager.orchestration_quarantine (
  id TEXT PRIMARY KEY,
  source_table TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  reason TEXT NOT NULL,
  quarantined_at TIMESTAMPTZ NOT NULL
);
