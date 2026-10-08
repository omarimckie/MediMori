import type { MarketingIncidentRepository } from "../incidents/repository";
import { getMarketingIncidentRepository } from "../incidents/runtime-repository";
import { recordMarketingIncidentSafely } from "../incidents/record-safely";
import type { MarketingIncidentRecord } from "../incidents/types";
import { sanitizeEvidence } from "../incidents/sanitize";
import { logMarketing } from "../logger";
import { sanitizeErrorMessage } from "../incidents/sanitize";
import type { MarketingStore } from "../store";
import type { MarketingPublication } from "../types";
import {
  partialPublicationFailureIncidentDedupeKey,
  publicationFailedIncidentDedupeKey,
} from "./dedupe-keys";
import {
  passesPartialProspectiveGate,
  type PartialProspectiveGate,
} from "./partial-publication-failure-config";
import {
  canonicalPublicationIdempotencyKey,
  evaluatePartialPublicationPairFromFailed,
  partialPublicationFailureErrorClass,
  type PartialPublicationPairSuccess,
} from "./partial-publication-pairing";
import { PARTIAL_PUBLICATION_FAILURE_RULE_VERSION } from "./partial-publication-failure-config";
import { publicationIncidentSanitizedError } from "./evidence";

const PARTIAL_PERMITTED_ACTIONS = ["investigate_read_only"] as const;

function buildPartialPublicationEvidence(pair: PartialPublicationPairSuccess): Record<string, unknown> {
  const { failedPublication, publishedPublication, failedContent, publishedContent } = pair;
  return sanitizeEvidence({
    rule_version: PARTIAL_PUBLICATION_FAILURE_RULE_VERSION,
    intent_signals: pair.intentSignals,
    batch_id: pair.batchId,
    shared_scheduled_for: failedPublication.scheduledFor,
    failed_platform: failedPublication.platform,
    published_platform: publishedPublication.platform,
    failed_publication_id: failedPublication.id,
    failed_content_id: failedContent.id,
    counterpart_publication_id: publishedPublication.id,
    counterpart_content_id: publishedContent.id,
    counterpart_platform: publishedPublication.platform,
    published_external_id: publishedPublication.externalId,
    published_url: publishedPublication.url,
    published_at: publishedPublication.publishedAt,
    failed_error_class: partialPublicationFailureErrorClass(failedPublication),
    failed_attempt_count: failedPublication.attemptCount,
  });
}

export async function recordPartialPublicationFailureIncident(
  pair: PartialPublicationPairSuccess,
  sourceOperation: string,
  repository?: MarketingIncidentRepository,
): Promise<MarketingIncidentRecord | null> {
  const { failedPublication, batchId, finalizeKey } = pair;
  return recordMarketingIncidentSafely(
    {
      incidentType: "partial_publication_failure",
      status: "action_required",
      severity: "error",
      sourceOperation,
      dedupeKey: partialPublicationFailureIncidentDedupeKey(batchId, failedPublication.id),
      errorClass: "partial_publication_failure",
      errorMessage:
        `${pair.publishedPublication.platform} published; ` +
        `${failedPublication.platform} failed after shared schedule. ` +
        publicationIncidentSanitizedError(failedPublication),
      retrySafety: "unknown_requires_verification",
      permittedActions: [...PARTIAL_PERMITTED_ACTIONS],
      humanApprovalRequired: false,
      contentId: failedPublication.contentId,
      publicationId: failedPublication.id,
      platform: failedPublication.platform,
      provider: failedPublication.provider,
      batchId,
      finalizeKey,
      evidence: buildPartialPublicationEvidence(pair),
    },
    { repository, reopenIfResolved: true },
  );
}

async function loadCounterpartForFailed(
  store: MarketingStore,
  failedPublication: MarketingPublication,
  failedContent: { metadata: { batchId?: string }; platform: string },
  allContent: Awaited<ReturnType<MarketingStore["listContent"]>>,
): Promise<{
  publishedPublication: MarketingPublication | null;
  publishedContent: (typeof allContent)[number] | null;
}> {
  const batchId = failedContent.metadata.batchId?.trim();
  if (!batchId) {
    return { publishedPublication: null, publishedContent: null };
  }
  const peers = allContent.filter(
    (row) =>
      row.metadata?.source === "smart_upload" &&
      row.metadata.batchId === batchId &&
      (row.platform === "facebook" || row.platform === "instagram") &&
      row.id !== failedPublication.contentId,
  );
  if (peers.length !== 1) {
    return { publishedPublication: null, publishedContent: null };
  }
  const publishedContent = peers[0]!;
  const publishedPublication = await store.getPublicationByIdempotency(
    canonicalPublicationIdempotencyKey(publishedContent.id, publishedContent.platform),
  );
  return { publishedPublication, publishedContent };
}

/**
 * Observes a partial publication split from authoritative store state.
 * Silent: no notifications. Never mutates publications.
 */
async function findPublicationFailedIncident(
  publicationId: string,
  repository?: MarketingIncidentRepository,
): Promise<MarketingIncidentRecord | null> {
  const repo = repository ?? getMarketingIncidentRepository();
  return repo.findByDedupeKey(publicationFailedIncidentDedupeKey(publicationId));
}

export async function observePartialPublicationFailure(
  store: MarketingStore,
  failedPublicationId: string,
  sourceOperation: string,
  input: {
    prospective: PartialProspectiveGate;
    repository?: MarketingIncidentRepository;
  },
): Promise<MarketingIncidentRecord | null> {
  const repository = input.repository;
  if (!passesPartialProspectiveGate(input.prospective)) {
    return null;
  }
  try {
    const failedPublication = await store.getPublication(failedPublicationId);
    if (!failedPublication) {
      return null;
    }
    const failedContent = await store.getContent(failedPublication.contentId);
    if (!failedContent) {
      return null;
    }
    const allContent = await store.listContent();
    const { publishedPublication, publishedContent } = await loadCounterpartForFailed(
      store,
      failedPublication,
      failedContent,
      allContent,
    );

    const evaluation = evaluatePartialPublicationPairFromFailed({
      failedPublication,
      failedContent,
      allContent,
      publishedPublication,
      publishedContent,
    });

    if (!evaluation.ok) {
      if (
        evaluation.reason !== "counterpart_not_published" &&
        evaluation.reason !== "missing_counterpart_publication"
      ) {
        logMarketing({
          operation: "partial_publication_failure_skipped",
          contentId: failedPublication.contentId,
          success: true,
          error: sanitizeErrorMessage(evaluation.reason),
        });
      }
      return null;
    }

    return recordPartialPublicationFailureIncident(
      evaluation.pair,
      sourceOperation,
      repository,
    );
  } catch (error) {
    logMarketing({
      operation: "partial_publication_failure_observe",
      success: false,
      error: sanitizeErrorMessage(
        error instanceof Error ? error.message : "partial_observe_failed",
      ),
    });
    return null;
  }
}

export async function observePartialPublicationFailureFromPublication(
  store: MarketingStore,
  failedPublication: MarketingPublication,
  sourceOperation: string,
  input: {
    prospective: PartialProspectiveGate;
    repository?: MarketingIncidentRepository;
  },
): Promise<MarketingIncidentRecord | null> {
  const fresh = (await store.getPublication(failedPublication.id)) ?? failedPublication;
  return observePartialPublicationFailure(store, fresh.id, sourceOperation, input);
}

/**
 * When the counterpart publishes later in the same or a later cron cycle, retry
 * partial detection from the published leg (failed leg is unchanged).
 */
export async function observePartialPublicationFailureForPublishedCounterpart(
  store: MarketingStore,
  publishedPublication: MarketingPublication,
  sourceOperation: string,
  repository?: MarketingIncidentRepository,
): Promise<MarketingIncidentRecord | null> {
  const published = (await store.getPublication(publishedPublication.id)) ?? publishedPublication;
  if (published.status !== "published") {
    return null;
  }
  const publishedContent = await store.getContent(published.contentId);
  if (!publishedContent) {
    return null;
  }
  const batchId = publishedContent.metadata?.batchId?.trim();
  if (publishedContent.metadata?.source !== "smart_upload" || !batchId) {
    return null;
  }
  const allContent = await store.listContent();
  const peers = allContent.filter(
    (row) =>
      row.metadata?.source === "smart_upload" &&
      row.metadata.batchId === batchId &&
      (row.platform === "facebook" || row.platform === "instagram") &&
      row.id !== published.contentId,
  );
  if (peers.length !== 1) {
    return null;
  }
  const failedContent = peers[0]!;
  const failedPublication = await store.getPublicationByIdempotency(
    canonicalPublicationIdempotencyKey(failedContent.id, failedContent.platform),
  );
  if (!failedPublication) {
    return null;
  }
  const publicationFailed = await findPublicationFailedIncident(
    failedPublication.id,
    repository,
  );
  if (!publicationFailed) {
    return null;
  }
  return observePartialPublicationFailure(store, failedPublication.id, sourceOperation, {
    repository,
    prospective: {
      kind: "sweep_publication_failed_anchor",
      publicationFailedFirstSeenAt: publicationFailed.firstSeenAt,
    },
  });
}

function publicationsFromPublishCycle(
  results: unknown[],
  status: MarketingPublication["status"],
): MarketingPublication[] {
  const out: MarketingPublication[] = [];
  for (const item of results) {
    if (!item || typeof item !== "object") continue;
    const row = item as MarketingPublication;
    if (row.status === status && typeof row.id === "string") {
      out.push(row);
    }
  }
  return out;
}

export function failedPublicationsFromPublishCycle(results: unknown[]): MarketingPublication[] {
  return publicationsFromPublishCycle(results, "failed");
}

export function publishedPublicationsFromPublishCycle(
  results: unknown[],
): MarketingPublication[] {
  return publicationsFromPublishCycle(results, "published");
}

export type PartialPublicationFailureBackupInput = {
  failedInCycle: MarketingPublication[];
  publishedInCycle: MarketingPublication[];
};

export async function runPartialPublicationFailureBackupSweep(
  store: MarketingStore,
  input: PartialPublicationFailureBackupInput,
  repository?: MarketingIncidentRepository,
): Promise<number> {
  let recorded = 0;
  const partialDedupe = new Set<string>();

  for (const candidate of input.failedInCycle) {
    const publicationFailed = await findPublicationFailedIncident(candidate.id, repository);
    if (!publicationFailed) {
      continue;
    }
    const incident = await observePartialPublicationFailureFromPublication(
      store,
      candidate,
      "partial_publication_failure_backup_sweep_failed_leg",
      {
        repository,
        prospective: {
          kind: "sweep_publication_failed_anchor",
          publicationFailedFirstSeenAt: publicationFailed.firstSeenAt,
        },
      },
    );
    if (incident) {
      partialDedupe.add(incident.dedupeKey);
      recorded += 1;
    }
  }

  for (const published of input.publishedInCycle) {
    const incident = await observePartialPublicationFailureForPublishedCounterpart(
      store,
      published,
      "partial_publication_failure_backup_sweep_published_counterpart",
      repository,
    );
    if (incident && !partialDedupe.has(incident.dedupeKey)) {
      partialDedupe.add(incident.dedupeKey);
      recorded += 1;
    } else if (incident) {
      partialDedupe.add(incident.dedupeKey);
    }
  }

  return recorded;
}
