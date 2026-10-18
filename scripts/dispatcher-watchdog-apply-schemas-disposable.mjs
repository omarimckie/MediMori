import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseMarketingIncidentsMigrationStatements } from "./apply-marketing-incidents-schema.mjs";
import { parseMarketingDispatcherWatchdogMigrationStatements } from "./apply-marketing-dispatcher-watchdog-schema.mjs";
import { parseMarketingDispatcherQstashPrimaryMigrationStatements } from "./apply-marketing-dispatcher-qstash-primary-schema.mjs";
import {
  createDisposableWatchdogPgPool,
  formatDisposablePostgresConnectionError,
} from "./dispatcher-watchdog-disposable-postgres-pool.mjs";
import { resolveMarketingDispatcherWatchdogTestDatabaseUrl } from "./resolve-marketing-dispatcher-watchdog-test-database-url.mjs";

const incidentsSqlPath = fileURLToPath(
  new URL("../sql/marketing-incidents.sql", import.meta.url),
);
const watchdogSqlPath = fileURLToPath(
  new URL("../sql/marketing-dispatcher-watchdog.sql", import.meta.url),
);
const qstashPrimarySqlPath = fileURLToPath(
  new URL("../sql/marketing-dispatcher-qstash-primary.sql", import.meta.url),
);

export async function applyDisposableWatchdogSchemas(connectionString) {
  const pool = createDisposableWatchdogPgPool(connectionString);
  const client = await pool.connect();
  try {
    const incidents = parseMarketingIncidentsMigrationStatements(
      readFileSync(incidentsSqlPath, "utf8"),
    );
    const watchdog = parseMarketingDispatcherWatchdogMigrationStatements(
      readFileSync(watchdogSqlPath, "utf8"),
    );
    const qstashPrimary = parseMarketingDispatcherQstashPrimaryMigrationStatements(
      readFileSync(qstashPrimarySqlPath, "utf8"),
    );
    await client.query("BEGIN");
    for (const statement of [...incidents, ...watchdog, ...qstashPrimary]) {
      await client.query(statement);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function main() {
  const connectionString = resolveMarketingDispatcherWatchdogTestDatabaseUrl();
  await applyDisposableWatchdogSchemas(connectionString);
  console.log("Applied disposable incidents + watchdog + qstash primary schemas.");
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === fileURLToPath(pathToFileURL(process.argv[1]));

if (isMain) {
  main().catch((error) => {
    console.error(formatDisposablePostgresConnectionError(error));
    process.exit(1);
  });
}
