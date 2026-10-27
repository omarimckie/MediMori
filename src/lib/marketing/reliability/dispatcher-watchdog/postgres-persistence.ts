import type { PoolClient } from "@neondatabase/serverless";
import { WATCHDOG_STATE_ID } from "./constants";
import type { MaintenanceWindow, ObservationOutcome, WatchdogState } from "./types";
import { mapNotificationRow } from "./notification-claims";

export type WatchdogPgQueryClient = Pick<PoolClient, "query">;

export function mapStateRow(row: Record<string, unknown>): WatchdogState {
  return {
    id: String(row.id),
    primaryQstashActivatedAt:
      row.primary_qstash_activated_at == null
        ? null
        : new Date(String(row.primary_qstash_activated_at)).toISOString(),
    consecutiveStaleObservations: Number(row.consecutive_stale_observations ?? 0),
    lastPrimaryLastSeenAt:
      row.last_primary_last_seen_at == null
        ? null
        : new Date(String(row.last_primary_last_seen_at)).toISOString(),
    lastCommittedObservationSlotId: Number(row.last_committed_observation_slot_id ?? -1),
    lastObservationWasStale: Boolean(row.last_observation_was_stale),
    activeIncidentId: row.active_incident_id == null ? null : String(row.active_incident_id),
    deferredOutagePush: Boolean(row.deferred_outage_push),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

export async function loadWatchdogStateForUpdate(
  client: WatchdogPgQueryClient,
): Promise<WatchdogState> {
  const result = await client.query(
    `SELECT * FROM marketing_dispatcher_watchdog_state WHERE id = $1 FOR UPDATE`,
    [WATCHDOG_STATE_ID],
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) {
    throw new Error("watchdog_state_missing_after_init");
  }
  return mapStateRow(row);
}

export async function initWatchdogStateRow(
  client: WatchdogPgQueryClient,
  nowIso: string,
): Promise<void> {
  await client.query(
    `INSERT INTO marketing_dispatcher_watchdog_state (id, updated_at)
     VALUES ($1, $2::timestamptz)
     ON CONFLICT (id) DO NOTHING`,
    [WATCHDOG_STATE_ID, nowIso],
  );
}

export async function persistWatchdogState(
  client: WatchdogPgQueryClient,
  state: WatchdogState,
): Promise<void> {
  await client.query(
    `UPDATE marketing_dispatcher_watchdog_state
     SET primary_qstash_activated_at = $2::timestamptz,
         consecutive_stale_observations = $3,
         last_primary_last_seen_at = $4::timestamptz,
         last_committed_observation_slot_id = $5,
         last_observation_was_stale = $6,
         active_incident_id = $7::uuid,
         deferred_outage_push = $8,
         updated_at = $9::timestamptz
     WHERE id = $1`,
    [
      state.id,
      state.primaryQstashActivatedAt,
      state.consecutiveStaleObservations,
      state.lastPrimaryLastSeenAt,
      state.lastCommittedObservationSlotId,
      state.lastObservationWasStale,
      state.activeIncidentId,
      state.deferredOutagePush,
      state.updatedAt,
    ],
  );
}

export async function insertObservationSlot(
  client: WatchdogPgQueryClient,
  input: {
    observationSlotId: number;
    observedAt: string;
    githubRunId: string | null;
    githubRunAttempt: string | null;
    primaryLastSeenAt: string | null;
    stale: boolean;
    activationPending: boolean;
    outcome: ObservationOutcome;
  },
): Promise<boolean> {
  const result = await client.query(
    `INSERT INTO marketing_dispatcher_watchdog_observations (
      observation_slot_id, observed_at, github_run_id, github_run_attempt,
      primary_last_seen_at, stale, activation_pending, outcome
    ) VALUES ($1, $2::timestamptz, $3, $4, $5::timestamptz, $6, $7, $8)
    ON CONFLICT (observation_slot_id) DO NOTHING
    RETURNING observation_slot_id`,
    [
      input.observationSlotId,
      input.observedAt,
      input.githubRunId,
      input.githubRunAttempt,
      input.primaryLastSeenAt,
      input.stale,
      input.activationPending,
      input.outcome,
    ],
  );
  return Boolean(result.rowCount);
}

export async function observationSlotExists(
  client: WatchdogPgQueryClient,
  observationSlotId: number,
): Promise<boolean> {
  const result = await client.query(
    `SELECT 1 FROM marketing_dispatcher_watchdog_observations
     WHERE observation_slot_id = $1`,
    [observationSlotId],
  );
  return result.rows.length > 0;
}

export async function listActiveMaintenanceWindows(
  client: WatchdogPgQueryClient,
  observationTimeIso: string,
): Promise<MaintenanceWindow[]> {
  const result = await client.query(
    `SELECT * FROM marketing_dispatcher_maintenance_windows
     WHERE starts_at <= $1::timestamptz AND ends_at > $1::timestamptz`,
    [observationTimeIso],
  );
  return result.rows.map((row) => {
    const record = row as Record<string, unknown>;
    return {
      id: String(record.id),
      startsAt: new Date(String(record.starts_at)).toISOString(),
      endsAt: new Date(String(record.ends_at)).toISOString(),
      reason: String(record.reason),
      createdBy: String(record.created_by),
      createdAt: new Date(String(record.created_at)).toISOString(),
    };
  });
}

export async function activatePrimaryQstashWatchdog(
  client: WatchdogPgQueryClient,
  input: { activatedAt: string; attestationId?: string },
): Promise<WatchdogState> {
  const result = await client.query(
    `UPDATE marketing_dispatcher_watchdog_state
     SET primary_qstash_activated_at = $2::timestamptz,
         updated_at = $2::timestamptz
     WHERE id = $1 AND primary_qstash_activated_at IS NULL
     RETURNING *`,
    [WATCHDOG_STATE_ID, input.activatedAt],
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) {
    return loadWatchdogStateForUpdate(client);
  }
  return mapStateRow(row);
}

export async function readWatchdogState(
  client: WatchdogPgQueryClient,
): Promise<WatchdogState | null> {
  const result = await client.query(
    `SELECT * FROM marketing_dispatcher_watchdog_state WHERE id = $1`,
    [WATCHDOG_STATE_ID],
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  return row ? mapStateRow(row) : null;
}

export { mapNotificationRow };
