import type { PoolClient } from "@neondatabase/serverless";
import { QSTASH_PRIMARY_ROW_ID } from "./constants";
import { recordVerifiedPrimaryHeartbeat } from "./persistence";

type PrimaryRow = {
  id: string;
  last_seen_at: string;
  updated_at: string;
};

type DeliveryRow = {
  jti: string;
  seen_at: string;
  untrusted_message_id: string | null;
};

export type FakeQstashPrimaryPgStore = {
  primary: PrimaryRow | null;
  deliveries: Map<string, DeliveryRow>;
};

export function createFakeQstashPrimaryPgStore(): FakeQstashPrimaryPgStore {
  return {
    primary: null,
    deliveries: new Map(),
  };
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

export function createFakeQstashPrimaryPoolClient(
  store: FakeQstashPrimaryPgStore,
): PoolClient {
  return {
    query: async (text: string, params?: unknown[]) => {
      const sql = normalizeSql(text);
      const p = params ?? [];

      if (sql.includes("pg_advisory_xact_lock")) {
        return { rows: [], rowCount: 0 };
      }

      if (sql.startsWith("begin") || sql.startsWith("commit") || sql.startsWith("rollback")) {
        return { rows: [], rowCount: 0 };
      }

      if (
        sql.includes("insert into marketing_dispatcher_qstash_verified_deliveries") &&
        sql.includes("on conflict (jti)")
      ) {
        const jti = String(p[0]);
        const untrustedMessageId = p[1] == null ? null : String(p[1]);
        if (store.deliveries.has(jti)) {
          return { rows: [], rowCount: 0 };
        }
        const seenAt = new Date().toISOString();
        store.deliveries.set(jti, {
          jti,
          seen_at: seenAt,
          untrusted_message_id: untrustedMessageId,
        });
        return { rows: [{ jti }], rowCount: 1 };
      }

      if (
        sql.includes("select last_seen_at from marketing_dispatcher_qstash_primary") &&
        sql.includes("where id = $1")
      ) {
        if (!store.primary) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [{ last_seen_at: store.primary.last_seen_at }], rowCount: 1 };
      }

      if (sql.includes("insert into marketing_dispatcher_qstash_primary")) {
        const now = new Date().toISOString();
        if (!store.primary) {
          store.primary = {
            id: QSTASH_PRIMARY_ROW_ID,
            last_seen_at: now,
            updated_at: now,
          };
        } else {
          const previous = Date.parse(store.primary.last_seen_at);
          const next = Math.max(previous, Date.parse(now));
          store.primary.last_seen_at = new Date(next).toISOString();
          store.primary.updated_at = now;
        }
        return {
          rows: [{ last_seen_at: store.primary.last_seen_at }],
          rowCount: 1,
        };
      }

      throw new Error(`Unhandled fake pg query: ${text}`);
    },
    release: () => {},
  } as PoolClient;
}

export async function runFakeQstashPrimaryTransaction<T>(
  store: FakeQstashPrimaryPgStore,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = createFakeQstashPrimaryPoolClient(store);
  return fn(client);
}

export async function recordOnFakeStore(
  store: FakeQstashPrimaryPgStore,
  input: { jti: string; untrustedMessageId?: string | null },
) {
  return runFakeQstashPrimaryTransaction(store, (client) =>
    recordVerifiedPrimaryHeartbeat(client, input),
  );
}
