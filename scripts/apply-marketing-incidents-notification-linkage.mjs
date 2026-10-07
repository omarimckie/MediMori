import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { neon } from "@neondatabase/serverless";
import { stripSqlLineComments } from "./apply-marketing-web-push-schema.mjs";

const MIGRATION_SQL_PATH = new URL(
  "../sql/marketing-incidents-notification-linkage.sql",
  import.meta.url,
);

/**
 * @param {string} migrationSql
 * @returns {string[]}
 */
export function parseMarketingIncidentsNotificationLinkageStatements(migrationSql) {
  const statements = stripSqlLineComments(migrationSql)
    .split(/;\s*\n/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (statements.length !== 2) {
    throw new Error(
      `Expected 2 notification linkage migration statements, got ${statements.length}.`,
    );
  }

  const expectedPrefixes = [
    "ALTER TABLE marketing_admin_notifications",
    "CREATE INDEX IF NOT EXISTS marketing_admin_notifications_related_incident_idx",
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

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error("DATABASE_URL is required.");
  }
  const sql = neon(url);
  const file = readFileSync(MIGRATION_SQL_PATH, "utf8");
  const statements = parseMarketingIncidentsNotificationLinkageStatements(file);
  for (const statement of statements) {
    await sql.query(statement);
  }
  console.log("Applied marketing incidents notification linkage migration.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
