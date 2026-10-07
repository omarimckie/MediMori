import { getSql } from "@/lib/db";
import { Pool, type PoolClient } from "@neondatabase/serverless";
import { sanitizeEventPayload } from "./sanitize";
import type {
  MarketingIncidentEventRecord,
  MarketingIncidentRecord,
  PermittedAction,
} from "./types";
import type {
  InsertIncidentInput,
  MarketingIncidentRepository,
  UpdateIncidentPatch,
} from "./repository";
import type { PreparedRecordIncident } from "./record-incident-core";
import { executeRecordIncident } from "./record-incident-core";
import type { RecordIncidentOptions, RecordIncidentResult } from "./record-types";
import { MARKETING_INCIDENT_SCHEMA_VERSION, MARKETING_INCIDENT_SOURCE_SYSTEM } from "./types";
import {
  parseIncidentEventType,
  parseIncidentSeverity,
  parseIncidentStatus,
  parseIncidentType,
  parsePermittedActions,
  parseResolutionType,
  parseRetrySafety,
} from "./validate";

let incidentPool: Pool | null = null;

function getIncidentPool(): Pool {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured.");
  }
  if (!incidentPool) {
    incidentPool = new Pool({ connectionString });
  }
  return incidentPool;
}

export function mapIncidentRow(row: Record<string, unknown>): MarketingIncidentRecord {
  const permittedRaw = row.permitted_actions;
  const permittedList = Array.isArray(permittedRaw)
    ? permittedRaw.map((v) => String(v))
    : (permittedRaw as string[] | undefined) ??
      (JSON.parse(String(permittedRaw ?? "[]")) as string[]);

  return {
    id: String(row.id),
    schemaVersion: Number(row.schema_version ?? 1),
    incidentVersion: Number(row.incident_version ?? 1),
    incidentType: parseIncidentType(String(row.incident_type)),
    status: parseIncidentStatus(String(row.status)),
    severity: parseIncidentSeverity(String(row.severity)),
    sourceSystem: String(row.source_system),
    sourceOperation: String(row.source_operation),
    occurredAt: new Date(String(row.occurred_at)).toISOString(),
    detectedAt: new Date(String(row.detected_at)).toISOString(),
    contentId: row.content_id == null ? null : String(row.content_id),
    publicationId: row.publication_id == null ? null : String(row.publication_id),
    platform: row.platform == null ? null : String(row.platform),
    provider: row.provider == null ? null : String(row.provider),
    batchId: row.batch_id == null ? null : String(row.batch_id),
    finalizeKey: row.finalize_key == null ? null : String(row.finalize_key),
    dedupeKey: String(row.dedupe_key),
    occurrenceCount: Number(row.occurrence_count ?? 1),
    firstSeenAt: new Date(String(row.first_seen_at)).toISOString(),
    lastSeenAt: new Date(String(row.last_seen_at)).toISOString(),
    errorClass: String(row.error_class),
    sanitizedError: String(row.sanitized_error),
    retrySafety: parseRetrySafety(String(row.retry_safety)),
    permittedActions: parsePermittedActions(permittedList),
    humanApprovalRequired: Boolean(row.human_approval_required),
    evidence: (row.evidence ?? {}) as Record<string, unknown>,
    resolutionType:
      row.resolution_type == null ? null : parseResolutionType(String(row.resolution_type)),
    resolutionSummary: row.resolution_summary == null ? null : String(row.resolution_summary),
    resolvedAt: row.resolved_at == null ? null : new Date(String(row.resolved_at)).toISOString(),
    agentWorkCorrelationId: String(row.agent_work_correlation_id),
    agentWorkLastSubmittedAt:
      row.agent_work_last_submitted_at == null
        ? null
        : new Date(String(row.agent_work_last_submitted_at)).toISOString(),
    agentWorkLastSubmitError:
      row.agent_work_last_submit_error == null ? null : String(row.agent_work_last_submit_error),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

function mapEventRow(row: Record<string, unknown>): MarketingIncidentEventRecord {
  return {
    id: String(row.id),
    incidentId: String(row.incident_id),
    eventType: parseIncidentEventType(String(row.event_type)),
    actor: String(row.actor),
    payload: (row.payload ?? {}) as Record<string, unknown>,
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

function createRepoForPoolClient(client: PoolClient): PostgresMarketingIncidentRepository {
  return {
    async runTransaction(fn) {
      return withPoolTransaction((txClient) => fn(createRepoForPoolClient(txClient)));
    },

    async findByDedupeKey(dedupeKey) {
      const result = await client.query(
        `SELECT * FROM marketing_incidents WHERE dedupe_key = $1 LIMIT 1`,
        [dedupeKey],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? mapIncidentRow(row) : null;
    },

    async findByDedupeKeyForUpdate(dedupeKey) {
      const result = await client.query(
        `SELECT * FROM marketing_incidents WHERE dedupe_key = $1 FOR UPDATE`,
        [dedupeKey],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? mapIncidentRow(row) : null;
    },

    async findById(id) {
      const result = await client.query(`SELECT * FROM marketing_incidents WHERE id = $1::uuid LIMIT 1`, [
        id,
      ]);
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? mapIncidentRow(row) : null;
    },

    async tryInsertIncident(input) {
      const permittedJson = JSON.stringify(input.permittedActions);
      const result = await client.query(
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
          $1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10::timestamptz,
          $11::uuid, $12::uuid, $13, $14, $15, $16, $17, $18, $19::timestamptz, $20::timestamptz,
          $21, $22, $23, $24::jsonb, $25, $26::jsonb, $27, $28, $29::timestamptz,
          $30::uuid, $31::timestamptz, $32
        )
        ON CONFLICT (dedupe_key) DO NOTHING
        RETURNING id`,
        [
          input.id,
          input.schemaVersion,
          input.incidentVersion,
          input.incidentType,
          input.status,
          input.severity,
          input.sourceSystem,
          input.sourceOperation,
          input.occurredAt,
          input.detectedAt,
          input.contentId,
          input.publicationId,
          input.platform,
          input.provider,
          input.batchId,
          input.finalizeKey,
          input.dedupeKey,
          input.occurrenceCount,
          input.firstSeenAt,
          input.lastSeenAt,
          input.errorClass,
          input.sanitizedError,
          input.retrySafety,
          permittedJson,
          input.humanApprovalRequired,
          JSON.stringify(input.evidence),
          input.resolutionType,
          input.resolutionSummary,
          input.resolvedAt,
          input.agentWorkCorrelationId,
          input.agentWorkLastSubmittedAt,
          input.agentWorkLastSubmitError,
        ],
      );
      return result.rowCount && result.rowCount > 0 ? "inserted" : "conflict";
    },

    async insertIncident(input) {
      const result = await this.tryInsertIncident(input);
      if (result !== "inserted") {
        throw new Error("insertIncident: dedupe_key already exists");
      }
      const loaded = await this.findById(input.id);
      if (!loaded) throw new Error("insertIncident: row missing after insert");
      return loaded;
    },

    async updateIncident(id, expectedVersion, patch) {
      const touchResolutionType = patch.resolutionType !== undefined;
      const touchResolutionSummary = patch.resolutionSummary !== undefined;
      const touchResolvedAt = patch.resolvedAt !== undefined;
      const result = await client.query(
        `UPDATE marketing_incidents
        SET
          status = COALESCE($3, status),
          occurrence_count = COALESCE($4, occurrence_count),
          last_seen_at = CASE
            WHEN $5::timestamptz IS NULL THEN last_seen_at
            ELSE GREATEST(last_seen_at, $5::timestamptz)
          END,
          sanitized_error = COALESCE($6, sanitized_error),
          error_class = COALESCE($7, error_class),
          resolution_type = CASE WHEN $13 THEN $8 ELSE resolution_type END,
          resolution_summary = CASE WHEN $14 THEN $9 ELSE resolution_summary END,
          resolved_at = CASE WHEN $15 THEN $10::timestamptz ELSE resolved_at END,
          agent_work_last_submitted_at = COALESCE($11::timestamptz, agent_work_last_submitted_at),
          agent_work_last_submit_error = COALESCE($12, agent_work_last_submit_error),
          incident_version = incident_version + 1,
          updated_at = now()
        WHERE id = $1::uuid AND incident_version = $2
        RETURNING *`,
        [
          id,
          expectedVersion,
          patch.status ?? null,
          patch.occurrenceCount ?? null,
          patch.lastSeenAt ?? null,
          patch.sanitizedError ?? null,
          patch.errorClass ?? null,
          patch.resolutionType ?? null,
          patch.resolutionSummary ?? null,
          patch.resolvedAt ?? null,
          patch.agentWorkLastSubmittedAt ?? null,
          patch.agentWorkLastSubmitError ?? null,
          touchResolutionType,
          touchResolutionSummary,
          touchResolvedAt,
        ],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? mapIncidentRow(row) : null;
    },

    async appendEvent(input) {
      const result = await client.query(
        `INSERT INTO marketing_incident_events (id, incident_id, event_type, actor, payload)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5::jsonb)
         RETURNING *`,
        [
          input.id,
          input.incidentId,
          input.eventType,
          input.actor,
          JSON.stringify(sanitizeEventPayload(input.payload)),
        ],
      );
      return mapEventRow(result.rows[0] as Record<string, unknown>);
    },

    async listEvents(incidentId) {
      const result = await client.query(
        `SELECT * FROM marketing_incident_events WHERE incident_id = $1::uuid ORDER BY created_at ASC`,
        [incidentId],
      );
      return result.rows.map((row) => mapEventRow(row as Record<string, unknown>));
    },
  };
}

async function withPoolTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getIncidentPool().connect();
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

export interface PostgresMarketingIncidentRepository extends MarketingIncidentRepository {
  runTransaction<T>(fn: (repo: MarketingIncidentRepository) => Promise<T>): Promise<T>;
  findByDedupeKeyForUpdate(dedupeKey: string): Promise<MarketingIncidentRecord | null>;
  tryInsertIncident(input: InsertIncidentInput): Promise<"inserted" | "conflict">;
}

export function createPostgresIncidentRepository(): PostgresMarketingIncidentRepository {
  return {
    async runTransaction(fn) {
      return withPoolTransaction((client) => fn(createRepoForPoolClient(client)));
    },

    async findByDedupeKey(dedupeKey) {
      const sql = getSql();
      const rows = await sql`SELECT * FROM marketing_incidents WHERE dedupe_key = ${dedupeKey} LIMIT 1`;
      const row = rows[0] as Record<string, unknown> | undefined;
      return row ? mapIncidentRow(row) : null;
    },

    async findByDedupeKeyForUpdate(dedupeKey) {
      return withPoolTransaction(async (client) =>
        createRepoForPoolClient(client).findByDedupeKeyForUpdate(dedupeKey),
      );
    },

    async findById(id) {
      const sql = getSql();
      const rows = await sql`SELECT * FROM marketing_incidents WHERE id = ${id}::uuid LIMIT 1`;
      const row = rows[0] as Record<string, unknown> | undefined;
      return row ? mapIncidentRow(row) : null;
    },

    async tryInsertIncident(input) {
      return withPoolTransaction((client) =>
        createRepoForPoolClient(client).tryInsertIncident(input),
      );
    },

    async insertIncident(input) {
      return withPoolTransaction((client) =>
        createRepoForPoolClient(client).insertIncident(input),
      );
    },

    async updateIncident(id, expectedVersion, patch) {
      return withPoolTransaction((client) =>
        createRepoForPoolClient(client).updateIncident(id, expectedVersion, patch),
      );
    },

    async appendEvent(input) {
      return withPoolTransaction((client) => createRepoForPoolClient(client).appendEvent(input));
    },

    async listEvents(incidentId) {
      const sql = getSql();
      const rows = await sql`
        SELECT * FROM marketing_incident_events
        WHERE incident_id = ${incidentId}::uuid
        ORDER BY created_at ASC
      `;
      return rows.map((row) => mapEventRow(row as Record<string, unknown>));
    },
  };
}

export type ListIncidentsQuery = {
  limit?: number;
  unresolvedOnly?: boolean;
  publicationId?: string | null;
};

export async function listIncidentsFromPostgres(
  input: ListIncidentsQuery = {},
): Promise<MarketingIncidentRecord[]> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const sql = getSql();
  const publicationId = input.publicationId?.trim() || null;

  const rows = input.unresolvedOnly
    ? publicationId
      ? await sql`
          SELECT * FROM marketing_incidents
          WHERE status <> 'resolved' AND publication_id = ${publicationId}::uuid
          ORDER BY last_seen_at DESC
          LIMIT ${limit}
        `
      : await sql`
          SELECT * FROM marketing_incidents
          WHERE status <> 'resolved'
          ORDER BY last_seen_at DESC
          LIMIT ${limit}
        `
    : publicationId
      ? await sql`
          SELECT * FROM marketing_incidents
          WHERE publication_id = ${publicationId}::uuid
          ORDER BY last_seen_at DESC
          LIMIT ${limit}
        `
      : await sql`
          SELECT * FROM marketing_incidents
          ORDER BY last_seen_at DESC
          LIMIT ${limit}
        `;

  return rows.map((row) => mapIncidentRow(row as Record<string, unknown>));
}

export function isPostgresIncidentRepository(
  repo: MarketingIncidentRepository,
): repo is PostgresMarketingIncidentRepository {
  return (
    typeof (repo as PostgresMarketingIncidentRepository).runTransaction === "function" &&
    typeof (repo as PostgresMarketingIncidentRepository).findByDedupeKeyForUpdate === "function"
  );
}

export async function postgresRecordIncidentInTransaction(
  _repo: PostgresMarketingIncidentRepository,
  prepared: PreparedRecordIncident,
  options: RecordIncidentOptions,
): Promise<RecordIncidentResult> {
  return withPoolTransaction(async (client) => {
    const pg = createRepoForPoolClient(client);
    const insertPayload: InsertIncidentInput = {
      id: crypto.randomUUID(),
      schemaVersion: MARKETING_INCIDENT_SCHEMA_VERSION,
      incidentVersion: 1,
      incidentType: prepared.incidentType,
      status: prepared.status,
      severity: prepared.severity,
      sourceSystem: MARKETING_INCIDENT_SOURCE_SYSTEM,
      sourceOperation: prepared.sourceOperation,
      occurredAt: prepared.occurredAt,
      detectedAt: prepared.detectedAt,
      contentId: prepared.contentId,
      publicationId: prepared.publicationId,
      platform: prepared.platform,
      provider: prepared.provider,
      batchId: prepared.batchId,
      finalizeKey: prepared.finalizeKey,
      dedupeKey: prepared.dedupeKey,
      occurrenceCount: 1,
      firstSeenAt: prepared.detectedAt,
      lastSeenAt: prepared.detectedAt,
      errorClass: prepared.errorClass,
      sanitizedError: prepared.sanitizedError,
      retrySafety: prepared.retrySafety,
      permittedActions: prepared.permittedActions as PermittedAction[],
      humanApprovalRequired: prepared.humanApprovalRequired,
      evidence: prepared.evidence,
      resolutionType: null,
      resolutionSummary: null,
      resolvedAt: null,
      agentWorkCorrelationId: crypto.randomUUID(),
      agentWorkLastSubmittedAt: null,
      agentWorkLastSubmitError: null,
    };

    const insertResult = await pg.tryInsertIncident(insertPayload);
    if (insertResult === "inserted") {
      const incident = await pg.findById(insertPayload.id);
      if (!incident) throw new Error("Inserted incident row missing");
      await pg.appendEvent({
        id: crypto.randomUUID(),
        incidentId: incident.id,
        eventType: "incident_created",
        actor: "system",
        payload: {
          incidentType: prepared.incidentType,
          severity: prepared.severity,
          dedupeKey: prepared.dedupeKey,
        },
      });
      return { outcome: "created" as const, incident };
    }

    return executeRecordIncident(pg, prepared, options, {
      loadExclusive: () => pg.findByDedupeKeyForUpdate(prepared.dedupeKey),
    });
  });
}
