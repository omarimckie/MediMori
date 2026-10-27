import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { neon } from "@neondatabase/serverless";
import { stripSqlLineComments } from "./apply-marketing-web-push-schema.mjs";

const MIGRATION_SQL_PATH = new URL(
  "../sql/marketing-publication-ambiguity.sql",
  import.meta.url,
);

/**
 * @param {string} migrationSql
 * @returns {string[]}
 */
export function parseMarketingPublicationAmbiguityMigrationStatements(migrationSql) {
  const stripped = stripSqlLineComments(migrationSql).trim();
  const doStart = stripped.indexOf("DO $$");
  if (doStart < 0) {
    throw new Error("Expected DO $$ block in publication ambiguity migration.");
  }
  const doEndMarker = "END $$;";
  const doEnd = stripped.indexOf(doEndMarker, doStart);
  if (doEnd < 0) {
    throw new Error("Expected END $$; in publication ambiguity migration.");
  }
  const alterStatement = stripped.slice(0, doStart).trim().replace(/;\s*$/, "");
  const doStatement = stripped
    .slice(doStart, doEnd + doEndMarker.length)
    .trim()
    .replace(/;\s*$/, "");
  const indexStatement = stripped
    .slice(doEnd + doEndMarker.length)
    .trim()
    .replace(/^;\s*/, "")
    .replace(/;\s*$/, "");

  const statements = [alterStatement, doStatement, indexStatement].filter(
    (part) => part.length > 0,
  );

  if (statements.length !== 3) {
    throw new Error(
      `Expected 3 publication ambiguity migration statements, got ${statements.length}.`,
    );
  }

  const expectedPrefixes = [
    "ALTER TABLE marketing_publications",
    "DO $$",
    "CREATE INDEX IF NOT EXISTS marketing_publications_ambiguity_state_idx",
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
  const statements = parseMarketingPublicationAmbiguityMigrationStatements(file);

  for (const statement of statements) {
    await sql.query(statement);
    const preview = statement.replace(/\s+/g, " ").slice(0, 88);
    console.log(`Applied: ${preview}...`);
  }

  console.log("Applied marketing publication ambiguity schema.");
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
