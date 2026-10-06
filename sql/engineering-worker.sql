-- Additive storage contract for worker-tagged execution attempts.
-- This file defines no worker execution function and grants no table access.
-- Apply only after engineering-schema.sql on an isolated engineering database.
ALTER TABLE engineering_runs
  ADD COLUMN IF NOT EXISTS worker_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE engineering_runs
  ADD COLUMN IF NOT EXISTS attempt_number integer;

ALTER TABLE engineering_runs
  ADD COLUMN IF NOT EXISTS plan_snapshot jsonb;

ALTER TABLE engineering_runs
  ADD COLUMN IF NOT EXISTS disposition text;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='engineering_runs'::regclass AND conname='engineering_runs_attempt_number_positive'
  ) THEN
    ALTER TABLE engineering_runs ADD CONSTRAINT engineering_runs_attempt_number_positive
      CHECK (attempt_number IS NULL OR attempt_number > 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='engineering_runs'::regclass AND conname='engineering_runs_disposition_allowed'
  ) THEN
    ALTER TABLE engineering_runs ADD CONSTRAINT engineering_runs_disposition_allowed
      CHECK (disposition IS NULL OR disposition IN ('active','succeeded','blocked','cancelled','expired'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS engineering_run_attempt_number
  ON engineering_runs(task_id,attempt_number) WHERE attempt_number IS NOT NULL;
