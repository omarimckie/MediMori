import pg from "pg";
import { ACTIVATION_MAX_PRIMARY_HEARTBEAT_AGE_MS } from "./marketing-dispatcher-watchdog-activation-evidence.mjs";
import { loadVerifiedPrimaryActivationEvidence } from "./marketing-dispatcher-watchdog-activation-evidence.mjs";
import {
  assertDispatcherWatchdogActivationAuthorized,
  dispatcherWatchdogActivationError,
  DISPATCHER_WATCHDOG_ACTIVATION_ENV,
  isDispatcherWatchdogActivationDryRunReport,
  readDispatcherWatchdogActivationDryRunPresence,
  resolveDispatcherWatchdogActivationDatabaseTarget,
} from "./resolve-marketing-dispatcher-watchdog-activation-database-url.mjs";

/**
 * @param {Record<string, string | undefined>} env
 */
export function buildDispatcherWatchdogActivationDryRunReport(env = process.env) {
  const dryRun = env[DISPATCHER_WATCHDOG_ACTIVATION_ENV.DRY_RUN]?.trim();
  if (dryRun && dryRun !== "report") {
    throw dispatcherWatchdogActivationError("dispatcher_watchdog_activation_dry_run_invalid");
  }

  const presence = readDispatcherWatchdogActivationDryRunPresence(env);

  return {
    mode: "dry_run",
    operation: "dispatcher_watchdog_qstash_primary_activation",
    maxPrimaryHeartbeatAgeMs: ACTIVATION_MAX_PRIMARY_HEARTBEAT_AGE_MS,
    requiredExecuteVariables: [
      DISPATCHER_WATCHDOG_ACTIVATION_ENV.APPLY_AUTHORIZED,
      DISPATCHER_WATCHDOG_ACTIVATION_ENV.DATABASE_URL,
      DISPATCHER_WATCHDOG_ACTIVATION_ENV.EXPECTED_HOST,
      DISPATCHER_WATCHDOG_ACTIVATION_ENV.EXPECTED_DATABASE,
    ],
    optionalDryRunVariable: DISPATCHER_WATCHDOG_ACTIVATION_ENV.DRY_RUN,
    configuration: presence,
    databaseConnection: false,
    sqlExecuted: false,
  };
}

/**
 * @param {Record<string, string | undefined>} env
 */
export async function executeDispatcherWatchdogActivation(env = process.env) {
  if (isDispatcherWatchdogActivationDryRunReport(env)) {
    return { dryRun: buildDispatcherWatchdogActivationDryRunReport(env) };
  }

  assertDispatcherWatchdogActivationAuthorized(env);
  const target = resolveDispatcherWatchdogActivationDatabaseTarget(env);

  const pool = new pg.Pool({ connectionString: target.connectionString, max: 1 });
  const client = await pool.connect();
  let evidence;
  try {
    evidence = await loadVerifiedPrimaryActivationEvidence(client);
  } finally {
    client.release();
    await pool.end();
  }

  const { recordPrimaryQstashActivationViaRepository } = await import(
    "./run-dispatcher-watchdog-activation-core.ts"
  );

  const state = await recordPrimaryQstashActivationViaRepository(
    target.connectionString,
    {
      verificationKind: evidence.verificationKind,
      verifiedAt: evidence.verifiedAt,
      attestationId: evidence.attestationId,
    },
    new Date(),
  );

  return {
    ok: true,
    state,
    evidence,
    targetHost: target.hostname,
    targetDatabase: target.databaseName,
  };
}
