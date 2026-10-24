import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Pool, PoolClient } from "@neondatabase/serverless";
import type { CredentialHealthSourceLockRunner } from "./persistence";

/** Bounded lock wait for disposable integration concurrency cases. */
export const DISPOSABLE_PG_ADVISORY_LOCK_TIMEOUT_MS = 500;

export async function applyQstashPrimarySchema(pool: Pool): Promise<void> {
  const { parseMarketingDispatcherQstashPrimaryMigrationStatements } = await import(
    "../../../../../scripts/apply-marketing-dispatcher-qstash-primary-schema.mjs"
  );
  const migrationSqlPath = fileURLToPath(
    new URL("../../../../../sql/marketing-dispatcher-qstash-primary.sql", import.meta.url),
  );
  const file = readFileSync(migrationSqlPath, "utf8");
  const statements = parseMarketingDispatcherQstashPrimaryMigrationStatements(file);
  const client = await pool.connect();
  try {
    for (const statement of statements) {
      await client.query(statement);
    }
  } finally {
    client.release();
  }
}

export async function truncateQstashPrimaryTables(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `TRUNCATE marketing_dispatcher_qstash_verified_deliveries,
        marketing_dispatcher_qstash_primary
      RESTART IDENTITY`,
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function createQstashPrimaryTransaction(pool: Pool) {
  return async <T>(fn: (client: PoolClient) => Promise<T>): Promise<T> => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
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

export async function countQstashTable(pool: Pool, table: string): Promise<number> {
  const result = await pool.query(`SELECT COUNT(*)::int AS c FROM ${table}`);
  return Number((result.rows[0] as { c: number }).c);
}

/**
 * Disposable-only lock runner mirroring production `withCredentialHealthSourceLock`
 * without `getMarketingPool()` or `DATABASE_URL`.
 */
export function createDisposableCredentialHealthSourceLockRunner(
  pool: Pool,
): CredentialHealthSourceLockRunner {
  return async <T>(source: string, fn: (client: PoolClient) => Promise<T>): Promise<T> => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1::text))`, [source]);
      const result = await fn(client);
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
