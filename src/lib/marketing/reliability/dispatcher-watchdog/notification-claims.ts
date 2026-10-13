import type { PoolClient } from "@neondatabase/serverless";
import type { PushClaimStatus } from "./types";
import { outageNotificationWasSent } from "./evaluate";
import type { IncidentNotificationState } from "./types";

export type ClaimAcquireResult = "acquired" | "blocked" | "missing";

export function mapNotificationRow(row: Record<string, unknown>): IncidentNotificationState {
  return {
    incidentId: String(row.incident_id),
    outagePushClaimStatus: String(row.outage_push_claim_status) as PushClaimStatus,
    recoveryPushClaimStatus: String(row.recovery_push_claim_status) as PushClaimStatus,
    outagePushSentAt:
      row.outage_push_sent_at == null
        ? null
        : new Date(String(row.outage_push_sent_at)).toISOString(),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

export async function ensureIncidentNotificationRow(
  client: PoolClient,
  incidentId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO marketing_dispatcher_watchdog_incident_notifications (incident_id)
     VALUES ($1::uuid)
     ON CONFLICT (incident_id) DO NOTHING`,
    [incidentId],
  );
}

export async function loadIncidentNotificationRow(
  client: PoolClient,
  incidentId: string,
): Promise<IncidentNotificationState | null> {
  const result = await client.query(
    `SELECT * FROM marketing_dispatcher_watchdog_incident_notifications
     WHERE incident_id = $1::uuid`,
    [incidentId],
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  return row ? mapNotificationRow(row) : null;
}

export async function tryAcquireOutagePushClaim(
  client: PoolClient,
  incidentId: string,
): Promise<ClaimAcquireResult> {
  const row = await loadIncidentNotificationRow(client, incidentId);
  if (!row) return "missing";
  if (outageNotificationWasSent(row)) return "blocked";
  if (row.outagePushClaimStatus === "claimed") return "blocked";
  const updated = await client.query(
    `UPDATE marketing_dispatcher_watchdog_incident_notifications
     SET outage_push_claim_status = 'claimed', updated_at = now()
     WHERE incident_id = $1::uuid
       AND outage_push_claim_status IN ('none', 'failed')
     RETURNING incident_id`,
    [incidentId],
  );
  return updated.rowCount ? "acquired" : "blocked";
}

export async function finalizeOutagePushClaimRow(
  client: PoolClient,
  input: {
    incidentId: string;
    pushDelivered: number;
    ambiguous?: boolean;
    nowIso: string;
  },
): Promise<IncidentNotificationState | null> {
  const status: PushClaimStatus =
    input.ambiguous || input.pushDelivered > 0
      ? input.ambiguous
        ? "ambiguous"
        : "delivered"
      : "failed";
  const sentAt =
    status === "delivered" || status === "ambiguous" ? input.nowIso : null;
  const result = await client.query(
    `UPDATE marketing_dispatcher_watchdog_incident_notifications
     SET outage_push_claim_status = $2,
         outage_push_sent_at = COALESCE(outage_push_sent_at, $3::timestamptz),
         updated_at = now()
     WHERE incident_id = $1::uuid
     RETURNING *`,
    [input.incidentId, status, sentAt],
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  return row ? mapNotificationRow(row) : null;
}

export async function tryAcquireRecoveryPushClaim(
  client: PoolClient,
  incidentId: string,
): Promise<ClaimAcquireResult> {
  const row = await loadIncidentNotificationRow(client, incidentId);
  if (!row) return "missing";
  if (!outageNotificationWasSent(row)) return "blocked";
  if (
    row.recoveryPushClaimStatus === "delivered" ||
    row.recoveryPushClaimStatus === "ambiguous"
  ) {
    return "blocked";
  }
  const updated = await client.query(
    `UPDATE marketing_dispatcher_watchdog_incident_notifications
     SET recovery_push_claim_status = 'claimed', updated_at = now()
     WHERE incident_id = $1::uuid
       AND recovery_push_claim_status IN ('none', 'failed')
     RETURNING incident_id`,
    [incidentId],
  );
  return updated.rowCount ? "acquired" : "blocked";
}

export async function finalizeRecoveryPushClaimRow(
  client: PoolClient,
  input: {
    incidentId: string;
    pushDelivered: number;
    ambiguous?: boolean;
    nowIso: string;
  },
): Promise<IncidentNotificationState | null> {
  const status: PushClaimStatus =
    input.ambiguous || input.pushDelivered > 0
      ? input.ambiguous
        ? "ambiguous"
        : "delivered"
      : "failed";
  const result = await client.query(
    `UPDATE marketing_dispatcher_watchdog_incident_notifications
     SET recovery_push_claim_status = $2, updated_at = now()
     WHERE incident_id = $1::uuid
     RETURNING *`,
    [input.incidentId, status],
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  return row ? mapNotificationRow(row) : null;
}
