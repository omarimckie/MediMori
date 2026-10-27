import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { neon } from "@neondatabase/serverless";

const MIGRATION_SQL_PATH = new URL(
  "../sql/marketing-smart-upload-idempotency.sql",
  import.meta.url,
);

const PREFLIGHT_PATTERN = /DO \$\$[\s\S]*?END \$\$;/;
const CREATE_INDEX_PATTERN =
  /CREATE UNIQUE INDEX IF NOT EXISTS marketing_content_smart_upload_finalize_key_uq[\s\S]*?;/;

/**
 * Extract the two migration statements from the SQL file (no semicolon splitting).
 * @param {string} migrationSql
 * @returns {{ preflight: string, createIndex: string }}
 */
export function extractMarketingSmartUploadIdempotencyStatements(migrationSql) {
  const preflightMatch = migrationSql.match(PREFLIGHT_PATTERN);
  if (!preflightMatch) {
    throw new Error(
      "Could not extract DO $$ ... END $$; preflight block from marketing-smart-upload-idempotency.sql",
    );
  }

  const createIndexMatch = migrationSql.match(CREATE_INDEX_PATTERN);
  if (!createIndexMatch) {
    throw new Error(
      "Could not extract CREATE UNIQUE INDEX marketing_content_smart_upload_finalize_key_uq from marketing-smart-upload-idempotency.sql",
    );
  }

  return {
    preflight: preflightMatch[0].trim(),
    createIndex: createIndexMatch[0].trim(),
  };
}

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

async function main() {
  const url = loadDatabaseUrl();
  if (!url) {
    console.error("DATABASE_URL is not set. Add it to the environment or .env.local.");
    process.exit(1);
  }

  const sql = neon(url);
  const file = readFileSync(MIGRATION_SQL_PATH, "utf8");
  const { preflight, createIndex } =
    extractMarketingSmartUploadIdempotencyStatements(file);

  await sql.query(preflight);
  console.log("Applied: DO $$ preflight (duplicate smart_upload finalize keys)...");

  await sql.query(createIndex);
  console.log(
    "Applied: CREATE UNIQUE INDEX marketing_content_smart_upload_finalize_key_uq...",
  );

  console.log("Applied marketing smart upload idempotency migration.");
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === fileURLToPath(pathToFileURL(process.argv[1]));

if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
