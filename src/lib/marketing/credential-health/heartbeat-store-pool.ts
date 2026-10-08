import { Pool, type PoolClient } from "@neondatabase/serverless";

let marketingPool: Pool | null = null;

export function getMarketingPool(): Pool {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured.");
  }
  if (!marketingPool) {
    marketingPool = new Pool({ connectionString });
  }
  return marketingPool;
}

export async function withMarketingPoolTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getMarketingPool().connect();
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
}

/** Per-row transactional lock for dispatcher heartbeat sources (cross-instance safe). */
export async function withCredentialHealthSourceLock<T>(
  source: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return withMarketingPoolTransaction(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1::text))`, [source]);
    return fn(client);
  });
}
