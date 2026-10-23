import { Pool, type PoolClient } from "@neondatabase/serverless";
import {
  connectPreviewAwarePoolClient,
  guardPoolForProtectedPreview,
  previewDatabaseGuardDecision,
  PreviewDatabaseGuardError,
} from "@/lib/marketing/preview-db-guard";

let marketingPool: Pool | null = null;
let marketingPoolFactory: ((connectionString: string) => Pool) | null = null;

function getRawMarketingPool(): Pool {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured.");
  }
  if (!marketingPool) {
    marketingPool = marketingPoolFactory
      ? marketingPoolFactory(connectionString)
      : new Pool({ connectionString });
  }
  return marketingPool;
}

/** Test hook. Production constructs the Neon pool from DATABASE_URL. */
export function setMarketingPoolFactoryForTests(
  factory: ((connectionString: string) => Pool) | null,
): void {
  marketingPoolFactory = factory;
  marketingPool = null;
}

/** Test hook. Drops the cached marketing pool. */
export function resetMarketingPoolForTests(): void {
  marketingPool = null;
  marketingPoolFactory = null;
}

export function getMarketingPool(): Pool {
  const decision = previewDatabaseGuardDecision(process.env);
  if (decision === "reject") {
    throw new PreviewDatabaseGuardError("ambiguous-scope");
  }
  const raw = getRawMarketingPool();
  if (decision === "skip") return raw;
  return guardPoolForProtectedPreview(raw);
}

export async function withMarketingPoolTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const decision = previewDatabaseGuardDecision(process.env);
  if (decision === "reject") {
    throw new PreviewDatabaseGuardError("ambiguous-scope");
  }
  const client = await connectPreviewAwarePoolClient({
    connect: () => getRawMarketingPool().connect(),
  });
  let began = false;
  try {
    await client.query("BEGIN");
    began = true;
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    if (began || decision === "skip") {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original failure. The client is released below.
      }
    }
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
