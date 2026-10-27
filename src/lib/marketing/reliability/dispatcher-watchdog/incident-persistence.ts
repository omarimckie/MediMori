import type { PoolClient } from "@neondatabase/serverless";
import { sanitizeErrorMessage, sanitizeEvidence } from "../../incidents/sanitize";
import {
  MARKETING_INCIDENT_SCHEMA_VERSION,
  MARKETING_INCIDENT_SOURCE_SYSTEM,
} from "../../incidents/types";
import { DISPATCHER_WATCHDOG_INCIDENT_DEDUPE_PREFIX } from "./constants";

export function dispatcherWatchdogIncidentDedupeKey(incidentId: string): string {
  return `${DISPATCHER_WATCHDOG_INCIDENT_DEDUPE_PREFIX}:${incidentId}`;
}

export async function insertDispatcherWatchdogIncident(
  client: PoolClient,
  input: {
    incidentId: string;
    detectedAt: string;
    evidence: Record<string, unknown>;
  },
): Promise<void> {
  const dedupeKey = dispatcherWatchdogIncidentDedupeKey(input.incidentId);
  const permittedJson = JSON.stringify(["view_incident"]);
  const evidence = sanitizeEvidence({
    ...input.evidence,
    watchdogIncidentId: input.incidentId,
  });
  const sanitizedError = sanitizeErrorMessage(
    "Primary QStash dispatcher heartbeat stale beyond approved threshold.",
  );
  const agentCorrelationId = crypto.randomUUID();

  const insert = await client.query(
    `INSERT INTO marketing_incidents (
      id, schema_version, incident_version, incident_type, status, severity,
      source_system, source_operation, occurred_at, detected_at,
      content_id, publication_id, platform, provider, batch_id, finalize_key,
      dedupe_key, occurrence_count, first_seen_at, last_seen_at,
      error_class, sanitized_error, retry_safety, permitted_actions,
      human_approval_required, evidence,
      resolution_type, resolution_summary, resolved_at,
      agent_work_correlation_id, agent_work_last_submitted_at, agent_work_last_submit_error
    ) VALUES (
      $1::uuid, $2, 1, 'dispatcher_warning', 'open', 'error',
      $3, 'dispatcher_watchdog_observation', $4::timestamptz, $4::timestamptz,
      NULL, NULL, NULL, NULL, NULL, NULL,
      $5, 1, $4::timestamptz, $4::timestamptz,
      'dispatcher_primary_stale', $6, 'not_applicable', $7::jsonb,
      false, $8::jsonb,
      NULL, NULL, NULL,
      $9::uuid, NULL, NULL
    )
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING id`,
    [
      input.incidentId,
      MARKETING_INCIDENT_SCHEMA_VERSION,
      MARKETING_INCIDENT_SOURCE_SYSTEM,
      input.detectedAt,
      dedupeKey,
      sanitizedError,
      permittedJson,
      JSON.stringify(evidence),
      agentCorrelationId,
    ],
  );

  if (!insert.rowCount) {
    throw new Error("dispatcher_watchdog_incident_insert_conflict");
  }

  await client.query(
    `INSERT INTO marketing_incident_events (id, incident_id, event_type, actor, payload)
     VALUES ($1::uuid, $2::uuid, 'incident_created', 'system', $3::jsonb)`,
    [
      crypto.randomUUID(),
      input.incidentId,
      JSON.stringify({
        incidentType: "dispatcher_warning",
        severity: "error",
        dedupeKey,
      }),
    ],
  );
}

export async function resolveDispatcherWatchdogIncident(
  client: PoolClient,
  input: {
    incidentId: string;
    resolvedAt: string;
    resolutionSummary: string;
  },
): Promise<void> {
  const summary = sanitizeErrorMessage(input.resolutionSummary);
  const updated = await client.query(
    `UPDATE marketing_incidents
     SET status = 'resolved',
         resolution_type = 'auto_recovered',
         resolution_summary = $3,
         resolved_at = $2::timestamptz,
         incident_version = incident_version + 1,
         updated_at = now()
     WHERE id = $1::uuid AND status <> 'resolved'
     RETURNING id`,
    [input.incidentId, input.resolvedAt, summary],
  );
  if (!updated.rowCount) {
    return;
  }
  await client.query(
    `INSERT INTO marketing_incident_events (id, incident_id, event_type, actor, payload)
     VALUES ($1::uuid, $2::uuid, 'incident_resolved', 'system', $3::jsonb)`,
    [
      crypto.randomUUID(),
      input.incidentId,
      JSON.stringify({ resolutionType: "auto_recovered" }),
    ],
  );
}
