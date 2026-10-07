import type { MarketingNotificationPayload } from "../notifications/types";
import type { MarketingPublication } from "../types";
import {
  publicationAmbiguousProcessingDedupeKey,
  publicationOverdueDedupeKey,
} from "./dedupe-keys";
import {
  attachReliabilityDedupeNotification,
  claimReliabilityDedupe,
  cleanupResolvedReliabilityDedupes,
  listOverdueScheduledPublications,
  listStuckProcessingPublications,
  releaseReliabilityDedupe,
} from "./repository";
import {
  buildOverdueNotificationPayload,
  buildStuckProcessingNotificationPayload,
  notifyReliabilityPayload,
} from "./notify";
import { recordPublicationOverdueIncident } from "../publication-incidents/overdue";
import { recordPublicationStuckProcessingIncident } from "../publication-incidents/stuck-processing";

export type ReliabilitySweepResult = {
  overdueDetected: number;
  stuckProcessingDetected: number;
  notificationsCreated: number;
  notificationsSkippedDuplicate: number;
  dedupesCleaned: number;
};

export type ReliabilityAlertDeps = {
  claimDedupe: (input: { dedupeKey: string; publicationId: string }) => Promise<boolean>;
  notify: (payload: MarketingNotificationPayload) => Promise<{ notificationId: string }>;
  attachDedupe: (input: { dedupeKey: string; notificationId: string }) => Promise<void>;
  releaseDedupe: (dedupeKey: string) => Promise<void>;
};

const defaultReliabilityAlertDeps: ReliabilityAlertDeps = {
  claimDedupe: claimReliabilityDedupe,
  notify: notifyReliabilityPayload,
  attachDedupe: attachReliabilityDedupeNotification,
  releaseDedupe: releaseReliabilityDedupe,
};

async function notifyIfClaimed(
  publicationId: string,
  dedupeKey: string,
  payload: MarketingNotificationPayload,
  deps: ReliabilityAlertDeps,
  relatedIncidentId?: string | null,
): Promise<"created" | "skipped"> {
  const payloadWithIncident: MarketingNotificationPayload = relatedIncidentId
    ? { ...payload, relatedIncidentId }
    : payload;
  const claimed = await deps.claimDedupe({
    dedupeKey,
    publicationId,
  });
  if (!claimed) {
    return "skipped";
  }

  try {
    const { notificationId } = await deps.notify(payloadWithIncident);
    await deps.attachDedupe({ dedupeKey, notificationId });
    return "created";
  } catch (error) {
    await deps.releaseDedupe(dedupeKey);
    throw error;
  }
}

export async function runReliabilityAlertPipeline(
  input: {
    overdue: MarketingPublication[];
    stuck: MarketingPublication[];
  },
  deps: ReliabilityAlertDeps = defaultReliabilityAlertDeps,
): Promise<Pick<ReliabilitySweepResult, "notificationsCreated" | "notificationsSkippedDuplicate">> {
  let notificationsCreated = 0;
  let notificationsSkippedDuplicate = 0;

  for (const publication of input.overdue) {
    const incident = await recordPublicationOverdueIncident(publication);
    const dedupeKey = publicationOverdueDedupeKey(publication.id);
    const outcome = await notifyIfClaimed(
      publication.id,
      dedupeKey,
      buildOverdueNotificationPayload(publication),
      deps,
      incident?.id ?? null,
    );
    if (outcome === "created") notificationsCreated += 1;
    else notificationsSkippedDuplicate += 1;
  }

  for (const publication of input.stuck) {
    const incident = await recordPublicationStuckProcessingIncident(publication);
    const dedupeKey = publicationAmbiguousProcessingDedupeKey(publication.id);
    const outcome = await notifyIfClaimed(
      publication.id,
      dedupeKey,
      buildStuckProcessingNotificationPayload(publication),
      deps,
      incident?.id ?? null,
    );
    if (outcome === "created") notificationsCreated += 1;
    else notificationsSkippedDuplicate += 1;
  }

  return { notificationsCreated, notificationsSkippedDuplicate };
}

export async function runMarketingReliabilitySweep(): Promise<ReliabilitySweepResult> {
  const dedupesCleaned = await cleanupResolvedReliabilityDedupes();
  const overdue = await listOverdueScheduledPublications();
  const stuck = await listStuckProcessingPublications();

  const { notificationsCreated, notificationsSkippedDuplicate } =
    await runReliabilityAlertPipeline({ overdue, stuck });

  return {
    overdueDetected: overdue.length,
    stuckProcessingDetected: stuck.length,
    notificationsCreated,
    notificationsSkippedDuplicate,
    dedupesCleaned,
  };
}
