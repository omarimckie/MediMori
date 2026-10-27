import type { PoolClient } from "@neondatabase/serverless";
import { WATCHDOG_STATE_ID } from "./constants";
import { isMaintenanceActive, outageNotificationWasSent } from "./evaluate";
import { listActiveMaintenanceWindows } from "./postgres-persistence";
import type {
  BeginPushAttemptResult,
  IncidentNotificationState,
  PushClaimAcquireResult,
  PushClaimStatus,
  WatchdogState,
} from "./types";

/** Snapshot of marketing_incidents used for attempt-start eligibility. */
export type WatchdogIncidentSnapshot = {
  status: string;
  resolvedAt: string | null;
};

/** Authoritative outage attempt-start predicate (shared by PostgreSQL and memory). */
export function outagePushAttemptEligibleFromState(input: {
  incidentId: string;
  incident: WatchdogIncidentSnapshot | null;
  watchdogState: Pick<WatchdogState, "activeIncidentId">;
  maintenanceActive: boolean;
}): boolean {
  if (!input.incident) {
    return false;
  }
  if (input.incident.status !== "open" || input.incident.resolvedAt != null) {
    return false;
  }
  if (input.watchdogState.activeIncidentId !== input.incidentId) {
    return false;
  }
  if (input.maintenanceActive) {
    return false;
  }
  return true;
}

/**
 * Recovery attempt-start eligibility after a fresh observation has committed.
 * Mirrors evaluate.ts recovery gating once the incident is resolved and the
 * active episode is cleared from watchdog state.
 */
export function recoveryPushAttemptEligibleFromState(input: {
  incident: WatchdogIncidentSnapshot | null;
  notification: IncidentNotificationState | null;
  watchdogState: WatchdogState;
}): boolean {
  const { incident, notification, watchdogState } = input;
  if (!incident || !notification) {
    return false;
  }
  if (!outageNotificationWasSent(notification)) {
    return false;
  }
  if (
    notification.recoveryPushClaimStatus === "delivered" ||
    notification.recoveryPushClaimStatus === "ambiguous"
  ) {
    return false;
  }
  const resolved =
    incident.status === "resolved" || incident.resolvedAt != null;
  if (!resolved) {
    return false;
  }
  if (watchdogState.activeIncidentId != null) {
    return false;
  }
  if (watchdogState.lastObservationWasStale) {
    return false;
  }
  if (watchdogState.consecutiveStaleObservations !== 0) {
    return false;
  }
  return true;
}

export type ClaimAcquireResult = "acquired" | "blocked" | "missing";

/** Database interval for stale unattempted claim recovery (Policy A). */
export const STALE_UNATTEMPTED_CLAIM_INTERVAL = "10 minutes";

export function mapNotificationRow(row: Record<string, unknown>): IncidentNotificationState {
  return {
    incidentId: String(row.incident_id),
    outagePushClaimStatus: String(row.outage_push_claim_status) as PushClaimStatus,
    recoveryPushClaimStatus: String(row.recovery_push_claim_status) as PushClaimStatus,
    outagePushSentAt:
      row.outage_push_sent_at == null
        ? null
        : new Date(String(row.outage_push_sent_at)).toISOString(),
    outagePushClaimNonce:
      row.outage_push_claim_nonce == null ? null : String(row.outage_push_claim_nonce),
    outagePushAttemptStartedAt:
      row.outage_push_attempt_started_at == null
        ? null
        : new Date(String(row.outage_push_attempt_started_at)).toISOString(),
    outagePushAdminNotificationId:
      row.outage_push_admin_notification_id == null
        ? null
        : String(row.outage_push_admin_notification_id),
    recoveryPushClaimNonce:
      row.recovery_push_claim_nonce == null ? null : String(row.recovery_push_claim_nonce),
    recoveryPushAttemptStartedAt:
      row.recovery_push_attempt_started_at == null
        ? null
        : new Date(String(row.recovery_push_attempt_started_at)).toISOString(),
    recoveryPushAdminNotificationId:
      row.recovery_push_admin_notification_id == null
        ? null
        : String(row.recovery_push_admin_notification_id),
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

async function reclaimStaleUnattemptedOutageClaim(
  client: PoolClient,
  incidentId: string,
): Promise<void> {
  await client.query(
    `UPDATE marketing_dispatcher_watchdog_incident_notifications
     SET outage_push_claim_status = 'none',
         outage_push_claim_nonce = NULL,
         updated_at = now()
     WHERE incident_id = $1::uuid
       AND outage_push_claim_status = 'claimed'
       AND outage_push_claim_nonce IS NOT NULL
       AND outage_push_attempt_started_at IS NULL
       AND outage_push_admin_notification_id IS NULL
       AND updated_at < now() - $2::interval`,
    [incidentId, STALE_UNATTEMPTED_CLAIM_INTERVAL],
  );
}

async function reclaimStaleUnattemptedRecoveryClaim(
  client: PoolClient,
  incidentId: string,
): Promise<void> {
  await client.query(
    `UPDATE marketing_dispatcher_watchdog_incident_notifications
     SET recovery_push_claim_status = 'none',
         recovery_push_claim_nonce = NULL,
         updated_at = now()
     WHERE incident_id = $1::uuid
       AND recovery_push_claim_status = 'claimed'
       AND recovery_push_claim_nonce IS NOT NULL
       AND recovery_push_attempt_started_at IS NULL
       AND recovery_push_admin_notification_id IS NULL
       AND updated_at < now() - $2::interval`,
    [incidentId, STALE_UNATTEMPTED_CLAIM_INTERVAL],
  );
}

async function validateOutagePushAttemptEligible(
  client: PoolClient,
  incidentId: string,
  nowIso: string,
): Promise<boolean> {
  const incident = await client.query(
    `SELECT status, resolved_at FROM marketing_incidents WHERE id = $1::uuid`,
    [incidentId],
  );
  const incidentRow = incident.rows[0] as
    | { status?: unknown; resolved_at?: unknown }
    | undefined;
  const incidentSnapshot: WatchdogIncidentSnapshot | null = incidentRow
    ? {
        status: String(incidentRow.status),
        resolvedAt:
          incidentRow.resolved_at == null
            ? null
            : new Date(String(incidentRow.resolved_at)).toISOString(),
      }
    : null;

  const state = await client.query(
    `SELECT active_incident_id FROM marketing_dispatcher_watchdog_state WHERE id = $1`,
    [WATCHDOG_STATE_ID],
  );
  const activeId = state.rows[0]?.active_incident_id;
  const windows = await listActiveMaintenanceWindows(client, nowIso);

  return outagePushAttemptEligibleFromState({
    incidentId,
    incident: incidentSnapshot,
    watchdogState: {
      activeIncidentId: activeId == null ? null : String(activeId),
    },
    maintenanceActive: isMaintenanceActive(windows, Date.parse(nowIso)),
  });
}

async function validateRecoveryPushAttemptEligible(
  client: PoolClient,
  incidentId: string,
): Promise<boolean> {
  const row = await loadIncidentNotificationRow(client, incidentId);

  const incident = await client.query(
    `SELECT status, resolved_at FROM marketing_incidents WHERE id = $1::uuid`,
    [incidentId],
  );
  const incidentRow = incident.rows[0] as
    | { status?: unknown; resolved_at?: unknown }
    | undefined;
  const incidentSnapshot: WatchdogIncidentSnapshot | null = incidentRow
    ? {
        status: String(incidentRow.status),
        resolvedAt:
          incidentRow.resolved_at == null
            ? null
            : new Date(String(incidentRow.resolved_at)).toISOString(),
      }
    : null;

  const state = await client.query(
    `SELECT active_incident_id, last_observation_was_stale, consecutive_stale_observations
     FROM marketing_dispatcher_watchdog_state WHERE id = $1`,
    [WATCHDOG_STATE_ID],
  );
  const stateRow = state.rows[0] as
    | {
        active_incident_id?: unknown;
        last_observation_was_stale?: unknown;
        consecutive_stale_observations?: unknown;
      }
    | undefined;
  if (!stateRow) {
    return false;
  }

  const watchdogState: WatchdogState = {
    id: WATCHDOG_STATE_ID,
    primaryQstashActivatedAt: null,
    consecutiveStaleObservations: Number(stateRow.consecutive_stale_observations ?? 0),
    lastPrimaryLastSeenAt: null,
    lastCommittedObservationSlotId: -1,
    lastObservationWasStale: Boolean(stateRow.last_observation_was_stale),
    activeIncidentId:
      stateRow.active_incident_id == null ? null : String(stateRow.active_incident_id),
    deferredOutagePush: false,
    updatedAt: new Date().toISOString(),
  };

  return recoveryPushAttemptEligibleFromState({
    incident: incidentSnapshot,
    notification: row,
    watchdogState,
  });
}

export async function tryAcquireOutagePushClaim(
  client: PoolClient,
  incidentId: string,
): Promise<PushClaimAcquireResult> {
  const row = await loadIncidentNotificationRow(client, incidentId);
  if (!row) return { status: "missing" };
  if (outageNotificationWasSent(row)) return { status: "blocked" };

  await reclaimStaleUnattemptedOutageClaim(client, incidentId);

  const claimNonce = crypto.randomUUID();
  const updated = await client.query(
    `UPDATE marketing_dispatcher_watchdog_incident_notifications
     SET outage_push_claim_status = 'claimed',
         outage_push_claim_nonce = $2::uuid,
         outage_push_attempt_started_at = NULL,
         outage_push_admin_notification_id = NULL,
         updated_at = now()
     WHERE incident_id = $1::uuid
       AND outage_push_claim_status IN ('none', 'failed')
     RETURNING outage_push_claim_nonce`,
    [incidentId, claimNonce],
  );
  if (updated.rowCount) {
    return { status: "acquired", claimNonce };
  }

  return { status: "blocked" };
}

export async function tryAcquireRecoveryPushClaim(
  client: PoolClient,
  incidentId: string,
): Promise<PushClaimAcquireResult> {
  const row = await loadIncidentNotificationRow(client, incidentId);
  if (!row) return { status: "missing" };
  if (!outageNotificationWasSent(row)) return { status: "blocked" };
  if (
    row.recoveryPushClaimStatus === "delivered" ||
    row.recoveryPushClaimStatus === "ambiguous"
  ) {
    return { status: "blocked" };
  }

  await reclaimStaleUnattemptedRecoveryClaim(client, incidentId);

  const claimNonce = crypto.randomUUID();
  const updated = await client.query(
    `UPDATE marketing_dispatcher_watchdog_incident_notifications
     SET recovery_push_claim_status = 'claimed',
         recovery_push_claim_nonce = $2::uuid,
         recovery_push_attempt_started_at = NULL,
         recovery_push_admin_notification_id = NULL,
         updated_at = now()
     WHERE incident_id = $1::uuid
       AND recovery_push_claim_status IN ('none', 'failed')
     RETURNING recovery_push_claim_nonce`,
    [incidentId, claimNonce],
  );
  if (updated.rowCount) {
    return { status: "acquired", claimNonce };
  }

  return { status: "blocked" };
}

export async function beginOutagePushAttempt(
  client: PoolClient,
  input: {
    incidentId: string;
    claimNonce: string;
    adminNotificationId?: string | null;
    nowIso: string;
  },
): Promise<BeginPushAttemptResult> {
  if (!(await validateOutagePushAttemptEligible(client, input.incidentId, input.nowIso))) {
    return { ok: false, code: "watchdog_outage_push_not_eligible" };
  }

  const updated = await client.query(
    `UPDATE marketing_dispatcher_watchdog_incident_notifications
     SET outage_push_attempt_started_at = $3::timestamptz,
         outage_push_admin_notification_id = $4::uuid,
         updated_at = now()
     WHERE incident_id = $1::uuid
       AND outage_push_claim_status = 'claimed'
       AND outage_push_claim_nonce = $2::uuid
       AND outage_push_attempt_started_at IS NULL
       AND outage_push_admin_notification_id IS NULL
     RETURNING incident_id`,
    [
      input.incidentId,
      input.claimNonce,
      input.nowIso,
      input.adminNotificationId ?? null,
    ],
  );
  return updated.rowCount ? { ok: true } : { ok: false, code: "watchdog_outage_push_begin_rejected" };
}

export async function beginRecoveryPushAttempt(
  client: PoolClient,
  input: {
    incidentId: string;
    claimNonce: string;
    adminNotificationId?: string | null;
    nowIso: string;
  },
): Promise<BeginPushAttemptResult> {
  if (!(await validateRecoveryPushAttemptEligible(client, input.incidentId))) {
    return { ok: false, code: "watchdog_recovery_push_not_eligible" };
  }

  const updated = await client.query(
    `UPDATE marketing_dispatcher_watchdog_incident_notifications
     SET recovery_push_attempt_started_at = $3::timestamptz,
         recovery_push_admin_notification_id = $4::uuid,
         updated_at = now()
     WHERE incident_id = $1::uuid
       AND recovery_push_claim_status = 'claimed'
       AND recovery_push_claim_nonce = $2::uuid
       AND recovery_push_attempt_started_at IS NULL
       AND recovery_push_admin_notification_id IS NULL
     RETURNING incident_id`,
    [
      input.incidentId,
      input.claimNonce,
      input.nowIso,
      input.adminNotificationId ?? null,
    ],
  );
  return updated.rowCount
    ? { ok: true }
    : { ok: false, code: "watchdog_recovery_push_begin_rejected" };
}

export async function finalizeOutagePushClaimRow(
  client: PoolClient,
  input: {
    incidentId: string;
    claimNonce: string;
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
     SET outage_push_claim_status = $3,
         outage_push_sent_at = COALESCE(outage_push_sent_at, $4::timestamptz),
         outage_push_claim_nonce = NULL,
         updated_at = now()
     WHERE incident_id = $1::uuid
       AND outage_push_claim_status = 'claimed'
       AND outage_push_claim_nonce = $2::uuid
     RETURNING *`,
    [input.incidentId, input.claimNonce, status, sentAt],
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  return row ? mapNotificationRow(row) : null;
}

export async function finalizeRecoveryPushClaimRow(
  client: PoolClient,
  input: {
    incidentId: string;
    claimNonce: string;
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
     SET recovery_push_claim_status = $3,
         recovery_push_claim_nonce = NULL,
         updated_at = now()
     WHERE incident_id = $1::uuid
       AND recovery_push_claim_status = 'claimed'
       AND recovery_push_claim_nonce = $2::uuid
     RETURNING *`,
    [input.incidentId, input.claimNonce, status],
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  return row ? mapNotificationRow(row) : null;
}
