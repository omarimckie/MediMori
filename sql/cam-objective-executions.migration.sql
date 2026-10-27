-- CAM objective persistence (apply only on owner-approved disposable Postgres; NOT Neon production).
CREATE TABLE IF NOT EXISTS central_agent_manager.objective_executions (
  objective_id text PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  record_fence bigint NOT NULL,
  document_json text NOT NULL,
  checksum text NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS central_agent_manager.objective_outbox (
  id text PRIMARY KEY,
  objective_id text NOT NULL,
  kind text NOT NULL,
  payload_json jsonb NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL
);
