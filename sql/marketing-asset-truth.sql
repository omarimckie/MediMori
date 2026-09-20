-- Persist probed image dimensions for marketing catalog assets.
-- Safe on existing rows: new columns are nullable; no data is deleted.
-- Apply manually (e.g. npm run marketing:schema:asset-truth) — not run automatically in deploy.

ALTER TABLE marketing_assets
  ADD COLUMN IF NOT EXISTS image_width INTEGER,
  ADD COLUMN IF NOT EXISTS image_height INTEGER,
  ADD COLUMN IF NOT EXISTS mime_type TEXT;
