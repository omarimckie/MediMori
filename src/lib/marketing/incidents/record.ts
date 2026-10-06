import { withIncidentDedupeLock } from "./dedupe-lock";
import {
  assertLegalIncidentTransition,
  IllegalIncidentTransitionError,
} from "./lifecycle";
import type { MarketingIncidentRepository } from "./repository";
import { sanitizeErrorMessage, sanitizeEventPayload } from "./sanitize";
import type { MarketingIncidentRecord } from "./types";
import { parseResolutionType } from "./validate";
import { IncidentVersionConflictError } from "./errors";
import {
  executeRecordIncident,
  prepareRecordIncidentInput,
} from "./record-incident-core";
import type {
  RecordIncidentInput,
  RecordIncidentOptions,
  RecordIncidentResult,
  ResolveIncidentInput,
} from "./record-types";
import {
  createPostgresIncidentRepository,
  isPostgresIncidentRepository,
  postgresRecordIncidentInTransaction,
} from "./postgres-repository";

export type {
  RecordIncidentInput,
  RecordIncidentOptions,
  RecordIncidentOutcome,
  RecordIncidentResult,
  ResolveIncidentInput,
} from "./record-types";
export { IncidentDedupeResolvedError, IncidentVersionConflictError } from "./errors";
export type { PermittedAction, RetrySafety } from "./types";

function nowIso(): string {
  return new Date().toISOString();
}

function hasRunTransaction(
  repo: MarketingIncidentRepository,
): repo is MarketingIncidentRepository & {
  runTransaction<T>(fn: (repo: MarketingIncidentRepository) => Promise<T>): Promise<T>;
} {
  return typeof (repo as { runTransaction?: unknown }).runTransaction === "function";
}

async function withIncidentTransaction<T>(
  repo: MarketingIncidentRepository,
  fn: (repo: MarketingIncidentRepository) => Promise<T>,
): Promise<T> {
  if (hasRunTransaction(repo)) {
    return repo.runTransaction(fn);
  }
  return fn(repo);
}

async function appendEvent(
  repo: MarketingIncidentRepository,
  incidentId: string,
  eventType: "status_changed" | "incident_resolved",
  payload: Record<string, unknown>,
  actor = "system",
): Promise<void> {
  await repo.appendEvent({
    id: crypto.randomUUID(),
    incidentId,
    eventType,
    actor,
    payload: sanitizeEventPayload(payload),
  });
}

export async function recordIncident(
  repo: MarketingIncidentRepository,
  input: RecordIncidentInput,
  options: RecordIncidentOptions = {},
): Promise<RecordIncidentResult> {
  const dedupeKey = input.dedupeKey.trim();
  if (!dedupeKey) {
    throw new Error("dedupe_key is required.");
  }

  const detectedAt = input.detectedAt ?? nowIso();
  const occurredAt = input.occurredAt ?? detectedAt;
  const prepared = prepareRecordIncidentInput(input, detectedAt, occurredAt);

  if (isPostgresIncidentRepository(repo)) {
    return postgresRecordIncidentInTransaction(repo, prepared, options);
  }

  return withIncidentDedupeLock(dedupeKey, () =>
    executeRecordIncident(repo, prepared, options),
  );
}

/** Default production repository (Postgres). Not wired to failure paths in Phase I. */
export function getDefaultIncidentRepository(): MarketingIncidentRepository {
  return createPostgresIncidentRepository();
}

export async function transitionIncidentStatus(
  repo: MarketingIncidentRepository,
  incidentId: string,
  toStatus: MarketingIncidentRecord["status"],
  actor = "system",
): Promise<MarketingIncidentRecord> {
  return withIncidentTransaction(repo, async (txRepo) => {
    const current = await txRepo.findById(incidentId);
    if (!current) {
      throw new Error("Incident not found.");
    }
    try {
      assertLegalIncidentTransition(current.status, toStatus);
    } catch (error) {
      if (error instanceof IllegalIncidentTransitionError) throw error;
      throw error;
    }
    const updated =
      (await txRepo.updateIncident(current.id, current.incidentVersion, {
        status: toStatus,
      })) ??
      (() => {
        throw new IncidentVersionConflictError(current.id);
      })();
    await appendEvent(
      txRepo,
      updated.id,
      "status_changed",
      { from: current.status, to: toStatus },
      actor,
    );
    return updated;
  });
}

export async function resolveIncident(
  repo: MarketingIncidentRepository,
  incidentId: string,
  input: ResolveIncidentInput,
): Promise<MarketingIncidentRecord> {
  return withIncidentTransaction(repo, async (txRepo) => {
    const current = await txRepo.findById(incidentId);
    if (!current) {
      throw new Error("Incident not found.");
    }
    assertLegalIncidentTransition(current.status, "resolved");
    const resolutionType = parseResolutionType(String(input.resolutionType));
    const resolutionSummary = sanitizeErrorMessage(input.resolutionSummary);
    const resolvedAt = nowIso();
    const updated =
      (await txRepo.updateIncident(current.id, current.incidentVersion, {
        status: "resolved",
        resolutionType,
        resolutionSummary,
        resolvedAt,
      })) ??
      (() => {
        throw new IncidentVersionConflictError(current.id);
      })();
    await appendEvent(
      txRepo,
      updated.id,
      "incident_resolved",
      { resolutionType, from: current.status },
      input.actor ?? "system",
    );
    return updated;
  });
}
