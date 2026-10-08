import type { MarketingIncidentRepository } from "../incidents/repository";
import type { MarketingPublication } from "../types";
import { isInstagramProviderMediaRecoveryRequired } from "../publication-recovery-guard";
import { observePublicationRecoveryRequired } from "./recovery-required";
import { recordPublicationFailedIncidentResult } from "./failed";
import { notifyPublicationFailedWithDeps } from "./failed-notify";
import type { PublicationRecoveryNotifyDeps } from "./recovery-notify";
import { notifyPublicationRecoveryRequiredWithDeps } from "./recovery-notify";
import { logMarketing } from "../logger";
import { sanitizeErrorMessage } from "../incidents/sanitize";
import type { MarketingStore } from "../store";
import { observePartialPublicationFailureFromPublication } from "./partial-publication-failure";

/**
 * Prospective observability after authoritative publication failure is persisted.
 * Does not mutate publication rows.
 */
export async function observePublicationFailureOutcomes(
  publication: MarketingPublication,
  input: {
    sourceOperation: string;
    repository?: MarketingIncidentRepository;
    notifyFailed?: typeof notifyPublicationFailedWithDeps;
    notifyRecovery?: typeof notifyPublicationRecoveryRequiredWithDeps;
    notifyRecoveryDeps?: PublicationRecoveryNotifyDeps;
    store?: MarketingStore;
  },
): Promise<void> {
  if (publication.status !== "failed") {
    return;
  }

  if (isInstagramProviderMediaRecoveryRequired(publication)) {
    await observePublicationRecoveryRequired(
      publication,
      input.sourceOperation,
      input.repository,
      {
        notifyRecovery: input.notifyRecovery,
        notifyRecoveryDeps: input.notifyRecoveryDeps,
      },
    );
    return;
  }

  const failedResult = await recordPublicationFailedIncidentResult(
    publication,
    input.sourceOperation,
    input.repository,
  );
  if (!failedResult) {
    return;
  }

  if (
    input.store &&
    (failedResult.outcome === "created" || failedResult.outcome === "reopened")
  ) {
    try {
      await observePartialPublicationFailureFromPublication(
        input.store,
        publication,
        "partial_publication_failure_after_actionable_failed",
        {
          repository: input.repository,
          prospective: {
            kind: "hook_actionable_failure_transition",
            publicationFailedOutcome: failedResult.outcome,
            publicationFailedFirstSeenAt: failedResult.incident.firstSeenAt,
          },
        },
      );
    } catch (error) {
      logMarketing({
        operation: "partial_publication_failure_observe",
        contentId: publication.contentId,
        success: false,
        error: sanitizeErrorMessage(
          error instanceof Error ? error.message : "partial_observe_failed",
        ),
      });
    }
  }

  const notify = input.notifyFailed ?? notifyPublicationFailedWithDeps;
  try {
    await notify(publication, failedResult.incident, failedResult.outcome);
  } catch (error) {
    logMarketing({
      operation: "publication_failed_observe_notify",
      contentId: publication.contentId,
      success: false,
      error: sanitizeErrorMessage(
        error instanceof Error ? error.message : "observe_notify_failed",
      ),
    });
  }
}
