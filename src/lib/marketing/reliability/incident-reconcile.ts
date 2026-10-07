import { logMarketing } from "../logger";
import {
  evaluateAutoResolveForIncident,
  publicationRowBlocksAutoResolve,
} from "../incidents/auto-resolve-policy";
import type { MarketingIncidentRepository } from "../incidents/repository";
import { IncidentVersionConflictError } from "../incidents/errors";
import { resolveIncident } from "../incidents/record";
import type { MarketingIncidentRecord, MarketingIncidentType } from "../incidents/types";
import type { MarketingPublication } from "../types";
import {
  listAutoResolveCandidateIncidents,
  publicationIdsWithUnresolvedManualIncidents,
} from "../incidents/postgres-repository";
import { createPostgresIncidentRepository } from "../incidents/postgres-repository";
import { getMarketingStore } from "../context";

export const AUTO_RESOLVE_INCIDENT_TYPES: readonly MarketingIncidentType[] = [
  "publication_overdue",
  "publication_stuck_processing",
];

export const RECONCILER_ACTOR = "reliability_reconciler";

export type IncidentReconcileStats = {
  examined: number;
  autoResolved: number;
  overdueAutoResolved: number;
  stuckAutoResolved: number;
  skippedUnsafe: number;
  skippedMissingPublication: number;
  skippedConflict: number;
  skippedPolicy: number;
  failed: number;
};

export type IncidentReconcileDeps = {
  repository: MarketingIncidentRepository;
  listCandidates: (limit: number) => Promise<MarketingIncidentRecord[]>;
  getPublication: (publicationId: string) => Promise<MarketingPublication | null>;
  manualBlockerPublicationIds: (publicationIds: string[]) => Promise<Set<string>>;
  now?: Date;
};

const DEFAULT_BATCH_LIMIT = 100;

export function createDefaultIncidentReconcileDeps(): IncidentReconcileDeps {
  const repository = createPostgresIncidentRepository();
  const store = getMarketingStore();
  return {
    repository,
    listCandidates: (limit) => listAutoResolveCandidateIncidents(limit),
    getPublication: async (publicationId) =>
      (await store.getPublication(publicationId)) ?? null,
    manualBlockerPublicationIds: publicationIdsWithUnresolvedManualIncidents,
  };
}

export async function reconcileAutoResolvableIncidents(
  deps: IncidentReconcileDeps = createDefaultIncidentReconcileDeps(),
  batchLimit = DEFAULT_BATCH_LIMIT,
): Promise<IncidentReconcileStats> {
  const stats: IncidentReconcileStats = {
    examined: 0,
    autoResolved: 0,
    overdueAutoResolved: 0,
    stuckAutoResolved: 0,
    skippedUnsafe: 0,
    skippedMissingPublication: 0,
    skippedConflict: 0,
    skippedPolicy: 0,
    failed: 0,
  };

  const now = deps.now ?? new Date();
  let candidates: MarketingIncidentRecord[] = [];
  try {
    candidates = await deps.listCandidates(batchLimit);
  } catch (error) {
    stats.failed += 1;
    logMarketing({
      operation: "marketing_reliability_reconcile",
      success: false,
      error: error instanceof Error ? error.message : "list_candidates_failed",
    });
    return stats;
  }

  const publicationIds = [
    ...new Set(
      candidates
        .map((c) => c.publicationId)
        .filter((id): id is string => Boolean(id?.trim())),
    ),
  ];
  let manualBlocked = new Set<string>();
  try {
    manualBlocked = await deps.manualBlockerPublicationIds(publicationIds);
  } catch (error) {
    stats.failed += 1;
    logMarketing({
      operation: "marketing_reliability_reconcile",
      success: false,
      error: error instanceof Error ? error.message : "manual_blocker_lookup_failed",
    });
    return stats;
  }

  for (const incident of candidates) {
    stats.examined += 1;
    if (incident.status === "resolved") {
      continue;
    }
    if (!AUTO_RESOLVE_INCIDENT_TYPES.includes(incident.incidentType)) {
      stats.skippedPolicy += 1;
      continue;
    }
    const publicationId = incident.publicationId?.trim();
    if (!publicationId) {
      stats.skippedPolicy += 1;
      continue;
    }

    if (manualBlocked.has(publicationId)) {
      stats.skippedUnsafe += 1;
      continue;
    }

    let publication: MarketingPublication | null = null;
    try {
      publication = await deps.getPublication(publicationId);
    } catch {
      stats.failed += 1;
      continue;
    }
    if (!publication) {
      stats.skippedMissingPublication += 1;
      continue;
    }

    const rowBlock = publicationRowBlocksAutoResolve(publication);
    if (rowBlock.blocked) {
      stats.skippedUnsafe += 1;
      continue;
    }

    const decision = evaluateAutoResolveForIncident(
      incident.incidentType,
      publication,
      now,
    );
    if (decision.action === "skip") {
      stats.skippedPolicy += 1;
      continue;
    }

    try {
      const resolved = await resolveIncident(deps.repository, incident.id, {
        resolutionType: "auto_recovered",
        resolutionSummary: decision.summary,
        actor: RECONCILER_ACTOR,
        incidentVersion: incident.incidentVersion,
      });
      if (resolved.status !== "resolved") {
        stats.failed += 1;
        continue;
      }
      stats.autoResolved += 1;
      if (incident.incidentType === "publication_overdue") {
        stats.overdueAutoResolved += 1;
      } else if (incident.incidentType === "publication_stuck_processing") {
        stats.stuckAutoResolved += 1;
      }
    } catch (error) {
      if (error instanceof IncidentVersionConflictError) {
        stats.skippedConflict += 1;
        continue;
      }
      stats.failed += 1;
      logMarketing({
        operation: "marketing_reliability_reconcile_item",
        success: false,
        error: error instanceof Error ? error.message : "resolve_failed",
      });
    }
  }

  logMarketing({
    operation: "marketing_reliability_reconcile",
    success: true,
  });
  console.info("[marketing]", {
    scope: "marketing_autopilot",
    operation: "marketing_reliability_reconcile_stats",
    ...stats,
    at: new Date().toISOString(),
  });

  return stats;
}
