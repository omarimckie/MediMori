-- Minimal read-only schema for central-agent-status/v1 on an isolated Neon staging branch.
-- Apply manually on staging only; never at app startup. Do not apply to production without owner approval.
--
-- Order:
--   1. This file (core tables)
--   2. Optional: seed empty state or copy sanitized task rows for integration tests

CREATE TABLE IF NOT EXISTS engineering_tasks (
  id uuid PRIMARY KEY,
  request text NOT NULL,
  status text NOT NULL DEFAULT 'intake' CHECK (
    status IN (
      'intake', 'analyzing', 'planned', 'awaiting_approval', 'implementing',
      'validating', 'repairing', 'reviewing', 'awaiting_merge', 'merging',
      'completed', 'blocked', 'cancelled', 'escalated'
    )
  ),
  risk text CHECK (risk IN ('low', 'medium', 'high')),
  plan jsonb,
  version integer NOT NULL DEFAULT 0,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS engineering_runs (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES engineering_tasks (id),
  plan_version integer NOT NULL,
  worker_enabled boolean NOT NULL DEFAULT false,
  attempt_number integer,
  disposition text,
  repairs integer NOT NULL DEFAULT 0,
  model_calls integer NOT NULL DEFAULT 0,
  tokens integer NOT NULL DEFAULT 0,
  cost_usd numeric(12, 6) NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  lease_until timestamptz
);

CREATE INDEX IF NOT EXISTS engineering_tasks_recent ON engineering_tasks (created_at DESC);
CREATE INDEX IF NOT EXISTS engineering_runs_task ON engineering_runs (task_id, started_at);

-- Latest merge approval status only (read model for awaiting_merge pending approvals).
CREATE TABLE IF NOT EXISTS engineering_merge_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES engineering_tasks (id),
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS engineering_merge_approval_task ON engineering_merge_approvals (task_id, created_at DESC);
