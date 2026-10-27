import type { PoolClient } from "@neondatabase/serverless";
import { withCredentialHealthSourceLock } from "../../credential-health/heartbeat-store-pool";
import { QSTASH_PRIMARY_ADVISORY_LOCK_KEY, QSTASH_PRIMARY_ROW_ID } from "./constants";
import type { RecordVerifiedPrimaryHeartbeatResult } from "./types";

export type RecordVerifiedPrimaryHeartbeatInput = {
  jti: string;
  untrustedMessageId?: string | null;
};

/** Matches `withCredentialHealthSourceLock` for optional per-invocation test runners. */
export type CredentialHealthSourceLockRunner = <T>(
  source: string,
  fn: (client: PoolClient) => Promise<T>,
) => Promise<T>;

export type RecordVerifiedPrimaryHeartbeatInLockOptions = {
  runLocked?: CredentialHealthSourceLockRunner;
};

export async function recordVerifiedPrimaryHeartbeat(
  client: PoolClient,
  input: RecordVerifiedPrimaryHeartbeatInput,
): Promise<RecordVerifiedPrimaryHeartbeatResult> {
  const inserted = await client.query(
    `INSERT INTO marketing_dispatcher_qstash_verified_deliveries (jti, untrusted_message_id)
     VALUES ($1, $2)
     ON CONFLICT (jti) DO NOTHING
     RETURNING jti`,
    [input.jti, input.untrustedMessageId ?? null],
  );

  const existingPrimary = await client.query(
    `SELECT last_seen_at FROM marketing_dispatcher_qstash_primary WHERE id = $1`,
    [QSTASH_PRIMARY_ROW_ID],
  );
  const previousLastSeen =
    existingPrimary.rows[0]?.last_seen_at == null
      ? null
      : new Date(String(existingPrimary.rows[0].last_seen_at)).toISOString();

  if (!inserted.rowCount) {
    return {
      outcome: "duplicate_jti",
      jti: input.jti,
      lastSeenAt: previousLastSeen ?? new Date(0).toISOString(),
    };
  }

  const updated = await client.query(
    `INSERT INTO marketing_dispatcher_qstash_primary (id, last_seen_at, updated_at)
     VALUES ($1, now(), now())
     ON CONFLICT (id) DO UPDATE SET
       last_seen_at = GREATEST(marketing_dispatcher_qstash_primary.last_seen_at, now()),
       updated_at = now()
     RETURNING last_seen_at`,
    [QSTASH_PRIMARY_ROW_ID],
  );

  const lastSeenAt = new Date(String(updated.rows[0].last_seen_at)).toISOString();
  return {
    outcome: "advanced",
    jti: input.jti,
    lastSeenAt,
  };
}

export async function loadVerifiedPrimaryLastSeenAt(
  client: PoolClient,
): Promise<string | null> {
  const result = await client.query(
    `SELECT last_seen_at FROM marketing_dispatcher_qstash_primary WHERE id = $1`,
    [QSTASH_PRIMARY_ROW_ID],
  );
  const row = result.rows[0] as { last_seen_at?: unknown } | undefined;
  if (!row || row.last_seen_at == null) {
    return null;
  }
  return new Date(String(row.last_seen_at)).toISOString();
}

export async function recordVerifiedPrimaryHeartbeatInLock(
  input: RecordVerifiedPrimaryHeartbeatInput,
  options?: RecordVerifiedPrimaryHeartbeatInLockOptions,
): Promise<RecordVerifiedPrimaryHeartbeatResult> {
  const runLocked = options?.runLocked ?? withCredentialHealthSourceLock;
  return runLocked(QSTASH_PRIMARY_ADVISORY_LOCK_KEY, async (client) =>
    recordVerifiedPrimaryHeartbeat(client, input),
  );
}
