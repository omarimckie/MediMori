-- Additive: marketing_content.metadata for manual uploads and free resources.
-- Apply with scripts/apply-marketing-content-metadata.mjs

ALTER TABLE marketing_content
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS marketing_content_metadata_slug_idx
  ON marketing_content ((metadata->>'slug'))
  WHERE metadata->>'slug' IS NOT NULL;
