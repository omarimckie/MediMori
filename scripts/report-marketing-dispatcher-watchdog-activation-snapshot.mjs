/**
 * Read-only dispatcher watchdog / QStash primary activation readiness snapshot.
 * Run: npx tsx scripts/report-marketing-dispatcher-watchdog-activation-snapshot.mjs
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";
import { buildActivationReadinessSnapshot } from "./marketing-dispatcher-watchdog-activation-evidence.mjs";
import {
  dispatcherWatchdogActivationError,
  isDispatcherWatchdogActivationSnapshotReport,
  resolveDispatcherWatchdogActivationDatabaseTarget,
} from "./resolve-marketing-dispatcher-watchdog-activation-database-url.mjs";

/**
 * @param {Record<string, string | undefined>} env
 */
export async function reportDispatcherWatchdogActivationSnapshot(env = process.env) {
  if (!isDispatcherWatchdogActivationSnapshotReport(env)) {
    throw dispatcherWatchdogActivationError("dispatcher_watchdog_activation_snapshot_not_requested");
  }

  const target = resolveDispatcherWatchdogActivationDatabaseTarget(env);
  const pool = new pg.Pool({ connectionString: target.connectionString, max: 1 });
  const client = await pool.connect();
  try {
    return await buildActivationReadinessSnapshot(client, {
      targetHost: target.hostname,
      targetDatabase: target.databaseName,
    });
  } finally {
    client.release();
    await pool.end();
  }
}

async function main() {
  const snapshot = await reportDispatcherWatchdogActivationSnapshot(process.env);
  console.log(JSON.stringify(snapshot));
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === fileURLToPath(pathToFileURL(process.argv[1]));

if (isMain) {
  main().catch((error) => {
    const code =
      error && typeof error === "object" && "code" in error && typeof error.code === "string"
        ? error.code
        : "dispatcher_watchdog_activation_snapshot_failed";
    console.error(code);
    process.exit(1);
  });
}
