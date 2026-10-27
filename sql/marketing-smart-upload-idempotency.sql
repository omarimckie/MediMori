-- Smart Upload finalize-key idempotency (one Instagram + one Facebook row per key).
-- Apply with scripts/apply-marketing-smart-upload-idempotency.mjs
-- Do not apply until duplicate rows are resolved (see preflight query below).

-- Preflight: list duplicate (platform, finalizeKey) pairs before creating the index.
-- SELECT metadata->>'smartUploadFinalizeKey' AS finalize_key,
--        platform,
--        COUNT(*) AS row_count
-- FROM marketing_content
-- WHERE metadata->>'source' = 'smart_upload'
--   AND metadata->>'smartUploadFinalizeKey' IS NOT NULL
-- GROUP BY metadata->>'smartUploadFinalizeKey', platform
-- HAVING COUNT(*) > 1;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT metadata->>'smartUploadFinalizeKey' AS finalize_key, platform
      FROM marketing_content
      WHERE metadata->>'source' = 'smart_upload'
        AND metadata->>'smartUploadFinalizeKey' IS NOT NULL
      GROUP BY metadata->>'smartUploadFinalizeKey', platform
      HAVING COUNT(*) > 1
    ) duplicates
  ) THEN
    RAISE EXCEPTION
      'Duplicate smart_upload finalize keys exist per platform; resolve before creating index.';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS marketing_content_smart_upload_finalize_key_uq
  ON marketing_content (platform, (metadata->>'smartUploadFinalizeKey'))
  WHERE (metadata->>'source') = 'smart_upload'
    AND (metadata->>'smartUploadFinalizeKey') IS NOT NULL;
