import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { neon } from "@neondatabase/serverless";
import { stripSqlLineComments } from "./apply-marketing-web-push-schema.mjs";

const MIGRATION_SQL_PATH = new URL(
  "../sql/marketing-morning-brief-delivery.sql",
  import.meta.url,
);

/**
 * @param {string} migrationSql
 * @returns {string[]}
 */
export function parseMarketingMorningBriefDeliveryMigrationStatements(migrationSql) {
  const statements = stripSqlLineComments(migrationSql)
    .split(/;\s*\n/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (statements.length !== 2) {
    throw new Error(
      `Expected 2 morning brief delivery migration statements, got ${statements.length}.`,
    );
  }

  return statements;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }
  const sqlText = readFileSync(MIGRATION_SQL_PATH, "utf8");
  const statements = parseMarketingMorningBriefDeliveryMigrationStatements(sqlText);
  const sql = neon(databaseUrl);
  for (const statement of statements) {
    await sql.query(statement);
  }
  console.log("Applied marketing morning brief delivery schema.");
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
