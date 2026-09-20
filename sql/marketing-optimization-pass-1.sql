-- Marketing Autopilot — Optimization Pass 1
-- Additive migration for existing Neon/Postgres databases.
-- Do not apply by hand; use scripts/apply-marketing-optimization-pass-1.mjs

-- 1. Click events: a token identifies the link, not a single click row.
ALTER TABLE marketing_clicks DROP CONSTRAINT IF EXISTS marketing_clicks_token_key;
DROP INDEX IF EXISTS marketing_clicks_token_key;

CREATE INDEX IF NOT EXISTS marketing_clicks_token_clicked_idx
  ON marketing_clicks (token, clicked_at DESC);

-- 2. Metrics: one snapshot row per content + day + source.
DELETE FROM marketing_metrics m
WHERE m.id IN (
  SELECT id FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY content_id, metric_date, source
        ORDER BY created_at DESC
      ) AS rn
    FROM marketing_metrics
    WHERE content_id IS NOT NULL
  ) ranked
  WHERE ranked.rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS marketing_metrics_content_date_source_uidx
  ON marketing_metrics (content_id, metric_date, source)
  WHERE content_id IS NOT NULL;
