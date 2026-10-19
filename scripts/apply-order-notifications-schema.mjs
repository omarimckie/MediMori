import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { neon } from "@neondatabase/serverless";

const MIGRATION_SQL_PATH = new URL("../sql/order-notifications.sql", import.meta.url);

/**
 * Strip `--` line comments so header comments are not merged with the first statement.
 * @param {string} sql
 */
export function stripSqlLineComments(sql) {
  return sql
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("--");
      if (idx === -1) return line;
      return line.slice(0, idx);
    })
    .join("\n");
}

const EXPECTED_PREFIXES = [
  "ALTER TABLE physical_orders ADD COLUMN IF NOT EXISTS payment_status",
  "ALTER TABLE physical_orders ADD COLUMN IF NOT EXISTS inventory_state",
  "ALTER TABLE physical_orders ADD COLUMN IF NOT EXISTS shipping_address_missing",
  "ALTER TABLE physical_orders ADD COLUMN IF NOT EXISTS attention_flags",
  "CREATE TABLE IF NOT EXISTS digital_purchase_items",
  "CREATE TABLE IF NOT EXISTS order_notification_jobs",
  "CREATE INDEX IF NOT EXISTS order_notification_jobs_retry_idx",
  "CREATE TABLE IF NOT EXISTS order_attention",
  "CREATE INDEX IF NOT EXISTS order_attention_unacknowledged_idx",
  "ALTER TABLE order_notification_jobs ADD COLUMN IF NOT EXISTS claim_token",
  "CREATE TABLE IF NOT EXISTS order_notification_backfill_runs",
  "ALTER TABLE order_notification_jobs ADD COLUMN IF NOT EXISTS backfill_run_id",
  "ALTER TABLE order_notification_jobs ADD COLUMN IF NOT EXISTS max_attempts",
  "CREATE TABLE IF NOT EXISTS order_notification_job_recoveries",
];

/**
 * Parse order-notifications.sql into ordered executable statements.
 * @param {string} migrationSql
 * @returns {string[]}
 */
export function parseOrderNotificationMigrationStatements(migrationSql) {
  const statements = stripSqlLineComments(migrationSql)
    .split(/;\s*\n/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (statements.length !== EXPECTED_PREFIXES.length) {
    throw new Error(
      `Expected ${EXPECTED_PREFIXES.length} order-notification migration statements, got ${statements.length}.`,
    );
  }

  for (let i = 0; i < EXPECTED_PREFIXES.length; i += 1) {
    const normalized = statements[i].replace(/\s+/g, " ");
    if (!normalized.startsWith(EXPECTED_PREFIXES[i])) {
      throw new Error(
        `Statement ${i + 1} must start with "${EXPECTED_PREFIXES[i]}".`,
      );
    }
  }

  return statements;
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
  const statements = parseOrderNotificationMigrationStatements(file);
  for (const statement of statements) {
    await sql.query(statement);
    const preview = statement.replace(/\s+/g, " ").slice(0, 88);
    console.log(`Applied: ${preview}...`);
  }
  console.log("Applied order-notification schema.");
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
