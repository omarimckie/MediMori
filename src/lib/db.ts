import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import {
  createPreviewGuardedSql,
  previewDatabaseGuardDecision,
  PreviewDatabaseGuardError,
} from "@/lib/marketing/preview-db-guard";

type SqlClient = NeonQueryFunction<false, false>;
type SqlFactory = (connectionString: string) => SqlClient;

let sqlFactory: SqlFactory = neon;
let unguarded: SqlClient | null = null;
const guardedByConnection = new Map<string, SqlClient>();

/** Test hook. Production code uses the Neon HTTP client. */
export function setSqlFactoryForTests(factory: SqlFactory | null): void {
  sqlFactory = factory ?? neon;
}

/** Test hook. Drops cached clients so the next call observes the current environment. */
export function resetSqlCacheForTests(): void {
  unguarded = null;
  guardedByConnection.clear();
  sqlFactory = neon;
}

/**
 * Server-side Neon/Postgres client. Import only from Route Handlers,
 * Server Actions, or other server modules — never from Client Components.
 * DATABASE_URL is never exposed to the browser.
 *
 * On the feature/order-notifications Preview deployment, the returned client
 * runs a read-only identity probe before the caller's first statement.
 * Production and other Preview branches keep a single unguarded client.
 */
export function getSql(): SqlClient {
  if (typeof window !== "undefined") {
    throw new Error("Database client is server-side only.");
  }

  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const decision = previewDatabaseGuardDecision(process.env);
  if (decision === "reject") {
    throw new PreviewDatabaseGuardError("ambiguous-scope");
  }

  if (decision === "skip") {
    if (!unguarded) unguarded = sqlFactory(connectionString);
    return unguarded;
  }

  const cached = guardedByConnection.get(connectionString);
  if (cached) return cached;

  const guarded = createPreviewGuardedSql(sqlFactory(connectionString));
  guardedByConnection.set(connectionString, guarded);
  return guarded;
}
