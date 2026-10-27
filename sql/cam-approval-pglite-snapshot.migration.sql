-- Minimal approval persistence snapshot (disposable PGlite / local Postgres; not full Neon PL/pgSQL package).
CREATE TABLE IF NOT EXISTS central_agent_manager.approval_persistence_snapshot (
  id text PRIMARY KEY,
  snapshot_json text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
