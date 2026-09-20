import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL?.trim()) {
    return process.env.DATABASE_URL.trim();
  }
  try {
    const env = readFileSync(".env.local", "utf8");
    const match = env.match(/^DATABASE_URL=(.*)$/m);
    if (!match) return "";
    return match[1].trim().replace(/^["']|["']$/g, "");
  } catch {
    return "";
  }
}

const url = loadDatabaseUrl();
if (!url) {
  console.error("DATABASE_URL is not set. Add it to the environment or .env.local.");
  process.exit(1);
}

const sql = neon(url);

await sql`ALTER TABLE marketing_clicks DROP CONSTRAINT IF EXISTS marketing_clicks_token_key`;
await sql`DROP INDEX IF EXISTS marketing_clicks_token_key`;
await sql`
  CREATE INDEX IF NOT EXISTS marketing_clicks_token_clicked_idx
    ON marketing_clicks (token, clicked_at DESC)
`;

await sql`
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
  )
`;

await sql`
  CREATE UNIQUE INDEX IF NOT EXISTS marketing_metrics_content_date_source_uidx
    ON marketing_metrics (content_id, metric_date, source)
    WHERE content_id IS NOT NULL
`;

console.log("Applied Marketing Autopilot optimization pass 1 schema.");
