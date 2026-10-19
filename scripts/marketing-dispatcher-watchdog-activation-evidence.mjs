import { dispatcherWatchdogActivationError } from "./resolve-marketing-dispatcher-watchdog-activation-database-url.mjs";

/** Aligns with dispatcher watchdog primary stale threshold (30 minutes). */
export const ACTIVATION_MAX_PRIMARY_HEARTBEAT_AGE_MS = 30 * 60 * 1000;

export const ACTIVATION_REQUIRED_TABLES = [
  "marketing_dispatcher_qstash_primary",
  "marketing_dispatcher_qstash_verified_deliveries",
  "marketing_dispatcher_watchdog_state",
];

export const QSTASH_PRIMARY_ROW_ID = "primary";
export const WATCHDOG_STATE_ROW_ID = "primary";

/**
 * @param {import("pg").PoolClient | { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[], rowCount: number }> }} client
 * @param {string} tableName
 */
export async function tableExists(client, tableName) {
  const result = await client.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = $1`,
    [tableName],
  );
  return result.rowCount === 1;
}

/**
 * @param {import("pg").PoolClient | { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[], rowCount: number }> }} client
 */
export async function assertActivationSchemaReady(client) {
  for (const table of ACTIVATION_REQUIRED_TABLES) {
    if (!(await tableExists(client, table))) {
      throw dispatcherWatchdogActivationError("dispatcher_watchdog_activation_schema_missing");
    }
  }
}

/**
 * @param {string | null | undefined} iso
 * @param {number} nowMs
 */
export function primaryHeartbeatAgeMs(iso, nowMs = Date.now()) {
  if (!iso) {
    return null;
  }
  const seenMs = Date.parse(iso);
  if (Number.isNaN(seenMs)) {
    return null;
  }
  return nowMs - seenMs;
}

/**
 * @param {string | null | undefined} primaryLastSeenAtIso
 * @param {number} [nowMs]
 */
export function assertPrimaryHeartbeatFresh(primaryLastSeenAtIso, nowMs = Date.now()) {
  const ageMs = primaryHeartbeatAgeMs(primaryLastSeenAtIso, nowMs);
  if (ageMs == null) {
    throw dispatcherWatchdogActivationError("dispatcher_watchdog_activation_heartbeat_missing");
  }
  if (ageMs > ACTIVATION_MAX_PRIMARY_HEARTBEAT_AGE_MS) {
    throw dispatcherWatchdogActivationError("dispatcher_watchdog_activation_heartbeat_stale");
  }
}

/**
 * @param {import("pg").PoolClient | { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[], rowCount: number }> }} client
 * @param {{ nowMs?: number }} [options]
 */
export async function loadVerifiedPrimaryActivationEvidence(client, options = {}) {
  const nowMs = options.nowMs ?? Date.now();
  await assertActivationSchemaReady(client);

  const deliveryCount = await client.query(
    `SELECT COUNT(*)::int AS c FROM marketing_dispatcher_qstash_verified_deliveries`,
  );
  const count = Number(deliveryCount.rows[0]?.c ?? 0);
  if (count < 1) {
    throw dispatcherWatchdogActivationError("dispatcher_watchdog_activation_no_verified_delivery");
  }

  const primaryResult = await client.query(
    `SELECT last_seen_at FROM marketing_dispatcher_qstash_primary WHERE id = $1`,
    [QSTASH_PRIMARY_ROW_ID],
  );
  const primaryLastSeenRaw = primaryResult.rows[0]?.last_seen_at;
  const primaryLastSeenAt =
    primaryLastSeenRaw == null ? null : new Date(String(primaryLastSeenRaw)).toISOString();

  assertPrimaryHeartbeatFresh(primaryLastSeenAt, nowMs);

  const attestationResult = await client.query(
    `SELECT jti, seen_at
     FROM marketing_dispatcher_qstash_verified_deliveries
     WHERE seen_at <= (
       SELECT last_seen_at FROM marketing_dispatcher_qstash_primary WHERE id = $1
     )
     ORDER BY seen_at DESC
     LIMIT 1`,
    [QSTASH_PRIMARY_ROW_ID],
  );
  const attestationRow = attestationResult.rows[0];
  if (!attestationRow?.jti) {
    throw dispatcherWatchdogActivationError("dispatcher_watchdog_activation_evidence_unlinked");
  }

  return {
    verificationKind: "qstash_signature_verified",
    verifiedAt: primaryLastSeenAt,
    attestationId: String(attestationRow.jti),
    primaryLastSeenAt,
    attestationSeenAt: new Date(String(attestationRow.seen_at)).toISOString(),
    verifiedDeliveryCount: count,
    primaryHeartbeatAgeMs: primaryHeartbeatAgeMs(primaryLastSeenAt, nowMs),
  };
}

/**
 * Read-only activation readiness snapshot (no writes).
 * @param {import("pg").PoolClient | { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[], rowCount: number }> }} client
 * @param {{ nowMs?: number, targetHost?: string, targetDatabase?: string }} [meta]
 */
export async function buildActivationReadinessSnapshot(client, meta = {}) {
  const nowMs = meta.nowMs ?? Date.now();
  const tables = {};
  for (const table of ACTIVATION_REQUIRED_TABLES) {
    tables[table] = await tableExists(client, table);
  }

  let verifiedDeliveryCount = 0;
  let primaryLastSeenAt = null;
  let heartbeatAgeMs = null;
  let attestationJti = null;
  let attestationSeenAt = null;
  let evidenceError = null;

  if (tables.marketing_dispatcher_qstash_verified_deliveries) {
    const deliveryCount = await client.query(
      `SELECT COUNT(*)::int AS c FROM marketing_dispatcher_qstash_verified_deliveries`,
    );
    verifiedDeliveryCount = Number(deliveryCount.rows[0]?.c ?? 0);
  }

  if (tables.marketing_dispatcher_qstash_primary) {
    const primaryResult = await client.query(
      `SELECT last_seen_at FROM marketing_dispatcher_qstash_primary WHERE id = $1`,
      [QSTASH_PRIMARY_ROW_ID],
    );
    const raw = primaryResult.rows[0]?.last_seen_at;
    primaryLastSeenAt = raw == null ? null : new Date(String(raw)).toISOString();
    heartbeatAgeMs = primaryHeartbeatAgeMs(primaryLastSeenAt, nowMs);
  }

  if (
    tables.marketing_dispatcher_qstash_primary &&
    tables.marketing_dispatcher_qstash_verified_deliveries &&
    primaryLastSeenAt
  ) {
    try {
      const evidence = await loadVerifiedPrimaryActivationEvidence(client, { nowMs });
      attestationJti = evidence.attestationId;
      attestationSeenAt = evidence.attestationSeenAt;
    } catch (error) {
      evidenceError =
        error && typeof error === "object" && "code" in error && typeof error.code === "string"
          ? error.code
          : "dispatcher_watchdog_activation_evidence_invalid";
    }
  } else if (primaryLastSeenAt == null && tables.marketing_dispatcher_qstash_primary) {
    evidenceError = "dispatcher_watchdog_activation_heartbeat_missing";
  }

  let primaryQstashActivatedAt = null;
  let activationPending = true;
  if (tables.marketing_dispatcher_watchdog_state) {
    const stateResult = await client.query(
      `SELECT primary_qstash_activated_at FROM marketing_dispatcher_watchdog_state WHERE id = $1`,
      [WATCHDOG_STATE_ROW_ID],
    );
    const activatedRaw = stateResult.rows[0]?.primary_qstash_activated_at;
    primaryQstashActivatedAt =
      activatedRaw == null ? null : new Date(String(activatedRaw)).toISOString();
    activationPending = primaryQstashActivatedAt == null;
  }

  const heartbeatFresh =
    heartbeatAgeMs != null && heartbeatAgeMs <= ACTIVATION_MAX_PRIMARY_HEARTBEAT_AGE_MS;

  return {
    mode: "activation_readiness_snapshot",
    at: new Date(nowMs).toISOString(),
    targetHost: meta.targetHost ?? null,
    targetDatabase: meta.targetDatabase ?? null,
    maxPrimaryHeartbeatAgeMs: ACTIVATION_MAX_PRIMARY_HEARTBEAT_AGE_MS,
    tables,
    verifiedDeliveryCount,
    primaryLastSeenAt,
    primaryHeartbeatAgeMs: heartbeatAgeMs,
    heartbeatFresh,
    attestationJtiPresent: Boolean(attestationJti),
    attestationSeenAt,
    evidenceReady: evidenceError == null && heartbeatFresh && verifiedDeliveryCount > 0,
    evidenceError,
    primaryQstashActivatedAt,
    activationPending,
    sqlExecuted: false,
  };
}
