import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Pool, PoolClient } from "@neondatabase/serverless";
import { STALE_THRESHOLD_MS } from "./constants";
import { computeObservationSlotId } from "./evaluate";
import type { WatchdogRepository } from "./repository";

export const INTEGRATION_BASE_TIME = new Date("2026-10-12T12:07:00.000Z");

export function atMinuteOffset(minutes: number): Date {
  return new Date(INTEGRATION_BASE_TIME.getTime() + minutes * 60_000);
}

export function staleLastSeen(now: Date, extraMs = 60_000): string {
  return new Date(now.getTime() - STALE_THRESHOLD_MS - extraMs).toISOString();
}

export function freshLastSeen(now: Date): string {
  return new Date(now.getTime() - 5 * 60_000).toISOString();
}

export type IntegrationFaultInjection = {
  failAfterSqlMatching: RegExp;
};

function wrapClientWithFault(
  client: PoolClient,
  fault: IntegrationFaultInjection,
): PoolClient {
  return {
    ...client,
    query: async (sql: string, params?: unknown[]) => {
      const result = await client.query(sql, params);
      if (fault.failAfterSqlMatching.test(String(sql))) {
        throw new Error("integration_fault_injection_after_query");
      }
      return result;
    },
  } as PoolClient;
}

export function createRunWatchdogTransaction(
  pool: Pool,
  fault?: IntegrationFaultInjection,
) {
  return async <T>(fn: (client: PoolClient) => Promise<T>): Promise<T> => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const activeClient = fault ? wrapClientWithFault(client, fault) : client;
      const result = await fn(activeClient);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };
}

export async function applyIncidentsSchema(pool: Pool): Promise<void> {
  const { parseMarketingIncidentsMigrationStatements } = await import(
    "../../../../../scripts/apply-marketing-incidents-schema.mjs"
  );
  const migrationSqlPath = fileURLToPath(
    new URL("../../../../../sql/marketing-incidents.sql", import.meta.url),
  );
  const file = readFileSync(migrationSqlPath, "utf8");
  const statements = parseMarketingIncidentsMigrationStatements(file);
  const client = await pool.connect();
  try {
    for (const statement of statements) {
      await client.query(statement);
    }
  } finally {
    client.release();
  }
}

export async function applyWatchdogSchema(pool: Pool): Promise<void> {
  const { parseMarketingDispatcherWatchdogMigrationStatements } = await import(
    "../../../../../scripts/apply-marketing-dispatcher-watchdog-schema.mjs"
  );
  const migrationSqlPath = fileURLToPath(
    new URL("../../../../../sql/marketing-dispatcher-watchdog.sql", import.meta.url),
  );
  const file = readFileSync(migrationSqlPath, "utf8");
  const statements = parseMarketingDispatcherWatchdogMigrationStatements(file);
  const client = await pool.connect();
  try {
    for (const statement of statements) {
      await client.query(statement);
    }
  } finally {
    client.release();
  }
}

export async function createIsolatedWatchdogRepository(
  pool: Pool,
  fault?: IntegrationFaultInjection,
): Promise<WatchdogRepository> {
  const { createPostgresWatchdogRepository } = await import("./repository");
  return createPostgresWatchdogRepository({
    runWatchdogTransaction: createRunWatchdogTransaction(pool, fault),
  });
}

export async function activateQstash(
  repo: WatchdogRepository,
  now: Date,
): Promise<void> {
  await repo.recordPrimaryQstashActivation(now, {
    verificationKind: "qstash_signature_verified",
    verifiedAt: now.toISOString(),
    attestationId: "integration-test",
  });
}

export async function countTable(pool: Pool, table: string): Promise<number> {
  const result = await pool.query(`SELECT COUNT(*)::int AS c FROM ${table}`);
  return Number((result.rows[0] as { c: number }).c);
}

export async function truncateWatchdogTables(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `TRUNCATE marketing_dispatcher_watchdog_incident_notifications,
        marketing_dispatcher_watchdog_observations,
        marketing_dispatcher_maintenance_windows,
        marketing_dispatcher_watchdog_state,
        marketing_incident_events,
        marketing_incidents
      RESTART IDENTITY CASCADE`,
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export { computeObservationSlotId };
