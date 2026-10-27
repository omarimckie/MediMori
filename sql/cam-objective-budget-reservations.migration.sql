-- CAM objective budget caps and reservations (disposable Postgres only).
CREATE TABLE IF NOT EXISTS central_agent_manager.objective_budget_caps (
  objective_id text PRIMARY KEY,
  authorized_usd numeric(12, 4) NOT NULL,
  reserved_usd numeric(12, 4) NOT NULL DEFAULT 0,
  consumed_usd numeric(12, 4) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS central_agent_manager.objective_budget_reservations (
  reservation_id text PRIMARY KEY,
  objective_id text NOT NULL,
  amount_usd numeric(12, 4) NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
