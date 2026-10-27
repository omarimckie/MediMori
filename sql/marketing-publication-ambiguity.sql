-- Phase 2A: ambiguous publication safety (claim token + provider evidence)
-- Idempotent; safe to re-run.

ALTER TABLE marketing_publications
  ADD COLUMN IF NOT EXISTS ambiguity_state TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS claim_token UUID,
  ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS provider_creation_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'marketing_publications_ambiguity_state_check'
  ) THEN
    ALTER TABLE marketing_publications
      ADD CONSTRAINT marketing_publications_ambiguity_state_check
      CHECK (ambiguity_state IN ('none', 'ambiguous', 'owner_required'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS marketing_publications_ambiguity_state_idx
  ON marketing_publications (ambiguity_state)
  WHERE ambiguity_state <> 'none';
