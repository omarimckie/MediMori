import pg from "pg";
import type { PoolClient } from "pg";
import { createPostgresWatchdogRepository } from "../src/lib/marketing/reliability/dispatcher-watchdog/repository";
import type {
  WatchdogPrimaryActivationEvidence,
  WatchdogState,
} from "../src/lib/marketing/reliability/dispatcher-watchdog/types";

function createRunWatchdogTransaction(pool: pg.Pool) {
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

export async function recordPrimaryQstashActivationViaRepository(
  connectionString: string,
  evidence: WatchdogPrimaryActivationEvidence,
  now: Date = new Date(),
): Promise<WatchdogState> {
  const pool = new pg.Pool({ connectionString, max: 1 });
  try {
    const repo = createPostgresWatchdogRepository({
      runWatchdogTransaction: createRunWatchdogTransaction(pool),
    });
    return await repo.recordPrimaryQstashActivation(now, evidence);
  } finally {
    await pool.end();
  }
}
