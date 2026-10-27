import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { neon } from "@neondatabase/serverless";
import {
  parseMarketingWebPushMigrationStatements,
  stripSqlLineComments,
} from "./apply-marketing-web-push-schema.mjs";

const MIGRATION_SQL_PATH = new URL("../sql/marketing-reliability.sql", import.meta.url);

/**
 * @param {string} migrationSql
 * @returns {string[]}
 */
export function parseMarketingReliabilityMigrationStatements(migrationSql) {
  const statements = stripSqlLineComments(migrationSql)
    .split(/;\s*\n/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (statements.length !== 3) {
    throw new Error(
      `Expected 3 marketing reliability migration statements, got ${statements.length}.`,
    );
  }

  const expectedPrefixes = [
    "CREATE TABLE IF NOT EXISTS marketing_dispatcher_heartbeats",
    "CREATE TABLE IF NOT EXISTS marketing_reliability_dedup",
    "CREATE INDEX IF NOT EXISTS marketing_reliability_dedup_publication_idx",
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
  const statements = parseMarketingReliabilityMigrationStatements(file);

  for (const statement of statements) {
    await sql.query(statement);
    const preview = statement.replace(/\s+/g, " ").slice(0, 88);
    console.log(`Applied: ${preview}...`);
  }

  console.log("Applied marketing reliability schema.");
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
