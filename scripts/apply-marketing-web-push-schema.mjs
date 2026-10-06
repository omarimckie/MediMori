import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { neon } from "@neondatabase/serverless";

const MIGRATION_SQL_PATH = new URL("../sql/marketing-web-push.sql", import.meta.url);

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

/**
 * Parse marketing-web-push.sql into ordered executable statements.
 * @param {string} migrationSql
 * @returns {string[]}
 */
export function parseMarketingWebPushMigrationStatements(migrationSql) {
  const statements = stripSqlLineComments(migrationSql)
    .split(/;\s*\n/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (statements.length !== 5) {
    throw new Error(
      `Expected 5 marketing Web Push migration statements, got ${statements.length}.`,
    );
  }

  const expectedPrefixes = [
    "CREATE TABLE IF NOT EXISTS marketing_push_subscriptions",
    "CREATE INDEX IF NOT EXISTS marketing_push_subscriptions_admin_idx",
    "CREATE TABLE IF NOT EXISTS marketing_admin_notifications",
    "CREATE INDEX IF NOT EXISTS marketing_admin_notifications_created_idx",
    "CREATE INDEX IF NOT EXISTS marketing_admin_notifications_unread_idx",
  ];

  for (let i = 0; i < expectedPrefixes.length; i += 1) {
    const normalized = statements[i].replace(/\s+/g, " ");
    if (!normalized.startsWith(expectedPrefixes[i])) {
      throw new Error(
        `Statement ${i + 1} must start with "${expectedPrefixes[i]}".`,
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
  const statements = parseMarketingWebPushMigrationStatements(file);

  for (const statement of statements) {
    await sql.query(statement);
    const preview = statement.replace(/\s+/g, " ").slice(0, 88);
    console.log(`Applied: ${preview}...`);
  }

  console.log("Applied marketing Web Push schema.");
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
