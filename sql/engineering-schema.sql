-- Additive only. Apply manually to an isolated Neon branch first; never at app startup.
CREATE TABLE IF NOT EXISTS engineering_tasks (
  id uuid PRIMARY KEY,
  request text NOT NULL,
  status text NOT NULL DEFAULT 'intake' CHECK (status IN ('intake','analyzing','planned','awaiting_approval','implementing','blocked','cancelled','escalated')),
  risk text CHECK (risk IN ('low','medium','high')),
  plan jsonb,
  creation_key uuid,
  version integer NOT NULL DEFAULT 0,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE engineering_tasks ADD COLUMN IF NOT EXISTS creation_key uuid;
CREATE UNIQUE INDEX IF NOT EXISTS engineering_tasks_creation_key ON engineering_tasks(creation_key);
CREATE TABLE IF NOT EXISTS engineering_runs (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES engineering_tasks(id),
  plan_version integer NOT NULL,
  worker_enabled boolean NOT NULL DEFAULT false,
  repairs integer NOT NULL DEFAULT 0 CHECK (repairs BETWEEN 0 AND 3),
  model_calls integer NOT NULL DEFAULT 0 CHECK (model_calls BETWEEN 0 AND 12),
  tokens integer NOT NULL DEFAULT 0 CHECK (tokens BETWEEN 0 AND 60000),
  cost_usd numeric(12,6) NOT NULL DEFAULT 0 CHECK (cost_usd BETWEEN 0 AND 5),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS engineering_one_active_run ON engineering_runs(task_id) WHERE finished_at IS NULL;
CREATE TABLE IF NOT EXISTS engineering_approvals (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES engineering_tasks(id),
  plan_version integer NOT NULL,
  gate text NOT NULL CHECK (gate IN ('plan','merge_main','production_deploy','production_secrets','destructive_database','auth_security','external_publish','payments','production_infrastructure')),
  decision text NOT NULL CHECK (decision IN ('approved','rejected')),
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS engineering_validations (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES engineering_runs(id),
  command text NOT NULL CHECK (command IN ('test','lint','typecheck','build','security:check','test:engineering')),
  outcome text NOT NULL CHECK (outcome IN ('passed','failed')),
  revision text NOT NULL,
  summary text NOT NULL,
  cycle integer NOT NULL CHECK (cycle BETWEEN 0 AND 3),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS engineering_costs (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES engineering_runs(id),
  provider text NOT NULL,
  model text NOT NULL,
  operation text NOT NULL,
  tokens integer NOT NULL CHECK (tokens >= 0),
  estimated_cost_usd numeric(12,6) NOT NULL CHECK (estimated_cost_usd >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS engineering_events (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES engineering_tasks(id),
  actor text NOT NULL,
  action text NOT NULL,
  details jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS engineering_tasks_recent ON engineering_tasks(created_at DESC);
CREATE INDEX IF NOT EXISTS engineering_events_task ON engineering_events(task_id, created_at);
CREATE INDEX IF NOT EXISTS engineering_runs_task ON engineering_runs(task_id, started_at);
CREATE INDEX IF NOT EXISTS engineering_approvals_task ON engineering_approvals(task_id, created_at);
CREATE INDEX IF NOT EXISTS engineering_validations_run ON engineering_validations(run_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS engineering_validation_once ON engineering_validations(run_id, cycle, command);
CREATE INDEX IF NOT EXISTS engineering_costs_run ON engineering_costs(run_id, created_at);
